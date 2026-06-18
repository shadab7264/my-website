"use strict";

require("dotenv").config();


const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");
const { createClient } = require("@supabase/supabase-js");
const nodemailer = require("nodemailer");
const twilio = require("twilio");

// --- Security Hardening Helpers & Classes ---

class RateLimiter {
  constructor(limit, windowMs) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.requests = new Map();
    // Periodically clean up expired entries to prevent memory exhaustion
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [ip, data] of this.requests.entries()) {
        if (now > data.resetTime) {
          this.requests.delete(ip);
        }
      }
    }, 10 * 60 * 1000);
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  isLimitExceeded(ip) {
    const now = Date.now();
    const clientData = this.requests.get(ip);

    if (!clientData) {
      this.requests.set(ip, { count: 1, resetTime: now + this.windowMs });
      return false;
    }

    if (now > clientData.resetTime) {
      clientData.count = 1;
      clientData.resetTime = now + this.windowMs;
      return false;
    }

    clientData.count++;
    return clientData.count > this.limit;
  }
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "unknown";
}

class WebApplicationFirewall {
  static isSuspiciousRequest(req, pathname, bodyBuffer) {
    const url = decodeURIComponent(req.url || "");
    const userAgent = String(req.headers["user-agent"] || "").toLowerCase();

    // 1. Path Traversal & Sensitive File Patterns
    const traversalPatterns = [
      /\.\.\//,                   // Traversal (../)
      /%2e%2e/i,                  // URL encoded traversal
      /\/\.env/i,                 // Environment files
      /\/\.git/i,                 // Git metadata
      /wp-admin|wp-login|xmlrpc/i,// WordPress common attack paths
      /\/(etc|bin|var|win)\//i,   // OS system directories
      /\.php$/i                   // PHP scripts (unsupported on this server)
    ];

    for (const pattern of traversalPatterns) {
      if (pattern.test(url) || pattern.test(pathname)) {
        console.warn(`[WAF] Blocked traversal/exploit pattern on path: ${url}`);
        return true;
      }
    }

    // 2. Suspicious Automated User Agents / Scanners
    const maliciousUserAgents = [
      /nmap/i, /sqlmap/i, /nikto/i, /dirbuster/i, /censys/i, /nessus/i,
      /hydra/i, /w3af/i, /acunetix/i, /zgrab/i, /gobuster/i
    ];

    for (const uaPattern of maliciousUserAgents) {
      if (uaPattern.test(userAgent)) {
        console.warn(`[WAF] Blocked suspicious automated crawler/scanner user-agent: ${userAgent}`);
        return true;
      }
    }

    // 3. Check Query Parameters for SQLi & XSS
    const sqliXssPatterns = [
      /union\s+select/i,
      /select\s+.*?\s+from/i,
      /insert\s+into/i,
      /delete\s+from/i,
      /drop\s+table/i,
      /update\s+.*?\s+set/i,
      /['"`;]\s*or\s*['"`;]?\d+['"`;]?\s*=\s*['"`;]?\d+/i, // e.g., ' or 1=1
      /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/i, // <script> tags
      /javascript:\s*alert\s*\(/i,
      /onload\s*=\s*['"].*?['"]/i,
      /onerror\s*=\s*['"].*?['"]/i
    ];

    // Check query params
    for (const pattern of sqliXssPatterns) {
      if (pattern.test(url)) {
        console.warn(`[WAF] Blocked SQLi/XSS pattern in query parameters: ${url}`);
        return true;
      }
    }

    // Check request body if present (passed as string)
    if (bodyBuffer && bodyBuffer.length > 0) {
      const bodyString = bodyBuffer.toString("utf8");
      for (const pattern of sqliXssPatterns) {
        if (pattern.test(bodyString)) {
          console.warn(`[WAF] Blocked SQLi/XSS pattern in request body payload: ${bodyString.slice(0, 500)}`);
          return true;
        }
      }
    }

    return false;
  }
}


const ROOT_DIR = process.cwd();
const SUPABASE_URL = process.env.SUPABASE_URL || "https://ctprrqxqiwmzcjsacsmn.supabase.co";

let rawKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 
             process.env.SUPABASE_SERVICE_KEY || 
             process.env.SERVICE_ROLE_KEY || 
             process.env.SUPABASE_SECRET_KEY || 
             process.env.SUPABASE_ADMIN_KEY || 
             process.env.SUPABASE_KEY || 
             "sb_publishable_1DEtfIZ7bwt1xNT3gcbBDw_g5HYVNni";

// Auto-sanitize whitespace and double/single quotes
rawKey = String(rawKey).trim().replace(/^["']|["']$/g, "");

const SUPABASE_KEY = rawKey;

function isServiceRoleKey(key) {
  try {
    if (!key) return false;
    const parts = key.split('.');
    if (parts.length !== 3) return false;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
    return payload.role === 'service_role';
  } catch {
    return false;
  }
}

if (!isServiceRoleKey(SUPABASE_KEY)) {
  console.warn("⚠️ WARNING: The Supabase client is NOT initialized with a service_role key. Database write operations will fail due to Row-Level Security (RLS). Please ensure SUPABASE_SERVICE_ROLE_KEY is correctly set in your environment variables.");
} else {
  console.log("✅ Supabase client successfully initialized with service_role key (bypasses RLS).");
}

const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const DEFAULT_DATA_DIR = path.join(ROOT_DIR, "data");
const SESSION_MAX_AGE = 8 * 60 * 60 * 1000;
const MAX_BODY_SIZE = 1024 * 1024;
const MAX_UPLOAD_SIZE = 50 * 1024 * 1024;
const MAX_RESUME_SIZE = 10 * 1024 * 1024;


const SUPPORTED_MEDIA = {
  "image/jpeg": { extension: ".jpg", type: "image" },
  "image/png": { extension: ".png", type: "image" },
  "image/webp": { extension: ".webp", type: "image" },
  "image/gif": { extension: ".gif", type: "image" },
  "video/mp4": { extension: ".mp4", type: "video" },
  "video/webm": { extension: ".webm", type: "video" }
};

const SUPPORTED_DOCUMENTS = {
  "application/pdf": { extension: ".pdf", type: "document" },
  "application/msword": { extension: ".doc", type: "document" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { extension: ".docx", type: "document" }
};

const defaultPosts = [
  {
    id: "d92a0149-a2a1-4328-924b-d7168e3a51f1",
    title: "Build a study path with clarity",
    category: "Admissions",
    description:
      "Our counsellors map your academic profile, budget and career ambition to universities where you can thrive.",
    createdAt: "2026-05-20T09:00:00.000Z"
  },
  {
    id: "d92a0149-a2a1-4328-924b-d7168e3a51f2",
    title: "Plan early for scholarships",
    category: "Funding",
    description:
      "A focused application calendar, strong statement of purpose and timely document preparation can unlock better funding options.",
    createdAt: "2026-05-18T09:00:00.000Z"
  },
  {
    id: "d92a0149-a2a1-4328-924b-d7168e3a51f3",
    title: "Visa guidance made simpler",
    category: "Visa Support",
    description:
      "Prepare finances, documentation and interview confidence with experts who understand every milestone of your journey.",
    createdAt: "2026-05-15T09:00:00.000Z"
  }
];

function createApp(options = {}) {
  const dataDir = options.dataDir || process.env.DATA_DIR || DEFAULT_DATA_DIR;
  const adminEmail = (options.adminEmail || process.env.ADMIN_EMAIL || "skywardcareerandplacementhub@gmail.com").toLowerCase();
  const adminPassword = options.adminPassword || process.env.ADMIN_PASSWORD || "ChangeMe123!";
  const jobPosterEmail = (options.jobPosterEmail || process.env.JOB_POSTER_EMAIL || "recruiter@skywardeducation.com").toLowerCase();
  const jobPosterPassword = options.jobPosterPassword || process.env.JOB_POSTER_PASSWORD || "RecruitMe123!";
  const sessionSecret = options.sessionSecret || process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
  const googleSheetsWebhookUrl = options.googleSheetsWebhookUrl || process.env.GOOGLE_SHEETS_WEBHOOK_URL || "";
  const googleSheetsSecret = options.googleSheetsSecret || process.env.GOOGLE_SHEETS_SECRET || "";
  const externalFetch = options.fetchImpl || fetch;
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false },
    global: { fetch: externalFetch }
  });
  const sessions = new Map();
  // Background session cleanup task
  const sessionCleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [token, session] of sessions.entries()) {
      if (session.expiresAt < now) {
        sessions.delete(token);
      }
    }
  }, 30 * 60 * 1000);
  if (sessionCleanupInterval.unref) {
    sessionCleanupInterval.unref();
  }
  const globalLimiter = new RateLimiter(100, 60 * 1000);       // 100 requests per minute
  const loginLimiter = new RateLimiter(5, 15 * 60 * 1000);     // 5 attempts per 15 minutes
  const leadsLimiter = new RateLimiter(5, 60 * 60 * 1000);     // 5 submissions per hour
  const applyLimiter = new RateLimiter(15, 60 * 60 * 1000);     // 15 applications per hour
  const uploadsDir = path.join(dataDir, "uploads");

  // SMTP Settings
  const smtpHost = options.smtpHost !== undefined ? options.smtpHost : (process.env.SMTP_HOST || "");
  const smtpPort = options.smtpPort !== undefined ? options.smtpPort : (process.env.SMTP_PORT || "");
  const smtpUser = options.smtpUser !== undefined ? options.smtpUser : (process.env.SMTP_USER || "");
  const smtpPass = options.smtpPass !== undefined ? options.smtpPass : (process.env.SMTP_PASS || "");
  const smtpFrom = options.smtpFrom !== undefined ? options.smtpFrom : (process.env.SMTP_FROM || "");
  const emailNotifyAdmin = options.emailNotifyAdmin !== undefined ? options.emailNotifyAdmin : (process.env.EMAIL_NOTIFY_ADMIN === "true");

  let transporter = null;
  if (smtpHost && smtpUser && smtpPass) {
    transporter = nodemailer.createTransport({
      host: smtpHost,
      port: Number(smtpPort) || 587,
      secure: Number(smtpPort) === 465,
      auth: {
        user: smtpUser,
        pass: smtpPass
      }
    });
  } else {
    console.warn("⚠️ SMTP environment variables are not fully configured. Email notifications/manual emails will be skipped.");
  }

  // Twilio Settings
  const twilioAccountSid = options.twilioAccountSid !== undefined ? options.twilioAccountSid : (process.env.TWILIO_ACCOUNT_SID || "");
  const twilioAuthToken = options.twilioAuthToken !== undefined ? options.twilioAuthToken : (process.env.TWILIO_AUTH_TOKEN || "");
  const twilioSmsFrom = options.twilioSmsFrom !== undefined ? options.twilioSmsFrom : (process.env.TWILIO_SMS_FROM || "");
  const companySmsNumber = options.companySmsNumber !== undefined ? options.companySmsNumber : (process.env.COMPANY_SMS_NUMBER || "");

  let twilioClient = null;
  if (twilioAccountSid && twilioAccountSid.startsWith("AC") && twilioAuthToken) {
    twilioClient = twilio(twilioAccountSid, twilioAuthToken);
  } else {
    console.warn("⚠️ Twilio environment variables are not fully configured or are invalid (Account SID must start with 'AC'). SMS alerts will be skipped.");
  }

  async function sendSmsAlert(messageText) {
    if (!twilioClient || !twilioSmsFrom || !companySmsNumber) {
      console.warn("⚠️ Skipped sending SMS alert (Twilio client/numbers not configured). Message: " + messageText);
      return { status: "skipped", reason: "twilio_not_configured" };
    }
    
    try {
      const response = await twilioClient.messages.create({
        body: messageText,
        from: twilioSmsFrom,
        to: companySmsNumber
      });
      console.log(`💬 SMS alert sent successfully! Message SID: ${response.sid}`);
      return { status: "sent", sid: response.sid };
    } catch (error) {
      console.error("❌ Failed to send SMS alert:", error);
      throw error;
    }
  }

  async function sendMail({ to, subject, html, text }) {
    if (!transporter) {
      console.warn(`⚠️ Skipped sending email to ${to} (SMTP transporter not configured). Subject: ${subject}`);
      return { status: "skipped", reason: "transporter_not_configured" };
    }
    try {
      const info = await transporter.sendMail({
        from: smtpFrom || smtpUser,
        to,
        subject,
        text,
        html
      });
      console.log(`✉️ Email successfully sent to ${to}: ${info.messageId}`);
      return { status: "sent", messageId: info.messageId };
    } catch (error) {
      console.error(`❌ Failed to send email to ${to}:`, error);
      throw error;
    }
  }

  ensureStore(dataDir);
  

  function sendJson(res, status, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(body),
      "Cache-Control": "no-store"
    });
    res.end(body);
  }

  function readData(fileName, fallback) {
    const target = path.join(dataDir, fileName);
    try {
      return JSON.parse(fs.readFileSync(target, "utf8"));
    } catch {
      return fallback;
    }
  }

  function writeData(fileName, value) {
    const target = path.join(dataDir, fileName);
    const temp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.renameSync(temp, target);
  }

  async function readBody(req, limit = MAX_BODY_SIZE) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) {
        throw new Error("Request is too large.");
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  async function parseBody(req) {
    const raw = (req.bodyBuffer || await readBody(req)).toString("utf8");
    try {
      return raw ? JSON.parse(raw) : {};
    } catch {
      throw new Error("Invalid request format.");
    }
  }

  async function parsePostSubmission(req) {
    const contentType = req.headers["content-type"] || "";
    if (!contentType.startsWith("multipart/form-data")) return { fields: await parseBody(req), file: null };
    const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    if (!boundaryMatch) throw new Error("Invalid upload format.");
    const raw = req.bodyBuffer || await readBody(req, MAX_UPLOAD_SIZE + MAX_BODY_SIZE);
    return parseMultipart(raw, boundaryMatch[1] || boundaryMatch[2]);
  }

  async function saveUploadedMedia(file) {
    if (!file || !file.data.length) return null;
    const media = SUPPORTED_MEDIA[file.contentType];
    if (!media) throw new Error("Upload a JPG, PNG, WEBP, GIF, MP4 or WEBM file.");
    if (file.data.length > MAX_UPLOAD_SIZE) throw new Error("Media file must be smaller than 50 MB.");
    const fileName = `${crypto.randomUUID()}${media.extension}`;
    
    if (!isServiceRoleKey(SUPABASE_KEY)) {
      throw new Error("Supabase service role key is not configured or is invalid. Please ensure SUPABASE_SERVICE_ROLE_KEY is correctly set in your environment variables to allow media uploads.");
    }
    
    try {
      const { data, error } = await supabase.storage
        .from("media")
        .upload(fileName, file.data, {
          contentType: file.contentType,
          duplex: "half"
        });
      if (error) throw error;
      
      const { data: publicUrlData } = supabase.storage
        .from("media")
        .getPublicUrl(fileName);
        
      return {
        mediaUrl: publicUrlData.publicUrl,
        mediaType: media.type,
        mediaName: clean(file.fileName).slice(0, 200)
      };
    } catch (storageError) {
      console.error("Supabase Storage upload failed:", storageError);
      throw new Error(`Supabase Storage upload failed: ${storageError.message || storageError.statusText || storageError}`);
    }
  }

  async function saveUploadedResume(file) {
    if (!file || !file.data.length) return null;
    const doc = SUPPORTED_DOCUMENTS[file.contentType];
    if (!doc) throw new Error("Upload a PDF, DOC, or DOCX file.");
    if (file.data.length > MAX_RESUME_SIZE) throw new Error("Resume must be smaller than 10 MB.");
    const fileName = `${crypto.randomUUID()}${doc.extension}`;
    if (!isServiceRoleKey(SUPABASE_KEY)) {
      throw new Error("Supabase service role key is not configured. Resume upload failed.");
    }
    const { data, error } = await supabase.storage
      .from("resumes")
      .upload(fileName, file.data, { contentType: file.contentType, duplex: "half" });
    if (error) throw new Error(`Resume upload failed: ${error.message}`);
    const { data: publicUrlData } = supabase.storage.from("resumes").getPublicUrl(fileName);
    return { resumeUrl: publicUrlData.publicUrl, resumeName: clean(file.fileName).slice(0, 200) };
  }

  async function generateApplicationId() {
    const year = new Date().getFullYear();
    const { count, error } = await supabase
      .from("job_applications")
      .select("*", { count: "exact", head: true });
    const nextNum = (error ? 0 : (count || 0)) + 1;
    return `SKY-${year}-${String(nextNum).padStart(4, "0")}`;
  }

  function slugify(text) {
    return String(text).toLowerCase().trim()
      .replace(/[^\w\s-]/g, "").replace(/[\s_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")
      .slice(0, 120);
  }

  function parseMultipartFiles(buffer, boundary) {
    const delimiter = Buffer.from(`--${boundary}`);
    const parts = [];
    let start = buffer.indexOf(delimiter) + delimiter.length;
    while (start >= delimiter.length) {
      if (buffer.subarray(start, start + 2).toString() === "--") break;
      if (buffer.subarray(start, start + 2).toString() === "\r\n") start += 2;
      const end = buffer.indexOf(delimiter, start);
      if (end === -1) break;
      parts.push(buffer.subarray(start, end - 2));
      start = end + delimiter.length;
    }
    const fields = {};
    const files = {};
    for (const part of parts) {
      const separator = part.indexOf(Buffer.from("\r\n\r\n"));
      if (separator === -1) continue;
      const headers = part.subarray(0, separator).toString("utf8");
      const data = part.subarray(separator + 4);
      const name = headers.match(/name="([^"]+)"/i)?.[1];
      const fileName = headers.match(/filename="([^"]*)"/i)?.[1];
      if (!name) continue;
      if (fileName) {
        const contentType = headers.match(/content-type:\s*([^\r\n]+)/i)?.[1].trim().toLowerCase();
        files[name] = { fileName, contentType, data };
      } else {
        fields[name] = data.toString("utf8");
      }
    }
    return { fields, files };
  }

  function cookiesFrom(req) {
    return Object.fromEntries(
      (req.headers.cookie || "")
        .split(";")
        .filter(Boolean)
        .map((cookie) => {
          const [key, ...parts] = cookie.trim().split("=");
          return [key, decodeURIComponent(parts.join("="))];
        })
    );
  }

  function sign(token) {
    return crypto.createHmac("sha256", sessionSecret).update(token).digest("hex");
  }

  function currentSession(req) {
    const raw = cookiesFrom(req).skyward_session;
    if (!raw) return null;
    const [token, signature] = raw.split(".");
    if (!token || !signature || !safeEqual(sign(token), signature)) return null;
    const session = sessions.get(token);
    if (!session || session.expiresAt < Date.now()) {
      sessions.delete(token);
      return null;
    }
    return { token, ...session };
  }

  function requireSession(req, res) {
    const session = currentSession(req);
    if (!session) {
      sendJson(res, 401, { error: "Please log in to continue." });
      return null;
    }
    return session;
  }

  function requireAdmin(req, res) {
    const session = requireSession(req, res);
    if (!session) return null;
    if (session.role !== "admin") {
      sendJson(res, 403, { error: "Forbidden: Admin access required." });
      return null;
    }
    return session;
  }

  function verifyCsrf(req, res, session) {
    if (req.headers["x-csrf-token"] !== session.csrfToken) {
      sendJson(res, 403, { error: "Your session could not be verified. Please refresh and try again." });
      return false;
    }
    return true;
  }

  async function syncLeadToGoogleSheet(lead) {
    if (!googleSheetsWebhookUrl) return { status: "not_configured" };
    const response = await externalFetch(googleSheetsWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: googleSheetsSecret,
        action: "upsertLead",
        lead
      }),
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new Error(`Google Sheets returned ${response.status}.`);
    const payload = await response.json().catch(() => ({}));
    if (payload.ok === false) throw new Error(payload.error || "Google Sheets rejected the lead.");
    return { status: "synced", syncedAt: new Date().toISOString() };
  }

 
  async function handleApi(req, res, pathname) {
    if (req.method === "GET" && pathname === "/api/content/site") {
      const content = readData("content.json", {});
      return sendJson(res, 200, { content });
    }

    if (req.method === "POST" && pathname === "/api/admin/content/site") {
      const session = requireAdmin(req, res);
      if (!session || !verifyCsrf(req, res, session)) return;
      const body = await parseBody(req);
      const content = readData("content.json", {});
      const newContent = { ...content, ...body };
      writeData("content.json", newContent);
      return sendJson(res, 200, { message: "Content updated successfully.", content: newContent });
    }

    if (req.method === "GET" && pathname === "/api/content") {
      const { data: rawPosts, error } = await supabase
        .from("posts")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        return sendJson(res, 500, { error: error.message });
      }

      const posts = (rawPosts || []).map(post => ({
        id: post.id,
        title: post.title,
        category: post.category,
        description: post.description,
        showApply: post.show_apply,
        mediaUrl: post.media_url,
        mediaType: post.media_type,
        mediaName: post.media_name,
        createdAt: post.created_at
      }));

      return sendJson(res, 200, { posts });
    }

    if (req.method === "GET" && pathname === "/api/gallery") {
      const { data: rawGallery, error } = await supabase
        .from("gallery")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        return sendJson(res, 500, { error: error.message });
      }

      const gallery = (rawGallery || []).map(item => ({
        id: item.id,
        title: item.title,
        description: item.description,
        imageUrl: item.image_url,
        imageName: item.image_name,
        createdAt: item.created_at
      }));

      return sendJson(res, 200, { gallery });
    }

    if (req.method === "POST" && pathname === "/api/leads") {
      const body = await parseBody(req);
      if (clean(body.website)) return sendJson(res, 201, { message: "Thank you. We will contact you shortly." });

      const lead = {
        id: crypto.randomUUID(),
        name: clean(body.name),
        email: clean(body.email),
        phone: clean(body.phone),
        destination: clean(body.destination),
        service: clean(body.service),
        message: clean(body.message),
        source: clean(body.source) || "Website",
        createdAt: new Date().toISOString()
      };
      if (!lead.name || !validEmail(lead.email) || !lead.phone || !lead.service) {
        return sendJson(res, 400, { error: "Please provide your name, valid email, phone number and service." });
      }

      const { error: dbError } = await supabase
        .from("leads")
        .insert([{
          name: lead.name,
          email: lead.email,
          phone: lead.phone,
          destination: lead.destination,
          service: lead.service,
          message: lead.message,
          source: lead.source,
          created_at: lead.createdAt
        }]);

      if (dbError) {
        console.error("Supabase leads insert error:", dbError);
        return sendJson(res, 500, { error: `Database save failed: ${dbError.message}` });
      }

      try {
        const leads = readData("leads.json", []);
        leads.unshift(lead);
        writeData("leads.json", leads);
      } catch (e) {
        console.error("Local leads backup write failed:", e);
      }



      if (googleSheetsWebhookUrl) {
        syncLeadToGoogleSheet(lead).then((result) => {
          lead.sheetsStatus = result.status;
          lead.sheetsSyncedAt = result.syncedAt;
          try {
            const currentLeads = readData("leads.json", []);
            writeData("leads.json", currentLeads.map((l) => (l.id === lead.id ? lead : l)));
          } catch (e) {
            console.error("Local leads sync update failed:", e);
          }
        }).catch(() => {});
      }

      if (emailNotifyAdmin) {
        const subject = `New Consultation Lead: ${lead.name}`;
        const html = `
          <h2>New Student Enquiry Received</h2>
          <p>A new lead has submitted a consultation request on the website.</p>
          <table border="1" cellpadding="8" cellspacing="0" style="border-collapse: collapse; border-color: #eee;">
            <tr style="background-color: #f9f9f9;"><td><strong>Field</strong></td><td><strong>Value</strong></td></tr>
            <tr><td><strong>Name</strong></td><td>${lead.name}</td></tr>
            <tr><td><strong>Email</strong></td><td>${lead.email}</td></tr>
            <tr><td><strong>Phone</strong></td><td>${lead.phone}</td></tr>
            <tr><td><strong>Service Needed</strong></td><td>${lead.service}</td></tr>
            <tr><td><strong>Destination Choice</strong></td><td>${lead.destination || "-"}</td></tr>
            <tr><td><strong>Message</strong></td><td>${lead.message || "-"}</td></tr>
            <tr><td><strong>Source</strong></td><td>${lead.source}</td></tr>
            <tr><td><strong>Received At</strong></td><td>${new Date(lead.createdAt).toLocaleString("en-IN")}</td></tr>
          </table>
          <br/>
          <p>Log in to the admin panel to view details and respond.</p>
        `;
        const text = `New Consultation Lead Details:\nName: ${lead.name}\nEmail: ${lead.email}\nPhone: ${lead.phone}\nService: ${lead.service}\nDestination: ${lead.destination}\nMessage: ${lead.message}\nSource: ${lead.source}`;

        sendMail({ to: adminEmail, subject, html, text }).catch((err) => {
          console.error("Failed to send administrative lead notification:", err);
        });
      }

      // Send automated SMS alert to the company
      const smsText = `New Lead: ${lead.name} (${lead.phone}) for ${lead.service}. Source: ${lead.source}`;
      sendSmsAlert(smsText).catch((err) => {
        console.error("Failed to send SMS notification alert:", err);
      });

      // Send auto-response email to the student
      const studentSubject = `Enquiry Received | Skyward Career & Placement Hub`;
      const studentHtml = `
        <div style="font-family: 'Outfit', sans-serif; line-height: 1.6; color: #0B1B3D; max-width: 600px; margin: 0 auto; border: 1px solid rgba(10, 25, 47, 0.08); border-radius: 16px; padding: 32px; background-color: #FCFAF7;">
          <div style="text-align: center; margin-bottom: 24px;">
            <h2 style="color: #0B1B3D; font-family: 'Playfair Display', serif; margin: 0;">Skyward Career & Placement Hub</h2>
          </div>
          <p>Dear ${lead.name},</p>
          <p>Thank you for reaching out to Skyward Career and Placement Hub! We have successfully received your consultation enquiry.</p>
          <p>Our expert counsellors are reviewing your details and will get in touch with you shortly to schedule a free assessment session.</p>
          <div style="background-color: rgba(10, 25, 47, 0.03); border-radius: 12px; padding: 20px; margin: 20px 0; border: 1px solid rgba(10, 25, 47, 0.06);">
            <h3 style="margin-top: 0; font-size: 16px; color: #0B1B3D;">Your Enquiry Details:</h3>
            <table cellpadding="4" cellspacing="0" style="font-size: 14px;">
              <tr><td><strong>Service Needed:</strong></td><td>${lead.service}</td></tr>
              <tr><td><strong>Destination Choice:</strong></td><td>${lead.destination || "-"}</td></tr>
            </table>
          </div>
          <p>If you have any urgent questions, feel free to reply directly to this email or call us at <strong>+91 9241080063</strong>.</p>
          <hr style="border: 0; border-top: 1px solid rgba(10, 25, 47, 0.08); margin: 32px 0;" />
          <p style="font-size: 13px; color: #4F5D73;">
            Best regards,<br/>
            <strong>Skyward Career and Placement Hub Counselling Team</strong><br/>
            Email: hello@skywardeducation.com<br/>
            Web: <a href="http://localhost:3000">skywardeducation.com</a>
          </p>
        </div>
      `;
      const studentText = `Dear ${lead.name},\n\nThank you for reaching out to Skyward Career and Placement Hub! We have successfully received your consultation enquiry.\n\nOur counsellors are reviewing your details and will get in touch with you shortly to schedule a free assessment session.\n\nEnquiry Summary:\nService Needed: ${lead.service}\nDestination Choice: ${lead.destination || "-"}\n\nBest regards,\nSkyward Career and Placement Hub Counselling Team`;

      sendMail({ to: lead.email, subject: studentSubject, html: studentHtml, text: studentText }).catch((err) => {
        console.error("Failed to send student welcome email:", err);
      });

      return sendJson(res, 201, { message: "Thanks! A counsellor will connect with you soon." });
    }

    if (req.method === "POST" && pathname === "/api/admin/login") {
      const body = await parseBody(req);
      const emailInput = clean(body.email).toLowerCase();
      const passwordInput = clean(body.password);

      let authenticatedEmail = null;
      let userRole = null;

      if (emailInput === adminEmail && safeEqual(passwordInput, adminPassword)) {
        authenticatedEmail = adminEmail;
        userRole = "admin";
      } else if (emailInput === jobPosterEmail && safeEqual(passwordInput, jobPosterPassword)) {
        authenticatedEmail = jobPosterEmail;
        userRole = "job_poster";
      }

      if (!authenticatedEmail) {
        return sendJson(res, 401, { error: "Incorrect email or password." });
      }

      const token = crypto.randomBytes(32).toString("hex");
      const csrfToken = crypto.randomBytes(24).toString("hex");
      sessions.set(token, { csrfToken, expiresAt: Date.now() + SESSION_MAX_AGE, email: authenticatedEmail, role: userRole });
      const isProduction = process.env.NODE_ENV === "production" || !(req.headers.host || "").includes("localhost");
      res.setHeader(
        "Set-Cookie",
        `skyward_session=${token}.${sign(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MAX_AGE / 1000}${isProduction ? "; Secure" : ""}`
      );
      return sendJson(res, 200, { email: authenticatedEmail, role: userRole, csrfToken });
    }

    if (req.method === "GET" && pathname === "/api/admin/session") {
      const session = currentSession(req);
      if (!session) return sendJson(res, 401, { authenticated: false });
      return sendJson(res, 200, { authenticated: true, email: session.email, role: session.role || "admin", csrfToken: session.csrfToken });
    }

    if (req.method === "GET" && pathname === "/api/admin/debug-env") {
      const session = requireAdmin(req, res);
      if (!session) return;
      
      const keyExists = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
      const isSRK = isServiceRoleKey(SUPABASE_KEY);
      const keyLength = SUPABASE_KEY ? SUPABASE_KEY.length : 0;
      const keyPrefix = SUPABASE_KEY ? SUPABASE_KEY.slice(0, 10) : "";
      const keyParts = SUPABASE_KEY ? SUPABASE_KEY.split('.').length : 0;
      
      let payloadRole = null;
      try {
        const parts = SUPABASE_KEY.split('.');
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
        payloadRole = payload.role;
      } catch (e) {
        payloadRole = `Parsing error: ${e.message}`;
      }

      return sendJson(res, 200, {
        supabaseUrl: SUPABASE_URL,
        supabaseKeyExists: keyExists,
        isServiceRoleKey: isSRK,
        keyLength,
        keyParts,
        keyPrefix,
        payloadRole,
        envKeys: Object.keys(process.env).filter(k => k.includes("SUPABASE") || k.includes("KEY"))
      });
    }

    if (req.method === "POST" && pathname === "/api/admin/logout") {
      const session = requireAdmin(req, res);
      if (!session || !verifyCsrf(req, res, session)) return;
      sessions.delete(session.token);
      res.setHeader("Set-Cookie", "skyward_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0");
      return sendJson(res, 200, { message: "Logged out." });
    }

    if (req.method === "GET" && pathname === "/api/admin/leads") {
  const session = requireAdmin(req, res);
  if (!session) return;

  return sendJson(res, 200, {
    leads: readData("leads.json", []),
    sheetsConfigured: Boolean(googleSheetsWebhookUrl)
  });
}

if (req.method === "DELETE" && pathname.startsWith("/api/admin/leads/")) {
  const session = requireAdmin(req, res);
  if (!session || !verifyCsrf(req, res, session)) return;
  const id = pathname.split("/").pop();

  const { error } = await supabase
    .from("leads")
    .delete()
    .eq("id", id);

  try {
    const leads = readData("leads.json", []);
    const updatedLeads = leads.filter((l) => l.id !== id);
    writeData("leads.json", updatedLeads);
  } catch (e) {
    console.error("Local leads delete failed:", e);
  }

  if (error) {
    return sendJson(res, 400, { error: error.message });
  }

  return sendJson(res, 200, { success: true });
}

if (req.method === "POST" && pathname === "/api/admin/leads/email") {
  const session = requireAdmin(req, res);
  if (!session || !verifyCsrf(req, res, session)) return;
  const body = await parseBody(req);
  const { leadId, subject, message } = body;
  if (!leadId || !subject || !message) {
    return sendJson(res, 400, { error: "Please provide lead ID, subject and message." });
  }

  const leads = readData("leads.json", []);
  const lead = leads.find((l) => l.id === leadId);
  if (!lead) {
    return sendJson(res, 404, { error: "Lead not found." });
  }

  try {
    const result = await sendMail({
      to: lead.email,
      subject: subject,
      html: `
        <div style="font-family: 'Outfit', sans-serif; line-height: 1.6; color: #0B1B3D; max-width: 600px; margin: 0 auto; border: 1px solid rgba(10, 25, 47, 0.08); border-radius: 16px; padding: 32px; background-color: #FCFAF7;">
          <div style="text-align: center; margin-bottom: 24px;">
            <h2 style="color: #0B1B3D; font-family: 'Playfair Display', serif; margin: 0;">Skyward Career & Placement Hub</h2>
          </div>
          <p>Dear ${lead.name},</p>
          <p>${message.replace(/\n/g, "<br>")}</p>
          <hr style="border: 0; border-top: 1px solid rgba(10, 25, 47, 0.08); margin: 32px 0;" />
          <p style="font-size: 13px; color: #4F5D73;">
            Best regards,<br/>
            <strong>Skyward Career and Placement Hub Counselling Team</strong><br/>
            Email: hello@skywardeducation.com<br/>
            Phone: +91 9241080063
          </p>
        </div>
      `,
      text: `Dear ${lead.name},\n\n${message}\n\nBest regards,\nSkyward Career and Placement Hub Counselling Team\nEmail: hello@skywardeducation.com\nPhone: +91 9241080063`
    });

    if (result.status === "skipped") {
      return sendJson(res, 400, { error: "SMTP is not configured on the server. Please verify environment settings." });
    }

    return sendJson(res, 200, { message: "Email sent successfully." });
  } catch (err) {
    return sendJson(res, 500, { error: `Failed to send email: ${err.message || err}` });
  }
}


    if (req.method === "POST" && pathname === "/api/admin/leads/sync") {
      const session = requireAdmin(req, res);
      if (!session || !verifyCsrf(req, res, session)) return;
      if (!googleSheetsWebhookUrl) {
        return sendJson(res, 400, { error: "Google Sheets is not configured yet. Add your webhook URL first." });
      }
      const leads = readData("leads.json", []);
      let synced = 0;
      let failed = 0;
      for (const lead of leads) {
        try {
          const result = await syncLeadToGoogleSheet(lead);
          lead.sheetsStatus = result.status;
          lead.sheetsSyncedAt = result.syncedAt;
          synced += 1;
        } catch {
          lead.sheetsStatus = "pending";
          failed += 1;
        }
      }
      writeData("leads.json", leads);
     return sendJson(res, 200, { synced, failed, message: `${synced} lead(s) synced to Google Sheets.` });
}
 
    if (req.method === "POST" && pathname === "/api/admin/gallery") {
      const session = requireAdmin(req, res);
      if (!session || !verifyCsrf(req, res, session)) return;
      const { fields: body, file } = await parsePostSubmission(req);
      const savedMedia = await saveUploadedMedia(file);
      if (!savedMedia || savedMedia.mediaType !== "image") {
        if (savedMedia) removeMediaFile(savedMedia.mediaUrl, uploadsDir);
        return sendJson(res, 400, { error: "Please upload a gallery image." });
      }
      const item = {
        id: crypto.randomUUID(),
        title: clean(body.title) || "Skyward Gallery",
        description: clean(body.description),
        imageUrl: savedMedia.mediaUrl,
        imageName: savedMedia.mediaName,
        createdAt: new Date().toISOString()
      };
      
      const { error: dbError } = await supabase
        .from("gallery")
        .insert([{
          id: item.id,
          title: item.title,
          description: item.description,
          image_url: item.imageUrl,
          image_name: item.imageName,
          created_at: item.createdAt
        }]);

      if (dbError) {
        console.error("Supabase gallery insert error:", dbError);
        let errorMsg = `Database save failed: ${dbError.message}`;
        if (!isServiceRoleKey(SUPABASE_KEY)) {
          errorMsg += " (WARNING: Server is not using a service_role key to bypass RLS. Please check SUPABASE_SERVICE_ROLE_KEY environment variable.)";
        }
        return sendJson(res, 500, { error: errorMsg });
      }

      try {
        const gallery = readData("gallery.json", []);
        gallery.unshift(item);
        writeData("gallery.json", gallery);
      } catch (e) {
        console.error("Local backup write failed:", e);
      }

      return sendJson(res, 201, { item });
    }

    const galleryMatch = pathname.match(/^\/api\/admin\/gallery\/([a-zA-Z0-9-]+)$/);
    if (req.method === "DELETE" && galleryMatch) {
      const session = requireAdmin(req, res);
      if (!session || !verifyCsrf(req, res, session)) return;
      const gallery = readData("gallery.json", []);
      const removedItem = gallery.find((item) => item.id === galleryMatch[1]);
      
      const { error: dbError } = await supabase
        .from("gallery")
        .delete()
        .eq("id", galleryMatch[1]);

      if (dbError) {
        return sendJson(res, 500, { error: dbError.message });
      }

      const nextGallery = gallery.filter((item) => item.id !== galleryMatch[1]);
      writeData("gallery.json", nextGallery);
      if (removedItem && removedItem.imageUrl) removeMediaFile(removedItem.imageUrl, uploadsDir);
      return sendJson(res, 200, { message: "Gallery image deleted." });
    }


    if (req.method === "POST" && pathname === "/api/admin/posts") {
      const session = requireAdmin(req, res);
      if (!session || !verifyCsrf(req, res, session)) return;
      const { fields: body, file } = await parsePostSubmission(req);
      const savedMedia = await saveUploadedMedia(file);
      
      const post = {
        id: crypto.randomUUID(),
        title: clean(body.title),
        category: clean(body.category) || "Guidance",
        description: clean(body.description),
        showApply: body.showApply === "on",
        mediaUrl: savedMedia ? savedMedia.mediaUrl : null,
        mediaType: savedMedia ? savedMedia.mediaType : null,
        mediaName: savedMedia ? savedMedia.mediaName : null,
        createdAt: new Date().toISOString()
      };

      if (!post.title || !post.description) {
        if (savedMedia) removeMediaFile(savedMedia.mediaUrl, uploadsDir);
        return sendJson(res, 400, { error: "Post title and description are required." });
      }

      const { error: dbError } = await supabase
        .from("posts")
        .insert([{
          id: post.id,
          title: post.title,
          category: post.category,
          description: post.description,
          show_apply: post.showApply,
          media_url: post.mediaUrl,
          media_type: post.mediaType,
          media_name: post.mediaName,
          created_at: post.createdAt
        }]);

      if (dbError) {
        console.error("Supabase post insert error:", dbError);
        let errorMsg = `Database save failed: ${dbError.message}`;
        if (!isServiceRoleKey(SUPABASE_KEY)) {
          errorMsg += " (WARNING: Server is not using a service_role key to bypass RLS. Please check SUPABASE_SERVICE_ROLE_KEY environment variable.)";
        }
        return sendJson(res, 500, { error: errorMsg });
      }

      try {
        const posts = readData("posts.json", defaultPosts);
        posts.unshift(post);
        writeData("posts.json", posts);
      } catch (e) {
        console.error("Local backup write failed:", e);
      }

      return sendJson(res, 201, { post });
    }

const postMatch = pathname.match(/^\/api\/admin\/posts\/([a-zA-Z0-9-]+)$/);

if (req.method === "DELETE" && postMatch) {
  const session = requireAdmin(req, res);
  if (!session || !verifyCsrf(req, res, session)) return;

  const { error } = await supabase
    .from("posts")
    .delete()
    .eq("id", postMatch[1]);

  if (error) {
    return sendJson(res, 400, { error: error.message });
  }

  return sendJson(res, 200, {
    message: "Post deleted."
  });
}

    // ==================== JOB PORTAL API ROUTES ====================

    // --- Public: List jobs with search/filter ---
    if (req.method === "GET" && pathname === "/api/jobs") {
      const url = new URL(req.url, "http://localhost");
      const q = (url.searchParams.get("q") || "").trim().toLowerCase();
      const company = (url.searchParams.get("company") || "").trim().toLowerCase();
      const loc = (url.searchParams.get("location") || "").trim().toLowerCase();
      const categorySlug = url.searchParams.get("category") || "";
      const salaryMin = parseInt(url.searchParams.get("salaryMin")) || 0;
      const salaryMax = parseInt(url.searchParams.get("salaryMax")) || 0;
      const empType = url.searchParams.get("type") || "";
      const workMode = url.searchParams.get("mode") || "";
      const level = url.searchParams.get("level") || "";
      const page = Math.max(1, parseInt(url.searchParams.get("page")) || 1);
      const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get("limit")) || 12));
      const offset = (page - 1) * limit;

      let query = supabase
        .from("jobs")
        .select("*, job_categories(name, slug)", { count: "exact" })
        .eq("is_active", true)
        .order("is_featured", { ascending: false })
        .order("created_at", { ascending: false });

      if (empType) query = query.eq("employment_type", empType);
      if (workMode) query = query.eq("work_mode", workMode);
      if (level && level !== "Both") query = query.or(`experience_level.eq.${level},experience_level.eq.Both`);
      if (salaryMin > 0) query = query.gte("salary_max", salaryMin);
      if (salaryMax > 0) query = query.lte("salary_min", salaryMax);

      query = query.range(offset, offset + limit - 1);

      const { data: jobs, error, count } = await query;
      if (error) return sendJson(res, 500, { error: error.message });

      let filtered = jobs || [];
      if (q) filtered = filtered.filter(j => j.title.toLowerCase().includes(q) || (j.description || "").toLowerCase().includes(q) || (j.skills_required || []).some(s => s.toLowerCase().includes(q)));
      if (company) filtered = filtered.filter(j => j.company_name.toLowerCase().includes(company));
      if (loc) filtered = filtered.filter(j => j.location.toLowerCase().includes(loc));
      if (categorySlug) filtered = filtered.filter(j => j.job_categories && j.job_categories.slug === categorySlug);

      return sendJson(res, 200, { jobs: filtered, total: count || 0, page, limit });
    }

    // --- Public: Get single job by slug ---
    const jobSlugMatch = pathname.match(/^\/api\/jobs\/([a-z0-9-]+)$/);
    if (req.method === "GET" && jobSlugMatch && !pathname.includes("/apply")) {
      const slug = jobSlugMatch[1];
      const { data: job, error } = await supabase
        .from("jobs")
        .select("*, job_categories(name, slug)")
        .eq("slug", slug)
        .eq("is_active", true)
        .single();
      if (error || !job) return sendJson(res, 404, { error: "Job not found." });
      return sendJson(res, 200, { job });
    }

    // --- Public: Get job categories ---
    if (req.method === "GET" && pathname === "/api/job-categories") {
      const { data, error } = await supabase
        .from("job_categories")
        .select("*")
        .order("name");
      if (error) return sendJson(res, 500, { error: error.message });
      return sendJson(res, 200, { categories: data || [] });
    }

    // --- Public: Submit job application ---
    const applyMatch = pathname.match(/^\/api\/jobs\/([a-zA-Z0-9-]+)\/apply$/);
    if (req.method === "POST" && applyMatch) {
      const jobId = applyMatch[1];
      const contentType = req.headers["content-type"] || "";
      if (!contentType.startsWith("multipart/form-data")) {
        return sendJson(res, 400, { error: "Invalid request format. Multipart form data required." });
      }
      const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
      if (!boundaryMatch) return sendJson(res, 400, { error: "Invalid upload format." });
      const raw = req.bodyBuffer || await readBody(req, MAX_RESUME_SIZE + MAX_BODY_SIZE);
      const { fields, files } = parseMultipartFiles(raw, boundaryMatch[1] || boundaryMatch[2]);

      // Honeypot
      if (clean(fields.website)) return sendJson(res, 201, { message: "Application submitted successfully.", applicationId: "SKY-0000-0000" });

      // Validate required fields
      const fullName = clean(fields.full_name);
      const mobile = clean(fields.mobile);
      const email = clean(fields.email);
      const highestQualification = clean(fields.highest_qualification);
      const employmentStatus = clean(fields.employment_status) || "Fresher";

      if (!fullName || !mobile || !email || !highestQualification) {
        return sendJson(res, 400, { error: "Please provide your name, mobile, email and qualification." });
      }
      if (!validEmail(email)) return sendJson(res, 400, { error: "Please provide a valid email address." });

      // Check terms accepted
      if (fields.terms_accepted !== "true" && fields.terms_accepted !== "on") {
        return sendJson(res, 400, { error: "You must accept the placement terms and conditions." });
      }

      // Verify job exists
      const { data: jobCheck, error: jobCheckErr } = await supabase
        .from("jobs").select("id, title, company_name").eq("id", jobId).eq("is_active", true).single();
      if (jobCheckErr || !jobCheck) return sendJson(res, 404, { error: "This job is no longer available." });

      // Upload resume
      let resumeData = null;
      if (fields.uploaded_resume_url && fields.uploaded_resume_name) {
        resumeData = {
          resumeUrl: fields.uploaded_resume_url,
          resumeName: fields.uploaded_resume_name
        };
      } else if (files.resume) {
        resumeData = await saveUploadedResume(files.resume);
      }

      // Upload company logo for application if needed (not used here)
      const applicationId = await generateApplicationId();
      const clientIp = getClientIp(req);

      const application = {
        application_id: applicationId,
        job_id: jobId,
        full_name: fullName,
        mobile: mobile,
        whatsapp: clean(fields.whatsapp),
        email: email,
        gender: clean(fields.gender),
        dob: fields.dob || null,
        current_location: clean(fields.current_location),
        highest_qualification: highestQualification,
        course_name: clean(fields.course_name),
        college: clean(fields.college),
        passing_year: parseInt(fields.passing_year) || null,
        percentage: parseFloat(fields.percentage) || null,
        employment_status: employmentStatus,
        current_company: employmentStatus === "Experienced" ? clean(fields.current_company) : null,
        previous_company: employmentStatus === "Experienced" ? clean(fields.previous_company) : null,
        total_experience: employmentStatus === "Experienced" ? clean(fields.total_experience) : null,
        current_salary: employmentStatus === "Experienced" ? clean(fields.current_salary) : null,
        expected_salary: employmentStatus === "Experienced" ? clean(fields.expected_salary) : null,
        notice_period: employmentStatus === "Experienced" ? clean(fields.notice_period) : null,
        current_designation: employmentStatus === "Experienced" ? clean(fields.current_designation) : null,
        resume_url: resumeData ? resumeData.resumeUrl : null,
        resume_name: resumeData ? resumeData.resumeName : null,
        skills: clean(fields.skills),
        certifications: clean(fields.certifications),
        linkedin_url: clean(fields.linkedin_url),
        portfolio_url: clean(fields.portfolio_url),
        cover_letter: clean(fields.cover_letter),
        terms_accepted: true,
        terms_accepted_at: new Date().toISOString(),
        applicant_ip: clientIp,
        status: "New",
        created_at: new Date().toISOString()
      };

      const { error: insertErr } = await supabase.from("job_applications").insert([application]);
      if (insertErr) return sendJson(res, 500, { error: `Application failed: ${insertErr.message}` });

      // Send confirmation email
      const confirmHtml = `
        <div style="font-family: 'Outfit', sans-serif; line-height: 1.6; color: #0B1B3D; max-width: 600px; margin: 0 auto; border: 1px solid rgba(10, 25, 47, 0.08); border-radius: 16px; padding: 32px; background-color: #FCFAF7;">
          <div style="text-align: center; margin-bottom: 24px;">
            <h2 style="color: #0B1B3D; font-family: 'Playfair Display', serif; margin: 0;">Skyward Career & Placement Hub</h2>
          </div>
          <p>Dear ${fullName},</p>
          <p>Your application has been successfully submitted!</p>
          <div style="background-color: rgba(10, 25, 47, 0.03); border-radius: 12px; padding: 20px; margin: 20px 0; border: 1px solid rgba(10, 25, 47, 0.06);">
            <h3 style="margin-top: 0; font-size: 16px;">Application Details:</h3>
            <table cellpadding="4" cellspacing="0" style="font-size: 14px;">
              <tr><td><strong>Application ID:</strong></td><td style="color: #D4AF37; font-weight: 700;">${applicationId}</td></tr>
              <tr><td><strong>Position:</strong></td><td>${jobCheck.title}</td></tr>
              <tr><td><strong>Company:</strong></td><td>${jobCheck.company_name}</td></tr>
            </table>
          </div>
          <p>Our placement team will review your application and contact you shortly.</p>
          <hr style="border: 0; border-top: 1px solid rgba(10, 25, 47, 0.08); margin: 32px 0;" />
          <p style="font-size: 13px; color: #4F5D73;">Best regards,<br/><strong>Skyward Career and Placement Hub</strong><br/>Phone: +91 9241080063</p>
        </div>
      `;
      sendMail({ to: email, subject: `Application Received: ${applicationId} | ${jobCheck.title}`, html: confirmHtml, text: `Dear ${fullName}, Your application (${applicationId}) for ${jobCheck.title} at ${jobCheck.company_name} has been received. Our placement team will contact you shortly.` }).catch(e => console.error("App confirm email failed:", e));

      // SMS alert
      sendSmsAlert(`New Job Application: ${fullName} applied for ${jobCheck.title} at ${jobCheck.company_name}. ID: ${applicationId}`).catch(e => console.error("App SMS failed:", e));

      return sendJson(res, 201, { message: "Application submitted successfully!", applicationId });
    }

    // --- Public: Secure instant resume upload ---
    if (req.method === "POST" && pathname === "/api/upload-resume") {
      const contentType = req.headers["content-type"] || "";
      if (!contentType.startsWith("multipart/form-data")) {
        return sendJson(res, 400, { error: "Invalid request format. Multipart form data required." });
      }
      const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
      if (!boundaryMatch) return sendJson(res, 400, { error: "Invalid upload format." });
      const raw = req.bodyBuffer || await readBody(req, MAX_RESUME_SIZE + MAX_BODY_SIZE);
      const { fields, files } = parseMultipartFiles(raw, boundaryMatch[1] || boundaryMatch[2]);

      // Honeypot check
      if (clean(fields.website)) {
        return sendJson(res, 201, { resumeUrl: "https://example.com/dummy-resume.pdf", resumeName: "resume.pdf" });
      }

      if (!files.resume) {
        return sendJson(res, 400, { error: "No resume file uploaded." });
      }

      try {
        const resumeData = await saveUploadedResume(files.resume);
        if (!resumeData) {
          return sendJson(res, 400, { error: "Upload failed. Please try a different file." });
        }
        return sendJson(res, 200, {
          resumeUrl: resumeData.resumeUrl,
          resumeName: resumeData.resumeName
        });
      } catch (err) {
        return sendJson(res, 400, { error: err.message || "Failed to upload resume." });
      }
    }

    // --- Public: Placement terms ---
    if (req.method === "GET" && pathname === "/api/placement/terms") {
      const { data, error } = await supabase.from("placement_settings").select("terms_content").limit(1).single();
      return sendJson(res, 200, { content: data ? data.terms_content : "" });
    }

    if (req.method === "GET" && pathname === "/api/placement/policy") {
      const { data, error } = await supabase.from("placement_settings").select("policy_content").limit(1).single();
      return sendJson(res, 200, { content: data ? data.policy_content : "" });
    }

    // --- Admin: List all jobs ---
    if (req.method === "GET" && pathname === "/api/admin/jobs") {
      const session = requireSession(req, res);
      if (!session) return;
      const { data, error } = await supabase
        .from("jobs")
        .select("*, job_categories(name, slug)")
        .order("created_at", { ascending: false });
      if (error) return sendJson(res, 500, { error: error.message });
      return sendJson(res, 200, { jobs: data || [] });
    }

    // --- Admin: Create job ---
    if (req.method === "POST" && pathname === "/api/admin/jobs") {
      const session = requireSession(req, res);
      if (!session || !verifyCsrf(req, res, session)) return;
      const { fields: body, file } = await parsePostSubmission(req);
      const savedLogo = await saveUploadedMedia(file);

      const title = clean(body.title);
      const companyName = clean(body.company_name);
      if (!title || !companyName) return sendJson(res, 400, { error: "Job title and company name are required." });

      let slug = slugify(`${title}-${companyName}`);
      // Check slug uniqueness
      const { data: existingSlug } = await supabase.from("jobs").select("id").eq("slug", slug).limit(1);
      if (existingSlug && existingSlug.length > 0) slug = `${slug}-${Date.now().toString(36)}`;

      const skillsRaw = clean(body.skills_required);
      const skills = skillsRaw ? skillsRaw.split(",").map(s => s.trim()).filter(Boolean) : [];

      const job = {
        title,
        slug,
        company_name: companyName,
        company_logo_url: savedLogo ? savedLogo.mediaUrl : null,
        location: clean(body.location) || "India",
        salary_min: parseInt(body.salary_min) || 0,
        salary_max: parseInt(body.salary_max) || 0,
        salary_period: clean(body.salary_period) || "Yearly",
        experience_min: parseInt(body.experience_min) || 0,
        experience_max: parseInt(body.experience_max) || 0,
        employment_type: clean(body.employment_type) || "Full-Time",
        work_mode: clean(body.work_mode) || "Work From Office",
        category_id: body.category_id || null,
        description: clean(body.description),
        skills_required: skills,
        openings: parseInt(body.openings) || 1,
        last_date: body.last_date || null,
        is_featured: body.is_featured === "on" || body.is_featured === "true",
        is_active: true,
        experience_level: clean(body.experience_level) || "Both",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const { data: created, error } = await supabase.from("jobs").insert([job]).select().single();
      if (error) return sendJson(res, 500, { error: `Failed to create job: ${error.message}` });
      return sendJson(res, 201, { job: created });
    }

    // --- Admin: Update job ---
    const adminJobMatch = pathname.match(/^\/api\/admin\/jobs\/([a-zA-Z0-9-]+)$/);
    if (req.method === "PUT" && adminJobMatch) {
      const session = requireSession(req, res);
      if (!session || !verifyCsrf(req, res, session)) return;
      const jobId = adminJobMatch[1];
      const { fields: body, file } = await parsePostSubmission(req);
      const savedLogo = await saveUploadedMedia(file);

      const updates = { updated_at: new Date().toISOString() };
      if (body.title) updates.title = clean(body.title);
      if (body.company_name) updates.company_name = clean(body.company_name);
      if (savedLogo) updates.company_logo_url = savedLogo.mediaUrl;
      if (body.location) updates.location = clean(body.location);
      if (body.salary_min !== undefined) updates.salary_min = parseInt(body.salary_min) || 0;
      if (body.salary_max !== undefined) updates.salary_max = parseInt(body.salary_max) || 0;
      if (body.salary_period) updates.salary_period = clean(body.salary_period);
      if (body.experience_min !== undefined) updates.experience_min = parseInt(body.experience_min) || 0;
      if (body.experience_max !== undefined) updates.experience_max = parseInt(body.experience_max) || 0;
      if (body.employment_type) updates.employment_type = clean(body.employment_type);
      if (body.work_mode) updates.work_mode = clean(body.work_mode);
      if (body.category_id) updates.category_id = body.category_id;
      if (body.description) updates.description = clean(body.description);
      if (body.skills_required) updates.skills_required = clean(body.skills_required).split(",").map(s => s.trim()).filter(Boolean);
      if (body.openings !== undefined) updates.openings = parseInt(body.openings) || 1;
      if (body.last_date) updates.last_date = body.last_date;
      if (body.is_featured !== undefined) updates.is_featured = body.is_featured === "on" || body.is_featured === "true";
      if (body.is_active !== undefined) updates.is_active = body.is_active === "on" || body.is_active === "true";
      if (body.experience_level) updates.experience_level = clean(body.experience_level);

      const { data, error } = await supabase.from("jobs").update(updates).eq("id", jobId).select().single();
      if (error) return sendJson(res, 500, { error: error.message });
      return sendJson(res, 200, { job: data });
    }

    // --- Admin: Delete job ---
    if (req.method === "DELETE" && adminJobMatch) {
      const session = requireSession(req, res);
      if (!session || !verifyCsrf(req, res, session)) return;
      const { error } = await supabase.from("jobs").delete().eq("id", adminJobMatch[1]);
      if (error) return sendJson(res, 500, { error: error.message });
      return sendJson(res, 200, { message: "Job deleted." });
    }

    // --- Admin: Toggle job active/featured ---
    const toggleMatch = pathname.match(/^\/api\/admin\/jobs\/([a-zA-Z0-9-]+)\/toggle$/);
    if (req.method === "PATCH" && toggleMatch) {
      const session = requireSession(req, res);
      if (!session || !verifyCsrf(req, res, session)) return;
      const body = await parseBody(req);
      const updates = { updated_at: new Date().toISOString() };
      if (body.is_active !== undefined) updates.is_active = Boolean(body.is_active);
      if (body.is_featured !== undefined) updates.is_featured = Boolean(body.is_featured);
      const { data, error } = await supabase.from("jobs").update(updates).eq("id", toggleMatch[1]).select().single();
      if (error) return sendJson(res, 500, { error: error.message });
      return sendJson(res, 200, { job: data });
    }

    // --- Admin: List all applications ---
    if (req.method === "GET" && pathname === "/api/admin/applications") {
      const session = requireSession(req, res);
      if (!session) return;
      const url = new URL(req.url, "http://localhost");
      let query = supabase
        .from("job_applications")
        .select("*, jobs(title, company_name)")
        .order("created_at", { ascending: false });

      const jobFilter = url.searchParams.get("job_id");
      const statusFilter = url.searchParams.get("status");
      const levelFilter = url.searchParams.get("level");
      if (jobFilter) query = query.eq("job_id", jobFilter);
      if (statusFilter) query = query.eq("status", statusFilter);
      if (levelFilter) query = query.eq("employment_status", levelFilter);

      const { data, error } = await query;
      if (error) return sendJson(res, 500, { error: error.message });
      return sendJson(res, 200, { applications: data || [] });
    }

    // --- Admin: Update application status ---
    const appStatusMatch = pathname.match(/^\/api\/admin\/applications\/([a-zA-Z0-9-]+)\/status$/);
    if (req.method === "PATCH" && appStatusMatch) {
      const session = requireSession(req, res);
      if (!session || !verifyCsrf(req, res, session)) return;
      const body = await parseBody(req);
      const validStatuses = ["New", "Shortlisted", "Interview Scheduled", "Selected", "Rejected", "Joined"];
      if (!validStatuses.includes(body.status)) return sendJson(res, 400, { error: "Invalid status." });
      const { data, error } = await supabase.from("job_applications").update({ status: body.status }).eq("id", appStatusMatch[1]).select().single();
      if (error) return sendJson(res, 500, { error: error.message });
      return sendJson(res, 200, { application: data });
    }

    // --- Admin: Job analytics ---
    if (req.method === "GET" && pathname === "/api/admin/job-analytics") {
      const session = requireSession(req, res);
      if (!session) return;
      const [jobsRes, activeRes, appsRes, selectedRes, joinedRes] = await Promise.all([
        supabase.from("jobs").select("*", { count: "exact", head: true }),
        supabase.from("jobs").select("*", { count: "exact", head: true }).eq("is_active", true),
        supabase.from("job_applications").select("*", { count: "exact", head: true }),
        supabase.from("job_applications").select("*", { count: "exact", head: true }).eq("status", "Selected"),
        supabase.from("job_applications").select("*", { count: "exact", head: true }).eq("status", "Joined")
      ]);
      const totalJobs = jobsRes.count || 0;
      const activeJobs = activeRes.count || 0;
      const totalApps = appsRes.count || 0;
      const selected = selectedRes.count || 0;
      const joined = joinedRes.count || 0;
      const conversionRate = totalApps > 0 ? (((selected + joined) / totalApps) * 100).toFixed(1) : "0.0";
      return sendJson(res, 200, { totalJobs, activeJobs, totalApplications: totalApps, selected: selected + joined, conversionRate: `${conversionRate}%` });
    }

    // --- Admin: Add category ---
    if (req.method === "POST" && pathname === "/api/admin/job-categories") {
      const session = requireSession(req, res);
      if (!session || !verifyCsrf(req, res, session)) return;
      const body = await parseBody(req);
      const name = clean(body.name);
      if (!name) return sendJson(res, 400, { error: "Category name is required." });
      const slug = slugify(name);
      const { data, error } = await supabase.from("job_categories").insert([{ name, slug }]).select().single();
      if (error) return sendJson(res, 500, { error: error.message });
      return sendJson(res, 201, { category: data });
    }

    // --- Admin: Delete category ---
    const catDelMatch = pathname.match(/^\/api\/admin\/job-categories\/([a-zA-Z0-9-]+)$/);
    if (req.method === "DELETE" && catDelMatch) {
      const session = requireSession(req, res);
      if (!session || !verifyCsrf(req, res, session)) return;
      const { error } = await supabase.from("job_categories").delete().eq("id", catDelMatch[1]);
      if (error) return sendJson(res, 500, { error: error.message });
      return sendJson(res, 200, { message: "Category deleted." });
    }

    // --- Admin: Update placement terms ---
    if (req.method === "PUT" && pathname === "/api/admin/placement/terms") {
      const session = requireAdmin(req, res);
      if (!session || !verifyCsrf(req, res, session)) return;
      const body = await parseBody(req);
      const { data: existing } = await supabase.from("placement_settings").select("id").limit(1).single();
      if (existing) {
        await supabase.from("placement_settings").update({ terms_content: clean(body.content), updated_at: new Date().toISOString() }).eq("id", existing.id);
      } else {
        await supabase.from("placement_settings").insert([{ terms_content: clean(body.content) }]);
      }
      return sendJson(res, 200, { message: "Terms updated." });
    }

    // --- Admin: Update placement policy ---
    if (req.method === "PUT" && pathname === "/api/admin/placement/policy") {
      const session = requireAdmin(req, res);
      if (!session || !verifyCsrf(req, res, session)) return;
      const body = await parseBody(req);
      const { data: existing } = await supabase.from("placement_settings").select("id").limit(1).single();
      if (existing) {
        await supabase.from("placement_settings").update({ policy_content: clean(body.content), updated_at: new Date().toISOString() }).eq("id", existing.id);
      } else {
        await supabase.from("placement_settings").insert([{ policy_content: clean(body.content) }]);
      }
      return sendJson(res, 200, { message: "Policy updated." });
    }

    sendJson(res, 404, { error: "Endpoint not found." });
  }

  function serveStatic(res, pathname) {
    const mediaMatch = pathname.match(/^\/media\/([a-f0-9-]+\.(?:jpg|png|webp|gif|mp4|webm))$/i);
    if (mediaMatch) {
      const mediaPath = path.join(uploadsDir, mediaMatch[1]);
      if (fs.existsSync(mediaPath) && fs.statSync(mediaPath).isFile()) return sendFile(res, mediaPath, 200);
      return sendFile(res, path.join(PUBLIC_DIR, "404.html"), 404);
    }
    const pagePaths = {
      "/": "index.html", "/about": "about.html", "/contact": "contact.html", "/admin": "admin.html",
      "/jobs": "jobs.html", "/terms": "terms.html", "/placement-policy": "placement-policy.html"
    };
    // Handle /jobs/some-slug → job-detail.html
    if (pathname.startsWith("/jobs/") && pathname !== "/jobs/") {
      return sendFile(res, path.join(PUBLIC_DIR, "job-detail.html"), 200);
    }
    const relative = pagePaths[pathname] || pathname.replace(/^\/+/, "");
    const target = path.resolve(PUBLIC_DIR, relative);
    if (!target.startsWith(`${PUBLIC_DIR}${path.sep}`) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
      return sendFile(res, path.join(PUBLIC_DIR, "404.html"), 404);
    }
    sendFile(res, target, 200);
  }

  return http.createServer(async (req, res) => {
    // Basic Security Headers
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; img-src 'self' data: https:; media-src 'self' https:; connect-src 'self'; form-action 'self'; base-uri 'self'; frame-ancestors 'none'; upgrade-insecure-requests;"
    );
    res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
    res.setHeader("Permissions-Policy", "geolocation=(), camera=(), microphone=(), interest-cohort=()");

    const pathname = new URL(req.url, "http://localhost").pathname;
    
    if (req.headers['x-forwarded-proto'] && req.headers['x-forwarded-proto'] !== 'https') {
      res.writeHead(301, { 'Location': `https://${req.headers.host}${req.url}` });
      return res.end();
    }

    const ip = getClientIp(req);

    // 1. Global Rate Limiter
    if (globalLimiter.isLimitExceeded(ip)) {
      console.warn(`[RateLimit] Global limit exceeded for IP: ${ip}`);
      return sendJson(res, 429, { error: "Too many requests. Please try again later." });
    }

    // Read body buffer globally if POST/PUT
    let bodyBuffer = null;
    if (req.method === "POST" || req.method === "PUT") {
      try {
        const isUpload = pathname.startsWith("/api/admin/posts") || pathname.startsWith("/api/admin/gallery") || pathname.startsWith("/api/admin/jobs");
        const isApply = pathname.match(/^\/api\/jobs\/[a-zA-Z0-9-]+\/apply$/) || pathname === "/api/upload-resume";
        const uploadLimit = isApply ? MAX_RESUME_SIZE + MAX_BODY_SIZE : (isUpload ? MAX_UPLOAD_SIZE + MAX_BODY_SIZE : MAX_BODY_SIZE);
        bodyBuffer = await readBody(req, uploadLimit);
        req.bodyBuffer = bodyBuffer; // Store on request for parser use
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }

    // 2. Web Application Firewall (WAF) checks
    if (WebApplicationFirewall.isSuspiciousRequest(req, pathname, bodyBuffer)) {
      console.warn(`[WAF] Rejection triggered for IP: ${ip} on path: ${pathname}`);
      return sendJson(res, 403, { error: "Forbidden: Suspicious request detected." });
    }

    // 3. Specific Endpoint Rate Limits
    if (pathname === "/api/admin/login" && req.method === "POST") {
      if (loginLimiter.isLimitExceeded(ip)) {
        console.warn(`[RateLimit] Login limit exceeded for IP: ${ip}`);
        return sendJson(res, 429, { error: "Too many login attempts. Please try again in 15 minutes." });
      }
    }

    if (pathname === "/api/leads" && req.method === "POST") {
      if (leadsLimiter.isLimitExceeded(ip)) {
        console.warn(`[RateLimit] Leads limit exceeded for IP: ${ip}`);
        return sendJson(res, 429, { error: "Too many form submissions. Please try again in an hour." });
      }
    }

    if ((pathname.match(/^\/api\/jobs\/[a-zA-Z0-9-]+\/apply$/) || pathname === "/api/upload-resume") && req.method === "POST") {
      if (applyLimiter.isLimitExceeded(ip)) {
        console.warn(`[RateLimit] Application limit exceeded for IP: ${ip}`);
        return sendJson(res, 429, { error: "Too many applications submitted. Please try again in an hour." });
      }
    }

    try {
      if (pathname.startsWith("/api/")) return await handleApi(req, res, pathname);
      if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, { error: "Method not allowed." });
      serveStatic(res, pathname);
    } catch (error) {
      console.error("Error handling request:", error);
      const inputError = /(large|format|Upload a|smaller than|Supabase)/.test(error.message);
      const status = inputError ? 400 : 500;
      sendJson(res, status, { error: status === 500 ? "Something went wrong. Please try again." : error.message });
    }
  });
}

function clean(value) {
  return String(value || "").trim().slice(0, 2000);
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function ensureStore(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(dataDir, "uploads"), { recursive: true });
  const postsPath = path.join(dataDir, "posts.json");
  const leadsPath = path.join(dataDir, "leads.json");
  const galleryPath = path.join(dataDir, "gallery.json");
  const contentPath = path.join(dataDir, "content.json");
  if (!fs.existsSync(postsPath)) fs.writeFileSync(postsPath, `${JSON.stringify(defaultPosts, null, 2)}\n`, "utf8");
  if (!fs.existsSync(leadsPath)) fs.writeFileSync(leadsPath, "[]\n", "utf8");
  if (!fs.existsSync(galleryPath)) fs.writeFileSync(galleryPath, "[]\n", "utf8");
  if (!fs.existsSync(contentPath)) fs.writeFileSync(contentPath, "{}\n", "utf8");
}

function parseMultipart(buffer, boundary) {
  const delimiter = Buffer.from(`--${boundary}`);
  const parts = [];
  let start = buffer.indexOf(delimiter) + delimiter.length;
  while (start >= delimiter.length) {
    if (buffer.subarray(start, start + 2).toString() === "--") break;
    if (buffer.subarray(start, start + 2).toString() === "\r\n") start += 2;
    const end = buffer.indexOf(delimiter, start);
    if (end === -1) break;
    parts.push(buffer.subarray(start, end - 2));
    start = end + delimiter.length;
  }

  const fields = {};
  let file = null;
  for (const part of parts) {
    const separator = part.indexOf(Buffer.from("\r\n\r\n"));
    if (separator === -1) continue;
    const headers = part.subarray(0, separator).toString("utf8");
    const data = part.subarray(separator + 4);
    const name = headers.match(/name="([^"]+)"/i)?.[1];
    const fileName = headers.match(/filename="([^"]*)"/i)?.[1];
    if (!name) continue;
    if (fileName && name === "media") {
      const contentType = headers.match(/content-type:\s*([^\r\n]+)/i)?.[1].trim().toLowerCase();
      file = { fileName, contentType, data };
    } else {
      fields[name] = data.toString("utf8");
    }
  }
  return { fields, file };
}

function removeMediaFile(mediaUrl, uploadsDir) {
  const fileName = path.basename(mediaUrl || "");
  const target = path.join(uploadsDir, fileName);
  if (fileName && fs.existsSync(target)) fs.unlinkSync(target);
}

function sendFile(res, target, status) {
  const mimeTypes = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".mp4": "video/mp4",
    ".webm": "video/webm"
  };
  const contents = fs.readFileSync(target);
  res.writeHead(status, {
    "Content-Type": mimeTypes[path.extname(target)] || "application/octet-stream",
    "Content-Length": contents.length
  });
  res.end(contents);
}

const app = createApp();

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;

  app.listen(port, () => {
    console.log(`Skyward website running at http://localhost:${port}`);

    if (!process.env.ADMIN_PASSWORD) {
      console.log(
        "Admin demo login: admin@skywardeducation.com / ChangeMe123! (change before publishing)"
      );
    }
  });
}

app.createApp = createApp;
module.exports = app;
