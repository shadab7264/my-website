"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createApp } = require("../server");

async function run() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "skyward-test-"));
  const sheetRequests = [];
  const server = createApp({
    dataDir,
    adminEmail: "test@skyward.local",
    adminPassword: "StrongPassword123!",
    sessionSecret: "test-secret-used-only-for-automated-checks",
    googleSheetsWebhookUrl: "https://example.test/sheet-webhook",
    googleSheetsSecret: "sheet-secret",
    fetchImpl: async (url, options) => {
      sheetRequests.push({ url, payload: JSON.parse(options.body) });
      return { ok: true, json: async () => ({ ok: true }) };
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const home = await fetch(`${base}/`);
    assert.equal(home.status, 200);
    const homeMarkup = await home.text();
    assert.match(homeMarkup, /Your future deserves/);
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
    assert.match(mediaPost.mediaUrl, /^\/media\/[a-f0-9-]+\.png$/);

    const uploadedMedia = await fetch(`${base}${mediaPost.mediaUrl}`);
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
    assert.equal((await fetch(`${base}${mediaPost.mediaUrl}`)).status, 404);

    console.log("Smoke test passed: pages, Google Sheets leads, admin publishing and media uploads work.");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
