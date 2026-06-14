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


const SUPPORTED_MEDIA = {
  "image/jpeg": { extension: ".jpg", type: "image" },
  "image/png": { extension: ".png", type: "image" },
  "image/webp": { extension: ".webp", type: "image" },
  "image/gif": { extension: ".gif", type: "image" },
  "video/mp4": { extension: ".mp4", type: "video" },
  "video/webm": { extension: ".webm", type: "video" }
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
  const sessionSecret = options.sessionSecret || process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
  const googleSheetsWebhookUrl = options.googleSheetsWebhookUrl || process.env.GOOGLE_SHEETS_WEBHOOK_URL || "";
  const googleSheetsSecret = options.googleSheetsSecret || process.env.GOOGLE_SHEETS_SECRET || "";
  const externalFetch = options.fetchImpl || fetch;
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false },
    global: { fetch: externalFetch }
  });
  const sessions = new Map();
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
  const twilioWhatsappFrom = options.twilioWhatsappFrom !== undefined ? options.twilioWhatsappFrom : (process.env.TWILIO_WHATSAPP_FROM || "");
  const companyWhatsappNumber = options.companyWhatsappNumber !== undefined ? options.companyWhatsappNumber : (process.env.COMPANY_WHATSAPP_NUMBER || "");

  let twilioClient = null;
  if (twilioAccountSid && twilioAccountSid.startsWith("AC") && twilioAuthToken) {
    twilioClient = twilio(twilioAccountSid, twilioAuthToken);
  } else {
    console.warn("⚠️ Twilio environment variables are not fully configured or are invalid (Account SID must start with 'AC'). WhatsApp alerts will be skipped.");
  }

  async function sendWhatsappAlert(messageText) {
    if (!twilioClient || !twilioWhatsappFrom || !companyWhatsappNumber) {
      console.warn("⚠️ Skipped sending WhatsApp alert (Twilio client/numbers not configured). Message: " + messageText);
      return { status: "skipped", reason: "twilio_not_configured" };
    }
    
    // Auto-prefix "whatsapp:" if missing
    const fromNumber = twilioWhatsappFrom.startsWith("whatsapp:") ? twilioWhatsappFrom : `whatsapp:${twilioWhatsappFrom}`;
    const toNumber = companyWhatsappNumber.startsWith("whatsapp:") ? companyWhatsappNumber : `whatsapp:${companyWhatsappNumber}`;
    
    try {
      const response = await twilioClient.messages.create({
        body: messageText,
        from: fromNumber,
        to: toNumber
      });
      console.log(`💬 WhatsApp alert sent successfully! Message SID: ${response.sid}`);
      return { status: "sent", sid: response.sid };
    } catch (error) {
      console.error("❌ Failed to send WhatsApp alert:", error);
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
    const raw = (await readBody(req)).toString("utf8");
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
    const raw = await readBody(req, MAX_UPLOAD_SIZE + MAX_BODY_SIZE);
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

  function requireAdmin(req, res) {
    const session = currentSession(req);
    if (!session) {
      sendJson(res, 401, { error: "Please log in to continue." });
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

      // Send automated WhatsApp alert to the company
      const whatsappText = `🔔 *New Consultation Lead Received!*\n\n*Student Name:* ${lead.name}\n*Email:* ${lead.email}\n*Phone:* ${lead.phone}\n*Service Requested:* ${lead.service}\n*Destination Choice:* ${lead.destination || "Not specified"}\n*Enquiry Source:* ${lead.source}\n\n*Message:*\n"${lead.message || "No additional message"}"`;
      sendWhatsappAlert(whatsappText).catch((err) => {
        console.error("Failed to send WhatsApp notification alert:", err);
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
      if (clean(body.email).toLowerCase() !== adminEmail || !safeEqual(clean(body.password), adminPassword)) {
        return sendJson(res, 401, { error: "Incorrect email or password." });
      }
      const token = crypto.randomBytes(32).toString("hex");
      const csrfToken = crypto.randomBytes(24).toString("hex");
      sessions.set(token, { csrfToken, expiresAt: Date.now() + SESSION_MAX_AGE, email: adminEmail });
      res.setHeader(
        "Set-Cookie",
        `skyward_session=${token}.${sign(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MAX_AGE / 1000}`
      );
      return sendJson(res, 200, { email: adminEmail, csrfToken });
    }

    if (req.method === "GET" && pathname === "/api/admin/session") {
      const session = currentSession(req);
      if (!session) return sendJson(res, 401, { authenticated: false });
      return sendJson(res, 200, { authenticated: true, email: session.email, csrfToken: session.csrfToken });
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

sendJson(res, 404, { error: "Endpoint not found." });
  }

  function serveStatic(res, pathname) {
    const mediaMatch = pathname.match(/^\/media\/([a-f0-9-]+\.(?:jpg|png|webp|gif|mp4|webm))$/i);
    if (mediaMatch) {
      const mediaPath = path.join(uploadsDir, mediaMatch[1]);
      if (fs.existsSync(mediaPath) && fs.statSync(mediaPath).isFile()) return sendFile(res, mediaPath, 200);
      return sendFile(res, path.join(PUBLIC_DIR, "404.html"), 404);
    }
    const pagePaths = { "/": "index.html", "/about": "about.html", "/contact": "contact.html", "/admin": "admin.html" };
    const relative = pagePaths[pathname] || pathname.replace(/^\/+/, "");
    const target = path.resolve(PUBLIC_DIR, relative);
    if (!target.startsWith(`${PUBLIC_DIR}${path.sep}`) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
      return sendFile(res, path.join(PUBLIC_DIR, "404.html"), 404);
    }
    sendFile(res, target, 200);
  }

  return http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; img-src 'self' data: https:; media-src 'self' https:; connect-src 'self'; form-action 'self'; base-uri 'self'; frame-ancestors 'none'; upgrade-insecure-requests;"
    );
    const pathname = new URL(req.url, "http://localhost").pathname;
    
    if (req.headers['x-forwarded-proto'] && req.headers['x-forwarded-proto'] !== 'https') {
      res.writeHead(301, { 'Location': `https://${req.headers.host}${req.url}` });
      return res.end();
    }
    try {
      if (pathname.startsWith("/api/")) return await handleApi(req, res, pathname);
      if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, { error: "Method not allowed." });
      serveStatic(res, pathname);
    } catch (error) {
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
