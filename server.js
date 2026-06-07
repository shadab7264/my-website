"use strict";

const nodemailer = require("nodemailer");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");
const { createClient } = require("@supabase/supabase-js");

const ROOT_DIR = process.cwd();
const supabase = createClient(
  "https://ctprrqxqiwmzcjsacsmn.supabase.co",
  "sb_publishable_1DEtfIZ7bwt1xNT3gcbBDw_g5HYVNni"
);

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
    id: "welcome-counselling",
    title: "Build a study path with clarity",
    category: "Admissions",
    description:
      "Our counsellors map your academic profile, budget and career ambition to universities where you can thrive.",
    createdAt: "2026-05-20T09:00:00.000Z"
  },
  {
    id: "scholarship-strategy",
    title: "Plan early for scholarships",
    category: "Funding",
    description:
      "A focused application calendar, strong statement of purpose and timely document preparation can unlock better funding options.",
    createdAt: "2026-05-18T09:00:00.000Z"
  },
  {
    id: "visa-preparation",
    title: "Visa guidance made simpler",
    category: "Visa Support",
    description:
      "Prepare finances, documentation and interview confidence with experts who understand every milestone of your journey.",
    createdAt: "2026-05-15T09:00:00.000Z"
  }
];

function createApp(options = {}) {
  const dataDir = options.dataDir || process.env.DATA_DIR || DEFAULT_DATA_DIR;
  const adminEmail = (options.adminEmail || process.env.ADMIN_EMAIL || "admin@skywardeducation.com").toLowerCase();
  const adminPassword = options.adminPassword || process.env.ADMIN_PASSWORD || "ChangeMe123!";
  const sessionSecret = options.sessionSecret || process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
  const googleSheetsWebhookUrl = options.googleSheetsWebhookUrl || process.env.GOOGLE_SHEETS_WEBHOOK_URL || "";
  const googleSheetsSecret = options.googleSheetsSecret || process.env.GOOGLE_SHEETS_SECRET || "";
  const externalFetch = options.fetchImpl || fetch;
  const sessions = new Map();
  const uploadsDir = path.join(dataDir, "uploads");

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

  function saveUploadedMedia(file) {
    if (!file || !file.data.length) return null;
    const media = SUPPORTED_MEDIA[file.contentType];
    if (!media) throw new Error("Upload a JPG, PNG, WEBP, GIF, MP4 or WEBM file.");
    if (file.data.length > MAX_UPLOAD_SIZE) throw new Error("Media file must be smaller than 50 MB.");
    const fileName = `${crypto.randomUUID()}${media.extension}`;
    fs.writeFileSync(path.join(uploadsDir, fileName), file.data);
    return {
      mediaUrl: `/media/${fileName}`,
      mediaType: media.type,
      mediaName: clean(file.fileName).slice(0, 200)
    };
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
  const { data: posts, error } = await supabase
    .from("posts")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return sendJson(res, 500, { error: error.message });
  }

  return sendJson(res, 200, { posts });
}
    if (req.method === "GET" && pathname === "/api/gallery") {
      const gallery = readData("gallery.json", []).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return sendJson(res, 200, { gallery });
    }

    if (req.method === "POST" && pathname === "/api/leads") 
      
      {
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
     const { error } = await supabase
  .from("leads")
  .insert([{
    name: lead.name,
    email: lead.email,
    phone: lead.phone,
    destination: lead.destination,
    service: lead.service,
    message: lead.message,
    source: lead.source,
    created_at: new Date().toISOString()
  }]);
  if (!error) {
  try {
    transporter.sendMail({
  from: process.env.GMAIL_USER,
  to: process.env.GMAIL_USER,
  subject: "New Lead Received - Skyward Career",
  html: `
    <h2>New Lead Received</h2>
    <p><strong>Name:</strong> ${lead.name}</p>
    <p><strong>Phone:</strong> ${lead.phone}</p>
    <p><strong>Email:</strong> ${lead.email}</p>
    <p><strong>Service:</strong> ${lead.service}</p>
    <p><strong>Message:</strong> ${lead.message}</p>
  `
}).catch(err => console.error("Email failed:", err));
  } catch (emailError) {
    console.error("Email failed:", emailError);
  }
}

if (error) {
  console.error("POSTS INSERT ERROR:", error);

  return sendJson(res, 500, {
    error: error.message
  });
}
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
  const id = pathname.split("/").pop();

  const { error } = await supabase
    .from("leads")
    .delete()
    .eq("id", id);

  if (error) {
    return sendJson(res, 400, { error: error.message });
  }

  return sendJson(res, 200, { success: true });
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
      const savedMedia = saveUploadedMedia(file);
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
      const gallery = readData("gallery.json", []);
      gallery.unshift(item);
      writeData("gallery.json", gallery);
      return sendJson(res, 201, { item });
    }

    const galleryMatch = pathname.match(/^\/api\/admin\/gallery\/([a-zA-Z0-9-]+)$/);
    if (req.method === "DELETE" && galleryMatch) {
      const session = requireAdmin(req, res);
      if (!session || !verifyCsrf(req, res, session)) return;
      const gallery = readData("gallery.json", []);
      const removedItem = gallery.find((item) => item.id === galleryMatch[1]);
      const nextGallery = gallery.filter((item) => item.id !== galleryMatch[1]);
      if (nextGallery.length === gallery.length) return sendJson(res, 404, { error: "Gallery image not found." });
      writeData("gallery.json", nextGallery);
      if (removedItem.imageUrl) removeMediaFile(removedItem.imageUrl, uploadsDir);
      return sendJson(res, 200, { message: "Gallery image deleted." });
    }


    
  const session = requireAdmin(req, res);
  if (!session || !verifyCsrf(req, res, session)) return;

  
  const { fields: body, file } = await parsePostSubmission(req);

if (file) {
  return sendJson(res, 400, {
    error: "Image uploads are being migrated. Please create text-only posts for now."
  });


}
if (req.method === "POST" && pathname === "/api/admin/posts") {
  // ... your Supabase insert code ...
  return sendJson(res, 201, {
    post: data[0]
  });
}

if (req.method === "POST" && pathname === "/api/admin/posts") {
  const session = requireAdmin(req, res);
  if (!session || !verifyCsrf(req, res, session)) return;

  const { fields: body, file } = await parsePostSubmission(req);

  if (file) {
    return sendJson(res, 400, {
      error: "Image uploads are being migrated. Please create text-only posts for now."
    });
  }

  const post = {
    title: clean(body.title),
    category: clean(body.category) || "Guidance",
    description: clean(body.description),
    show_apply: body.showApply === "on",
    created_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from("posts")
    .insert([post])
    .select();

  if (error) {
    console.error("POSTS INSERT ERROR:", error);
    return sendJson(res, 500, {
      error: error.message
    });
  }

  return sendJson(res, 201, {
    post: data[0]
  });
}
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
    }catch (error) {
  console.error("SERVER ERROR:", error);

  sendJson(res, 500, {
    error: error.message || String(error)
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
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_SERVER,
  port: Number(process.env.SMTP_PORT),
  secure: false,
  auth: {
    user: process.env.SMTP_LOGIN,
    pass: process.env.SMTP_PASSWORD
  }
});
transporter.verify((error, success) => {
  if (error) {
    console.error("BREVO SMTP ERROR:", error);
  } else {
    console.log("BREVO SMTP READY");
  }
});
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

module.exports = app;
