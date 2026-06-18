"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");

// Mock twilio module
const twilioRequests = [];
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === "twilio") {
    const mockTwilio = () => ({
      messages: {
        create: async (opts) => {
          twilioRequests.push(opts);
          return { sid: "SMmock-sid-12345" };
        }
      }
    });
    return mockTwilio;
  }
  return originalRequire.apply(this, arguments);
};

const { createApp } = require("../server");

async function run() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "skyward-test-"));
  const sheetRequests = [];
  const db = {
    posts: [],
    gallery: [],
    leads: []
  };

  const fetchImpl = async (url, options) => {
    if (url.includes("sheet-webhook")) {
      sheetRequests.push({ url, payload: JSON.parse(options.body) });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    if (url.includes("/storage/v1/object/")) {
      return new Response(JSON.stringify({ path: "mock-path" }), {
        status: 200,
        headers: { "Content-Type": "image/png" }
      });
    }

    if (url.includes("/rest/v1/")) {
      const table = url.split("/rest/v1/")[1].split("?")[0];
      if (options.method === "POST") {
        const body = JSON.parse(options.body);
        const rows = Array.isArray(body) ? body : [body];
        db[table] = [...db[table], ...rows];
        return new Response(JSON.stringify(rows), { status: 201, headers: { "Content-Type": "application/json" } });
      }
      if (options.method === "GET") {
        return new Response(JSON.stringify(db[table] || []), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (options.method === "DELETE") {
        const match = url.match(/id=eq\.(.+)/);
        if (match) {
          const id = decodeURIComponent(match[1]);
          db[table] = db[table].filter(row => row.id !== id);
        }
        return new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } });
      }
    }

    return new Response(JSON.stringify([]), {
      status: 200,
      statusText: "OK",
      headers: { "Content-Type": "application/json" }
    });
  };

  const server = createApp({
    dataDir,
    adminEmail: "test@skyward.local",
    adminPassword: "StrongPassword123!",
    sessionSecret: "test-secret-used-only-for-automated-checks",
    googleSheetsWebhookUrl: "https://example.test/sheet-webhook",
    googleSheetsSecret: "sheet-secret",
    emailNotifyAdmin: false,
    smtpHost: "",
    smtpPort: "",
    smtpUser: "",
    smtpPass: "",
    twilioAccountSid: "ACmock-sid",
    twilioAuthToken: "mock-auth-token",
    twilioSmsFrom: "+14155238886",
    companySmsNumber: "+919241080063",
    fetchImpl
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const home = await fetch(`${base}/`);
    assert.equal(home.status, 200);
    const homeMarkup = await home.text();
    assert.match(homeMarkup, /Expert Guidance For/);
    assert.match(homeMarkup, /skyward-logo\.png/);
    const logo = await fetch(`${base}/assets/skyward-logo.png`);
    assert.equal(logo.status, 200);
    assert.equal(logo.headers.get("content-type"), "image/png");
    for (const page of ["/about", "/contact", "/admin"]) {
      const response = await fetch(`${base}${page}`);
      assert.equal(response.status, 200, `${page} should be available`);
      if (page === "/about") assert.match(await response.text(), /Skyward Advantage/);
    }

    const leadResponse = await fetch(`${base}/api/leads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Student Test",
        email: "student@example.com",
        phone: "9876543210",
        service: "University Admissions",
        source: "Automated check"
      })
    });
    assert.equal(leadResponse.status, 201);
    assert.equal(sheetRequests.length, 1);
    assert.equal(sheetRequests[0].payload.secret, "sheet-secret");
    assert.equal(sheetRequests[0].payload.lead.name, "Student Test");

    // Verify Twilio SMS request
    assert.equal(twilioRequests.length, 1);
    assert.match(twilioRequests[0].body, /New Lead/);
    assert.match(twilioRequests[0].body, /Student Test/);
    assert.equal(twilioRequests[0].from, "+14155238886");
    assert.equal(twilioRequests[0].to, "+919241080063");

    const denied = await fetch(`${base}/api/admin/leads`);
    assert.equal(denied.status, 401);

    const login = await fetch(`${base}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "test@skyward.local", password: "StrongPassword123!" })
    });
    assert.equal(login.status, 200);
    const session = await login.json();
    const cookie = login.headers.get("set-cookie").split(";")[0];

    const publish = await fetch(`${base}/api/admin/posts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        "X-CSRF-Token": session.csrfToken
      },
      body: JSON.stringify({
        title: "Application window opens",
        category: "Admissions",
        description: "Get ready for the coming intake."
      })
    });
    assert.equal(publish.status, 201);
    const newPost = (await publish.json()).post;

    const content = await (await fetch(`${base}/api/content`)).json();
    assert.equal(content.posts[0].title, "Application window opens");

    const mediaForm = new FormData();
    mediaForm.append("title", "Campus visit gallery");
    mediaForm.append("category", "Study Abroad");
    mediaForm.append("description", "See a glimpse of student life on campus.");
    mediaForm.append("media", new Blob([Buffer.from("sample-image")], { type: "image/png" }), "campus.png");
    const mediaPublish = await fetch(`${base}/api/admin/posts`, {
      method: "POST",
      headers: { Cookie: cookie, "X-CSRF-Token": session.csrfToken },
      body: mediaForm
    });
    assert.equal(mediaPublish.status, 201);
    const mediaPost = (await mediaPublish.json()).post;
    assert.equal(mediaPost.mediaType, "image");
    if (mediaPost.mediaUrl.startsWith("http")) {
      assert.match(mediaPost.mediaUrl, /^https:\/\/.*\/storage\/v1\/object\/public\/media\/[a-f0-9-]+\.png$/);
    } else {
      assert.match(mediaPost.mediaUrl, /^\/media\/[a-f0-9-]+\.png$/);
    }

    const mediaFetchUrl = mediaPost.mediaUrl.startsWith("http") ? mediaPost.mediaUrl : `${base}${mediaPost.mediaUrl}`;
    const uploadedMedia = mediaFetchUrl.startsWith("http") ? await fetchImpl(mediaFetchUrl) : await fetch(mediaFetchUrl);
    assert.equal(uploadedMedia.status, 200);
    assert.equal(uploadedMedia.headers.get("content-type"), "image/png");

    const rejectedForm = new FormData();
    rejectedForm.append("title", "Unsupported attachment");
    rejectedForm.append("description", "Should not publish.");
    rejectedForm.append("media", new Blob([Buffer.from("document")], { type: "application/pdf" }), "file.pdf");
    const rejected = await fetch(`${base}/api/admin/posts`, {
      method: "POST",
      headers: { Cookie: cookie, "X-CSRF-Token": session.csrfToken },
      body: rejectedForm
    });
    assert.equal(rejected.status, 400);

    const leads = await fetch(`${base}/api/admin/leads`, { headers: { Cookie: cookie } });
    assert.equal(leads.status, 200);
    const leadData = await leads.json();
    assert.equal(leadData.sheetsConfigured, true);
    assert.equal(leadData.leads[0].name, "Student Test");
    assert.equal(leadData.leads[0].sheetsStatus, "synced");

    const sheetSync = await fetch(`${base}/api/admin/leads/sync`, {
      method: "POST",
      headers: { Cookie: cookie, "X-CSRF-Token": session.csrfToken }
    });
    assert.equal(sheetSync.status, 200);
    assert.equal((await sheetSync.json()).synced, 1);
    assert.equal(sheetRequests.length, 2);

    // Test leads mail API (should return 400 SMTP skipped because no SMTP is configured in the test env)
    const mailResponse = await fetch(`${base}/api/admin/leads/email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        "X-CSRF-Token": session.csrfToken
      },
      body: JSON.stringify({
        leadId: leadData.leads[0].id,
        subject: "Welcome to Skyward",
        message: "Hello Student Test, we have received your consultation request."
      })
    });
    assert.equal(mailResponse.status, 400);
    const mailResult = await mailResponse.json();
    assert.match(mailResult.error, /SMTP is not configured/);

    // Test leads deletion (unauthorized, without csrf, and authorized)
    const deleteUnauth = await fetch(`${base}/api/admin/leads/${leadData.leads[0].id}`, {
      method: "DELETE"
    });
    assert.equal(deleteUnauth.status, 401);

    const deleteNoCsrf = await fetch(`${base}/api/admin/leads/${leadData.leads[0].id}`, {
      method: "DELETE",
      headers: { Cookie: cookie }
    });
    assert.equal(deleteNoCsrf.status, 403);

    const deleteSuccess = await fetch(`${base}/api/admin/leads/${leadData.leads[0].id}`, {
      method: "DELETE",
      headers: { Cookie: cookie, "X-CSRF-Token": session.csrfToken }
    });
    assert.equal(deleteSuccess.status, 200);

    // Verify lead is successfully deleted from leads.json
    const leadsAfter = await fetch(`${base}/api/admin/leads`, { headers: { Cookie: cookie } });
    const leadDataAfter = await leadsAfter.json();
    assert.equal(leadDataAfter.leads.length, 0);

    const remove = await fetch(`${base}/api/admin/posts/${newPost.id}`, {
      method: "DELETE",
      headers: { Cookie: cookie, "X-CSRF-Token": session.csrfToken }
    });
    assert.equal(remove.status, 200);

    const removeMedia = await fetch(`${base}/api/admin/posts/${mediaPost.id}`, {
      method: "DELETE",
      headers: { Cookie: cookie, "X-CSRF-Token": session.csrfToken }
    });
    assert.equal(removeMedia.status, 200);
    if (!mediaPost.mediaUrl.startsWith("http")) {
      assert.equal((await fetch(`${base}${mediaPost.mediaUrl}`)).status, 404);
    }

    console.log("Smoke test passed: pages, Google Sheets leads, admin publishing, and media uploads work.");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
