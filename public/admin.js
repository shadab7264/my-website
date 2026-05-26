"use strict";

let csrfToken = "";
const loginPanel = document.querySelector("[data-login-panel]");
const dashboard = document.querySelector("[data-dashboard]");
const loginMessage = document.querySelector("[data-login-message]");
const postMessage = document.querySelector("[data-post-message]");
const syncMessage = document.querySelector("[data-sync-message]");

async function request(url, options = {}) {
  const method = options.method || "GET";
  const headers = { ...(options.headers || {}) };
  if (method !== "GET" && csrfToken && url !== "/api/admin/login") headers["X-CSRF-Token"] = csrfToken;
  const response = await fetch(url, { ...options, headers });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Request failed.");
  return payload;
}

function showDashboard(session) {
  csrfToken = session.csrfToken;
  loginPanel.classList.add("hidden");
  dashboard.classList.add("visible");
  document.querySelector("[data-admin-email]").textContent = session.email;
  loadDashboard();
}

function showLogin() {
  csrfToken = "";
  loginPanel.classList.remove("hidden");
  dashboard.classList.remove("visible");
}

async function loadDashboard() {
  try {
    const [content, enquiryData] = await Promise.all([request("/api/content"), request("/api/admin/leads")]);
    renderPosts(content.posts);
    renderLeads(enquiryData.leads, enquiryData.sheetsConfigured);
  } catch (error) {
    if (error.message.includes("log in")) showLogin();
  }
}

function renderPosts(posts) {
  const wrapper = document.querySelector("[data-admin-posts]");
  wrapper.replaceChildren();
  document.querySelector("[data-post-count]").textContent = posts.length;
  if (!posts.length) {
    wrapper.innerHTML = "<p class=\"empty\">No published posts yet.</p>";
    return;
  }
  posts.forEach((post) => {
    const card = document.createElement("article");
    card.className = "admin-post";
    const head = document.createElement("div");
    head.className = "admin-post-head";
    const content = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = post.title;
    const detail = document.createElement("p");
    detail.textContent = `${post.category} | ${formatDate(post.createdAt)}${post.mediaType ? ` | ${post.mediaType}` : ""}`;
    content.append(title, detail);
    const remove = document.createElement("button");
    remove.className = "button danger";
    remove.type = "button";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => deletePost(post.id));
    head.append(content, remove);
    card.append(head);
    if (post.mediaUrl) {
      const media = post.mediaType === "video" ? document.createElement("video") : document.createElement("img");
      media.className = "admin-post-media";
      media.src = post.mediaUrl;
      media.alt = post.mediaType === "image" ? post.title : "";
      if (post.mediaType === "video") {
        media.controls = true;
        media.preload = "metadata";
      }
      card.append(media);
    }
    wrapper.append(card);
  });
}

function renderLeads(leads, sheetsConfigured) {
  const table = document.querySelector("[data-leads-table]");
  table.replaceChildren();
  document.querySelector("[data-lead-count]").textContent = leads.length;
  document.querySelector("[data-latest-date]").textContent = leads.length ? shortDate(leads[0].createdAt) : "-";
  document.querySelector("[data-sheet-status]").textContent = sheetsConfigured
    ? "Connected to Google Sheets. Use sync to resend all saved leads."
    : "Google Sheets setup is required before online syncing.";
  if (!leads.length) {
    const row = document.createElement("tr");
    row.innerHTML = "<td class=\"empty\" colspan=\"6\">Your new website enquiries will appear here.</td>";
    table.append(row);
    return;
  }
  leads.forEach((lead) => {
    const row = document.createElement("tr");
    const status = lead.sheetsStatus === "synced" ? "Synced" : sheetsConfigured ? "Pending" : "Not configured";
    [lead.name, `${lead.email}\n${lead.phone}`, lead.service, lead.source, formatDate(lead.createdAt), status].forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = value || "-";
      cell.style.whiteSpace = "pre-line";
      row.append(cell);
    });
    table.append(row);
  });
}

async function deletePost(id) {
  try {
    await request(`/api/admin/posts/${encodeURIComponent(id)}`, { method: "DELETE" });
    postMessage.textContent = "Post removed from the website.";
    await loadDashboard();
  } catch (error) {
    postMessage.classList.add("error");
    postMessage.textContent = error.message;
  }
}

function formatDate(date) {
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(date));
}

function shortDate(date) {
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short" }).format(new Date(date));
}

document.querySelector("[data-login-form]").addEventListener("submit", async (event) => {
  event.preventDefault();
  loginMessage.classList.remove("error");
  loginMessage.textContent = "Signing in...";
  const form = event.currentTarget;
  try {
    const session = await request("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(form).entries()))
    });
    loginMessage.textContent = "";
    form.reset();
    showDashboard(session);
  } catch (error) {
    loginMessage.classList.add("error");
    loginMessage.textContent = error.message;
  }
});

document.querySelector("[data-post-form]").addEventListener("submit", async (event) => {
  event.preventDefault();
  postMessage.classList.remove("error");
  postMessage.textContent = "Publishing...";
  const form = event.currentTarget;
  try {
    await request("/api/admin/posts", {
      method: "POST",
      body: new FormData(form)
    });
    form.reset();
    postMessage.textContent = "Your post is now live on the homepage.";
    await loadDashboard();
  } catch (error) {
    postMessage.classList.add("error");
    postMessage.textContent = error.message;
  }
});

document.querySelector("[data-logout]").addEventListener("click", async () => {
  try {
    await request("/api/admin/logout", { method: "POST" });
  } finally {
    showLogin();
  }
});

document.querySelector("[data-sync-leads]").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  syncMessage.classList.remove("error");
  syncMessage.textContent = "Syncing saved leads...";
  button.disabled = true;
  try {
    const result = await request("/api/admin/leads/sync", { method: "POST" });
    syncMessage.textContent = result.failed
      ? `${result.synced} lead(s) synced; ${result.failed} could not be sent yet.`
      : result.message;
    await loadDashboard();
  } catch (error) {
    syncMessage.classList.add("error");
    syncMessage.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

request("/api/admin/session")
  .then(showDashboard)
  .catch(showLogin);
