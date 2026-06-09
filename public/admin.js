"use strict";

let csrfToken = "";

const loginPanel = document.querySelector("[data-login-panel]");
const dashboard = document.querySelector("[data-dashboard]");
const loginMessage = document.querySelector("[data-login-message]");
const postMessage = document.querySelector("[data-post-message]");
const syncMessage = document.querySelector("[data-sync-message]");
const galleryMessage = document.querySelector("[data-gallery-message]");
const contentMessage = document.querySelector("[data-content-message]");

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
    const [content, enquiryData, galleryData, siteContentData] = await Promise.all([request("/api/content"), request("/api/admin/leads"), request("/api/gallery"), request("/api/content/site")]);
    
    const siteContent = siteContentData.content || {};
    const titleInput = document.querySelector("#content-heroTitle");
    const descInput = document.querySelector("#content-heroDesc");
    const headlineInput = document.querySelector("#content-aboutHeadline");
    const contactInput = document.querySelector("#content-contactText");
    
    if (titleInput) titleInput.value = siteContent.heroTitle || "";
    if (descInput) descInput.value = siteContent.heroDesc || "";
    if (headlineInput) headlineInput.value = siteContent.aboutHeadline || "";
    if (contactInput) contactInput.value = siteContent.contactText || "";

    renderPosts(content.posts);
    renderLeads(enquiryData.leads, enquiryData.sheetsConfigured);
    renderGallery(galleryData.gallery);
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

function renderGallery(gallery) {
  const wrapper = document.querySelector("[data-admin-gallery]");
  wrapper.replaceChildren();
  if (!gallery.length) {
    wrapper.innerHTML = "<p class=\"empty\">No gallery images yet.</p>";
    return;
  }
  gallery.forEach((item) => {
    const card = document.createElement("article");
    card.className = "admin-gallery-card";

    const image = document.createElement("img");
    image.src = item.imageUrl;
    image.alt = item.title || "Gallery image";

    const content = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = item.title || "Gallery image";
    const detail = document.createElement("p");
    detail.textContent = `${item.description || "No caption"} | ${formatDate(item.createdAt)}`;

    const remove = document.createElement("button");
    remove.className = "button danger";
    remove.type = "button";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => deleteGalleryItem(item.id));

    content.append(title, detail, remove);
    card.append(image, content);
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

async function deleteGalleryItem(id) {
  galleryMessage.classList.remove("error");
  galleryMessage.textContent = "Deleting gallery image...";
  try {
    await request(`/api/admin/gallery/${encodeURIComponent(id)}`, { method: "DELETE" });
    galleryMessage.textContent = "Gallery image deleted.";
    await loadDashboard();
  } catch (error) {
    galleryMessage.classList.add("error");
    galleryMessage.textContent = error.message;
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

function compressImage(file, maxWidth = 1200, maxHeight = 1200, quality = 0.8) {
  return new Promise((resolve) => {
    if (!file.type.startsWith("image/") || file.type === "image/gif") {
      return resolve(file);
    }
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let width = img.width;
        let height = img.height;
        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (!blob) return resolve(file);
            const compressedFile = new File([blob], file.name.replace(/\.[^/.]+$/, ".jpg"), {
              type: "image/jpeg",
              lastModified: Date.now()
            });
            resolve(compressedFile);
          },
          "image/jpeg",
          quality
        );
      };
      img.onerror = () => resolve(file);
    };
    reader.onerror = () => resolve(file);
  });
}

document.querySelector("[data-post-form]").addEventListener("submit", async (event) => {
  event.preventDefault();
  postMessage.classList.remove("error");
  postMessage.textContent = "Processing and uploading...";
  const form = event.currentTarget;
  try {
    const formData = new FormData();
    formData.append("title", form.querySelector("[name='title']").value);
    formData.append("category", form.querySelector("[name='category']").value);
    formData.append("description", form.querySelector("[name='description']").value);
    if (form.querySelector("[name='showApply']")) {
      formData.append("showApply", form.querySelector("[name='showApply']").checked ? "on" : "off");
    }
    const fileInput = form.querySelector("[name='media']");
    if (fileInput && fileInput.files && fileInput.files[0]) {
      const originalFile = fileInput.files[0];
      if (originalFile.type.startsWith("image/")) {
        postMessage.textContent = "Optimizing image for fast loading...";
        const compressedFile = await compressImage(originalFile);
        formData.append("media", compressedFile);
      } else {
        formData.append("media", originalFile);
      }
    }
    postMessage.textContent = "Publishing to website...";
    await request("/api/admin/posts", {
      method: "POST",
      body: formData
    });
    form.reset();
    postMessage.textContent = "Your post is now live on the homepage.";
    await loadDashboard();
  } catch (error) {
    postMessage.classList.add("error");
    postMessage.textContent = error.message;
  }
});

document.querySelector("[data-gallery-form]").addEventListener("submit", async (event) => {
  event.preventDefault();
  galleryMessage.classList.remove("error");
  galleryMessage.textContent = "Processing and uploading...";
  const form = event.currentTarget;
  try {
    const formData = new FormData();
    formData.append("title", form.querySelector("[name='title']").value);
    formData.append("description", form.querySelector("[name='description']").value);
    const fileInput = form.querySelector("[name='media']");
    if (fileInput && fileInput.files && fileInput.files[0]) {
      const originalFile = fileInput.files[0];
      galleryMessage.textContent = "Optimizing image for fast loading...";
      const compressed = await compressImage(originalFile);
      formData.append("media", compressed);
    }
    galleryMessage.textContent = "Uploading to gallery...";
    await request("/api/admin/gallery", {
      method: "POST",
      body: formData
    });
    form.reset();
    galleryMessage.textContent = "Gallery image is now live on the homepage.";
    await loadDashboard();
  } catch (error) {
    galleryMessage.classList.add("error");
    galleryMessage.textContent = error.message;
  }
});

const contentForm = document.querySelector("[data-content-form]");
if (contentForm) {
  contentForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (contentMessage) {
      contentMessage.classList.remove("error");
      contentMessage.textContent = "Updating site content...";
    }
    const form = event.currentTarget;
    try {
      await request("/api/admin/content/site", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(new FormData(form).entries()))
      });
      if (contentMessage) contentMessage.textContent = "Site content updated successfully.";
    } catch (error) {
      if (contentMessage) {
        contentMessage.classList.add("error");
        contentMessage.textContent = error.message;
      }
    }
  });
}

document.querySelector("[data-logout]").addEventListener("click", async () => {
  try {
    await request("/api/admin/logout", { method: "POST" });
  } finally {
    showLogin();
  }
});



request("/api/admin/session")
  .then(showDashboard)
  .catch(showLogin);
