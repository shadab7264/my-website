"use strict";

let csrfToken = "";
let editingJobId = null;
let currentUser = null;

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
  currentUser = session;
  loginPanel.classList.add("hidden");
  dashboard.classList.add("visible");
  document.querySelector("[data-admin-email]").textContent = session.email;
  
  // Tab visibility
  const perms = currentUser.permissions || {};
  const isSuper = currentUser.role === "super_admin";
  
  const hasContent = isSuper || perms.manage_content || perms.manage_posts || perms.manage_gallery || perms.manage_leads;
  const hasJobs = isSuper || perms.create_jobs || perms.edit_jobs || perms.delete_jobs || perms.view_applications || perms.shortlist_candidates || perms.export_applications;
  const hasUsers = isSuper || perms.create_users || perms.edit_users || perms.delete_users || perms.assign_permissions;

  const contentTabBtn = document.querySelector(".dashboard-tabs button[data-tab='content']");
  const jobsTabBtn = document.querySelector(".dashboard-tabs button[data-tab='jobs']");
  const usersTabBtn = document.getElementById("users-tab-btn");

  if (contentTabBtn) contentTabBtn.style.display = hasContent ? "" : "none";
  if (jobsTabBtn) jobsTabBtn.style.display = hasJobs ? "" : "none";
  if (usersTabBtn) usersTabBtn.style.display = hasUsers ? "" : "none";

  // Hide/Show Panels in Content Tab
  const pubContentPanel = document.querySelector("[data-post-form]")?.closest("section.panel");
  const pubPostsPanel = document.querySelector("[data-admin-posts]")?.closest("section.panel");
  if (pubContentPanel) pubContentPanel.style.display = (isSuper || perms.manage_posts) ? "" : "none";
  if (pubPostsPanel) pubPostsPanel.style.display = (isSuper || perms.manage_posts) ? "" : "none";
  
  const galleryPanel = document.querySelector("[data-gallery-form]")?.closest("section.panel");
  if (galleryPanel) galleryPanel.style.display = (isSuper || perms.manage_gallery) ? "" : "none";

  const siteContentPanel = document.querySelector("[data-content-form]")?.closest("section.panel");
  if (siteContentPanel) siteContentPanel.style.display = (isSuper || perms.manage_content) ? "" : "none";

  const leadsPanel = document.querySelector("[data-leads-table]")?.closest("section.panel");
  if (leadsPanel) leadsPanel.style.display = (isSuper || perms.manage_leads) ? "" : "none";

  // Hide/Show Panels in Jobs Tab
  const jobFormPanel = document.getElementById("job-form-panel");
  const pubJobsPanel = document.querySelector("[data-jobs-table]")?.closest("section.panel");
  const canManageJobs = isSuper || perms.create_jobs || perms.edit_jobs || perms.delete_jobs;
  if (jobFormPanel) jobFormPanel.style.display = canManageJobs ? "" : "none";
  if (pubJobsPanel) pubJobsPanel.style.display = canManageJobs ? "" : "none";

  const appsPanel = document.querySelector("[data-apps-table]")?.closest("section.panel");
  if (appsPanel) appsPanel.style.display = (isSuper || perms.view_applications || perms.shortlist_candidates) ? "" : "none";

  const placementPanel = document.querySelector("[data-terms-form]")?.closest("section.panel");
  if (placementPanel) placementPanel.style.display = isSuper ? "" : "none";

  // Ensure "hidden" class is removed from users button if it shouldn't be hidden
  if (usersTabBtn) {
    if (hasUsers) usersTabBtn.classList.remove("hidden");
    else usersTabBtn.classList.add("hidden");
  }

  // Auto-switch to the first accessible tab
  if (hasContent && contentTabBtn) {
    contentTabBtn.click();
  } else if (hasJobs && jobsTabBtn) {
    jobsTabBtn.click();
  } else if (hasUsers && usersTabBtn) {
    usersTabBtn.click();
  }
  
  loadDashboard();
}

function showLogin() {
  csrfToken = "";
  loginPanel.classList.remove("hidden");
  dashboard.classList.remove("visible");
}

async function loadDashboard() {
  try {
    const promises = [
      request("/api/content"), 
      request("/api/admin/leads"), 
      request("/api/gallery"), 
      request("/api/content/site"),
      request("/api/admin/jobs"),
      request("/api/admin/applications"),
      request("/api/admin/job-analytics"),
      request("/api/job-categories"),
      request("/api/placement/terms"),
      request("/api/placement/policy")
    ];

    const results = await Promise.allSettled(promises);
    
    // If any request failed because the session is invalid, go to login
    const authError = results.find(r => r.status === "rejected" && r.reason.message.includes("log in"));
    if (authError) {
      showLogin();
      return;
    }

    const val = (index) => results[index].status === "fulfilled" ? results[index].value : {};

    const content = val(0);
    const enquiryData = val(1);
    const galleryData = val(2);
    const siteContentData = val(3);
    const jobsData = val(4);
    const appsData = val(5);
    const analyticsData = val(6);
    const categoriesData = val(7);
    const termsData = val(8);
    const policyData = val(9);
    
    const siteContent = siteContentData.content || {};
    const titleInput = document.querySelector("#content-heroTitle");
    const descInput = document.querySelector("#content-heroDesc");
    const headlineInput = document.querySelector("#content-aboutHeadline");
    const contactInput = document.querySelector("#content-contactText");
    
    if (titleInput) titleInput.value = siteContent.heroTitle || "";
    if (descInput) descInput.value = siteContent.heroDesc || "";
    if (headlineInput) headlineInput.value = siteContent.aboutHeadline || "";
    if (contactInput) contactInput.value = siteContent.contactText || "";

    renderPosts(content.posts || []);
    renderLeads(enquiryData.leads || [], enquiryData.sheetsConfigured);
    renderGallery(galleryData.gallery || []);

    // Job Portal specific rendering
    renderJobs(jobsData.jobs || []);
    renderApplications(appsData.applications || []);
    updateJobAnalytics(analyticsData);
    populateCategoriesSelect(categoriesData.categories || []);

    const termsInput = document.querySelector("#settings-terms");
    const policyInput = document.querySelector("#settings-policy");
    if (termsInput) termsInput.value = termsData.content || "";
    if (policyInput) policyInput.value = policyData.content || "";

    if (currentUser && currentUser.role === "super_admin") {
      loadUsersGrid();
    }
  } catch (error) {
    if (error.message.includes("log in")) showLogin();
  }
}

// Tab Switching
document.querySelectorAll(".dashboard-tabs .button").forEach(btn => {
  btn.addEventListener("click", (e) => {
    document.querySelectorAll(".dashboard-tabs .button").forEach(b => b.classList.remove("active"));
    e.target.classList.add("active");

    const tab = e.target.dataset.tab;
    const contentStats = document.getElementById("content-stats");
    const jobsStats = document.getElementById("jobs-stats");
    const contentGrid = document.getElementById("content-grid");
    const jobsGrid = document.getElementById("jobs-grid");
    const usersGrid = document.getElementById("users-grid");

    if (tab === "content") {
      contentStats.classList.remove("hidden");
      contentGrid.classList.remove("hidden");
      jobsStats.classList.add("hidden");
      jobsGrid.classList.add("hidden");
      if (usersGrid) usersGrid.classList.add("hidden");
    } else if (tab === "jobs") {
      contentStats.classList.add("hidden");
      contentGrid.classList.add("hidden");
      jobsStats.classList.remove("hidden");
      jobsGrid.classList.remove("hidden");
      if (usersGrid) usersGrid.classList.add("hidden");
    } else if (tab === "users") {
      contentStats.classList.add("hidden");
      contentGrid.classList.add("hidden");
      jobsStats.classList.add("hidden");
      jobsGrid.classList.add("hidden");
      if (usersGrid) usersGrid.classList.remove("hidden");
    }
  });
});

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
    row.innerHTML = "<td class=\"empty\" colspan=\"7\">Your new website enquiries will appear here.</td>";
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

    const actionsCell = document.createElement("td");
    actionsCell.className = "actions-cell";

    const emailBtn = document.createElement("button");
    emailBtn.className = "button action-btn email-btn";
    emailBtn.type = "button";
    emailBtn.textContent = "Email";
    emailBtn.addEventListener("click", () => openEmailModal(lead));

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "button danger action-btn delete-btn";
    deleteBtn.type = "button";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => deleteLead(lead.id));

    actionsCell.append(emailBtn, deleteBtn);
    row.append(actionsCell);

    table.append(row);
  });
}

function updateJobAnalytics(data) {
  document.querySelector("[data-active-jobs]").textContent = `${data.activeJobs} / ${data.totalJobs}`;
  document.querySelector("[data-total-apps]").textContent = data.totalApplications;
  document.querySelector("[data-conversion-rate]").textContent = data.conversionRate;
}

function populateCategoriesSelect(categories) {
  const select = document.getElementById("job-cat");
  if (!select) return;
  select.innerHTML = '<option value="">Select Category</option>';
  categories.forEach(cat => {
    const opt = document.createElement("option");
    opt.value = cat.id;
    opt.textContent = cat.name;
    select.appendChild(opt);
  });
}

function renderJobs(jobs) {
  const table = document.querySelector("[data-jobs-table]");
  if (!table) return;
  table.replaceChildren();

  if (!jobs.length) {
    const row = document.createElement("tr");
    row.innerHTML = "<td class=\"empty\" colspan=\"6\">No jobs published yet.</td>";
    table.append(row);
    return;
  }

  jobs.forEach((job) => {
    const row = document.createElement("tr");
    
    // Status Badge
    let statusClass = "status-badge ";
    if (!job.is_active) statusClass += "bg-gray";
    else if (job.is_featured) statusClass += "bg-gold";
    else statusClass += "bg-blue";
    
    let statusText = !job.is_active ? "Closed" : (job.is_featured ? "Featured" : "Active");

    [
      job.title, 
      job.company_name, 
      job.location, 
      shortDate(job.created_at), 
    ].forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = value || "-";
      row.append(cell);
    });

    const statusCell = document.createElement("td");
    statusCell.innerHTML = `<span class="${statusClass}">${statusText}</span>`;
    row.append(statusCell);

    const actionsCell = document.createElement("td");
    actionsCell.className = "actions-cell";

    const toggleBtn = document.createElement("button");
    toggleBtn.className = "button sm outline action-btn";
    toggleBtn.type = "button";
    toggleBtn.textContent = job.is_active ? "Close Job" : "Re-open";
    toggleBtn.addEventListener("click", () => toggleJob(job.id, !job.is_active, job.is_featured));

    const featureBtn = document.createElement("button");
    featureBtn.className = "button sm outline action-btn";
    featureBtn.type = "button";
    featureBtn.textContent = job.is_featured ? "Unfeature" : "Feature";
    featureBtn.addEventListener("click", () => toggleJob(job.id, job.is_active, !job.is_featured));

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "button sm danger action-btn";
    deleteBtn.type = "button";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => deleteJob(job.id));

    const editBtn = document.createElement("button");
    editBtn.className = "button sm gold action-btn";
    editBtn.type = "button";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => startEditJob(job));

    actionsCell.append(editBtn, toggleBtn, featureBtn, deleteBtn);
    row.append(actionsCell);

    table.append(row);
  });
}

function renderApplications(apps) {
  const table = document.querySelector("[data-apps-table]");
  if (!table) return;
  table.replaceChildren();

  if (!apps.length) {
    const row = document.createElement("tr");
    row.innerHTML = "<td class=\"empty\" colspan=\"6\">No applications received yet.</td>";
    table.append(row);
    return;
  }

  apps.forEach((app) => {
    const row = document.createElement("tr");
    
    // Status Badge
    let statusClass = "status-badge ";
    switch(app.status) {
      case "New": statusClass += "bg-blue"; break;
      case "Shortlisted": statusClass += "bg-gold"; break;
      case "Interview Scheduled": statusClass += "bg-purple"; break;
      case "Selected": statusClass += "bg-green"; break;
      case "Joined": statusClass += "bg-dark-green"; break;
      case "Rejected": statusClass += "bg-red"; break;
      default: statusClass += "bg-gray";
    }

    const jobTitle = app.jobs ? app.jobs.title : "Unknown Job";
    
    [
      app.application_id,
      `${app.full_name}\n${app.mobile}`,
      jobTitle,
      shortDate(app.created_at)
    ].forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = value || "-";
      cell.style.whiteSpace = "pre-line";
      row.append(cell);
    });

    const statusCell = document.createElement("td");
    statusCell.innerHTML = `<span class="${statusClass}">${app.status}</span>`;
    row.append(statusCell);

    const actionsCell = document.createElement("td");
    actionsCell.className = "actions-cell";

    const viewBtn = document.createElement("button");
    viewBtn.className = "button sm gold action-btn";
    viewBtn.type = "button";
    viewBtn.textContent = "View";
    viewBtn.addEventListener("click", () => openAppDetailModal(app));

    if (app.resume_url) {
      const resumeBtn = document.createElement("a");
      resumeBtn.className = "button sm outline action-btn";
      resumeBtn.href = app.resume_url;
      resumeBtn.target = "_blank";
      resumeBtn.textContent = "Resume";
      actionsCell.append(viewBtn, resumeBtn);
    } else {
      actionsCell.append(viewBtn);
    }

    row.append(actionsCell);
    table.append(row);
  });
}

// App Detail Modal
const appDetailModal = document.querySelector("[data-app-detail-modal]");
let currentViewingAppId = null;

function openAppDetailModal(app) {
  currentViewingAppId = app.id;
  document.getElementById("detail-app-id").textContent = app.application_id;
  document.getElementById("app-status-select").value = app.status;
  
  const content = document.getElementById("app-detail-content");
  
  const renderRow = (label, value) => `<div style="margin-bottom: 0.5rem;"><strong>${label}:</strong> ${value || '-'}</div>`;
  
  content.innerHTML = `
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.5rem;">
      <div>
        <h3 style="margin-bottom: 0.5rem; font-size: 1rem;">Candidate Info</h3>
        ${renderRow("Name", app.full_name)}
        ${renderRow("Email", `<a href="mailto:${app.email}">${app.email}</a>`)}
        ${renderRow("Mobile", app.mobile)}
        ${renderRow("WhatsApp", app.whatsapp)}
        ${renderRow("Location", app.current_location)}
        ${renderRow("Gender", app.gender)}
        ${renderRow("DOB", app.dob)}
      </div>
      <div>
        <h3 style="margin-bottom: 0.5rem; font-size: 1rem;">Education</h3>
        ${renderRow("Qualification", app.highest_qualification)}
        ${renderRow("Course", app.course_name)}
        ${renderRow("College", app.college)}
        ${renderRow("Passing Year", app.passing_year)}
        ${renderRow("Percentage/CGPA", app.percentage)}
      </div>
    </div>
    
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.5rem;">
      <div>
        <h3 style="margin-bottom: 0.5rem; font-size: 1rem;">Professional</h3>
        ${renderRow("Status", app.employment_status)}
        ${app.employment_status === 'Experienced' ? `
          ${renderRow("Total Exp", app.total_experience)}
          ${renderRow("Current Co.", app.current_company)}
          ${renderRow("Designation", app.current_designation)}
          ${renderRow("Current Sal", app.current_salary)}
          ${renderRow("Expected Sal", app.expected_salary)}
          ${renderRow("Notice Period", app.notice_period)}
        ` : ''}
      </div>
      <div>
        <h3 style="margin-bottom: 0.5rem; font-size: 1rem;">Additional</h3>
        ${renderRow("Skills", app.skills)}
        ${renderRow("Certifications", app.certifications)}
        ${renderRow("LinkedIn", app.linkedin_url ? `<a href="${app.linkedin_url}" target="_blank">View Profile</a>` : '-')}
        ${renderRow("Portfolio", app.portfolio_url ? `<a href="${app.portfolio_url}" target="_blank">View Site</a>` : '-')}
      </div>
    </div>
    
    ${app.cover_letter ? `
      <div style="margin-bottom: 1.5rem;">
        <h3 style="margin-bottom: 0.5rem; font-size: 1rem;">Cover Letter</h3>
        <p style="white-space: pre-wrap; font-size: 0.9rem; background: rgba(0,0,0,0.02); padding: 1rem; border-radius: 4px;">${app.cover_letter}</p>
      </div>
    ` : ''}
  `;
  
  appDetailModal.classList.add("visible");
}

document.querySelectorAll("[data-close-app-modal]").forEach(btn => {
  btn.addEventListener("click", () => appDetailModal.classList.remove("visible"));
});

document.getElementById("save-app-status")?.addEventListener("click", async () => {
  if (!currentViewingAppId) return;
  const newStatus = document.getElementById("app-status-select").value;
  try {
    await request(`/api/admin/applications/${currentViewingAppId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus })
    });
    appDetailModal.classList.remove("visible");
    await loadDashboard();
  } catch (err) {
    alert("Failed to update status: " + err.message);
  }
});

async function toggleJob(id, isActive, isFeatured) {
  try {
    await request(`/api/admin/jobs/${id}/toggle`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: isActive, is_featured: isFeatured })
    });
    await loadDashboard();
  } catch (err) {
    alert("Failed to update job: " + err.message);
  }
}

async function deleteJob(id) {
  if (!confirm("Are you sure you want to delete this job? This will also delete all associated applications.")) return;
  try {
    await request(`/api/admin/jobs/${id}`, { method: "DELETE" });
    await loadDashboard();
  } catch (err) {
    alert("Failed to delete job: " + err.message);
  }
}

function startEditJob(job) {
  editingJobId = job.id;
  
  // Set headers
  document.getElementById("job-form-title").textContent = `Edit Job: ${job.title}`;
  document.getElementById("job-form-subtitle").textContent = `Updating job posting for ${job.company_name}.`;
  document.getElementById("job-submit-btn").textContent = "Save Changes";
  document.getElementById("job-cancel-btn").classList.remove("hidden");

  // Populate fields
  const form = document.querySelector("[data-job-form]");
  if (!form) return;

  form.querySelector("[name='title']").value = job.title || "";
  form.querySelector("[name='company_name']").value = job.company_name || "";
  form.querySelector("[name='location']").value = job.location || "";
  form.querySelector("[name='category_id']").value = job.category_id || "";
  form.querySelector("[name='employment_type']").value = job.employment_type || "Full-Time";
  form.querySelector("[name='work_mode']").value = job.work_mode || "Work From Office";
  form.querySelector("[name='experience_level']").value = job.experience_level || "Both";
  form.querySelector("[name='salary_period']").value = job.salary_period || "Yearly";
  form.querySelector("[name='salary_min']").value = job.salary_min || 0;
  form.querySelector("[name='salary_max']").value = job.salary_max || 0;
  form.querySelector("[name='experience_min']").value = job.experience_min || 0;
  form.querySelector("[name='experience_max']").value = job.experience_max || 0;
  form.querySelector("[name='openings']").value = job.openings || 1;
  form.querySelector("[name='skills_required']").value = (job.skills_required || []).join(", ");
  form.querySelector("[name='description']").value = job.description || "";
  form.querySelector("[name='is_featured']").checked = Boolean(job.is_featured);

  updateSalaryLabels();

  // Scroll to form panel
  document.getElementById("job-form-panel")?.scrollIntoView({ behavior: "smooth" });
}

function cancelEditJob() {
  editingJobId = null;
  
  // Reset headers
  document.getElementById("job-form-title").textContent = "Post a New Job";
  document.getElementById("job-form-subtitle").textContent = "Publish career opportunities to the Jobs portal.";
  document.getElementById("job-submit-btn").textContent = "Publish Job";
  document.getElementById("job-cancel-btn").classList.add("hidden");

  // Reset form
  const form = document.querySelector("[data-job-form]");
  if (form) {
    form.reset();
    updateSalaryLabels();
  }
}

// Salary Period labels & placeholders helper
function updateSalaryLabels() {
  const form = document.querySelector("[data-job-form]");
  if (!form) return;
  const salaryPeriodSelect = form.querySelector("[name='salary_period']");
  const salaryMinLabel = document.getElementById("job-sal-min-label");
  const salaryMaxLabel = document.getElementById("job-sal-max-label");
  const salaryMinInput = document.getElementById("job-sal-min");
  const salaryMaxInput = document.getElementById("job-sal-max");

  if (!salaryPeriodSelect) return;
  const isMonthly = salaryPeriodSelect.value === "Monthly";
  if (isMonthly) {
    if (salaryMinLabel) salaryMinLabel.textContent = "Min Salary (Per Month)";
    if (salaryMaxLabel) salaryMaxLabel.textContent = "Max Salary (Per Month)";
    if (salaryMinInput) salaryMinInput.placeholder = "e.g. 25000";
    if (salaryMaxInput) salaryMaxInput.placeholder = "e.g. 40000";
  } else {
    if (salaryMinLabel) salaryMinLabel.textContent = "Min Salary (LPA)";
    if (salaryMaxLabel) salaryMaxLabel.textContent = "Max Salary (LPA)";
    if (salaryMinInput) salaryMinInput.placeholder = "e.g. 300000";
    if (salaryMaxInput) salaryMaxInput.placeholder = "e.g. 500000";
  }
}

// Register change event on salary period dropdown
const periodSelect = document.getElementById("job-sal-period");
if (periodSelect) {
  periodSelect.addEventListener("change", updateSalaryLabels);
}

// Job Form Submission
const jobForm = document.querySelector("[data-job-form]");
const jobMessage = document.querySelector("[data-job-message]");
if (jobForm) {
  jobForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    jobMessage.classList.remove("error");
    jobMessage.textContent = editingJobId ? "Saving changes..." : "Publishing job...";
    const btn = jobForm.querySelector("button[type='submit']");
    btn.disabled = true;

    try {
      const formData = new FormData(jobForm);
      const fileInput = jobForm.querySelector("[name='media']");
      if (fileInput && fileInput.files[0]) {
        jobMessage.textContent = "Optimizing company logo...";
        const compressed = await compressImage(fileInput.files[0]);
        formData.set("media", compressed);
      }

      // Explicitly set is_featured as boolean string to avoid unchecked omission bug
      const isFeatured = jobForm.querySelector("[name='is_featured']").checked;
      formData.set("is_featured", isFeatured ? "true" : "false");

      if (editingJobId) {
        await request(`/api/admin/jobs/${editingJobId}`, {
          method: "PUT",
          body: formData
        });
        jobMessage.textContent = "Job updated successfully!";
        cancelEditJob();
      } else {
        await request("/api/admin/jobs", {
          method: "POST",
          body: formData
        });
        jobForm.reset();
        jobMessage.textContent = "Job published successfully!";
      }
      await loadDashboard();
    } catch (err) {
      jobMessage.classList.add("error");
      jobMessage.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });
}

const cancelBtn = document.getElementById("job-cancel-btn");
if (cancelBtn) {
  cancelBtn.addEventListener("click", cancelEditJob);
}

// Settings Forms
const termsForm = document.querySelector("[data-terms-form]");
const policyForm = document.querySelector("[data-policy-form]");

if (termsForm) {
  termsForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = document.querySelector("[data-terms-message]");
    msg.classList.remove("error");
    msg.textContent = "Saving...";
    try {
      await request("/api/admin/placement/terms", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: termsForm.querySelector("textarea").value })
      });
      msg.textContent = "Terms saved successfully.";
    } catch (err) {
      msg.classList.add("error");
      msg.textContent = err.message;
    }
  });
}

if (policyForm) {
  policyForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = document.querySelector("[data-policy-message]");
    msg.classList.remove("error");
    msg.textContent = "Saving...";
    try {
      await request("/api/admin/placement/policy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: policyForm.querySelector("textarea").value })
      });
      msg.textContent = "Policy saved successfully.";
    } catch (err) {
      msg.classList.add("error");
      msg.textContent = err.message;
    }
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

// Email Modal Elements and Logic
const emailModal = document.querySelector("[data-email-modal]");
const emailForm = document.querySelector("[data-email-modal-form]");
const emailModalMessage = document.querySelector("[data-email-modal-message]");

function openEmailModal(lead) {
  if (emailModalMessage) {
    emailModalMessage.classList.remove("error");
    emailModalMessage.textContent = "";
  }
  if (emailForm) {
    emailForm.reset();
  }
  
  const leadIdInput = document.querySelector("[data-email-lead-id]");
  const recipientInput = document.querySelector("[data-email-recipient-name]");
  
  if (leadIdInput) leadIdInput.value = lead.id;
  if (recipientInput) recipientInput.value = `${lead.name} <${lead.email}>`;
  
  if (emailModal) emailModal.classList.add("visible");
}

function closeEmailModal() {
  if (emailModal) emailModal.classList.remove("visible");
}

document.querySelectorAll("[data-close-email-modal]").forEach((btn) => {
  btn.addEventListener("click", closeEmailModal);
});

if (emailForm) {
  emailForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (emailModalMessage) {
      emailModalMessage.classList.remove("error");
      emailModalMessage.textContent = "Sending email...";
    }
    
    const leadId = document.querySelector("[data-email-lead-id]").value;
    const subject = document.querySelector("#email-subject").value;
    const message = document.querySelector("#email-message").value;
    
    try {
      await request("/api/admin/leads/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, subject, message })
      });
      
      if (emailModalMessage) emailModalMessage.textContent = "Email sent successfully!";
      setTimeout(() => {
        closeEmailModal();
      }, 1500);
    } catch (error) {
      if (emailModalMessage) {
        emailModalMessage.classList.add("error");
        emailModalMessage.textContent = error.message;
      }
    }
  });
}

async function deleteLead(id) {
  if (!confirm("Are you sure you want to delete this lead?")) return;
  if (syncMessage) {
    syncMessage.classList.remove("error");
    syncMessage.textContent = "Deleting lead...";
  }
  try {
    await request(`/api/admin/leads/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (syncMessage) syncMessage.textContent = "Lead deleted successfully.";
    await loadDashboard();
  } catch (error) {
    if (syncMessage) {
      syncMessage.classList.add("error");
      syncMessage.textContent = error.message;
    }
  }
}

request("/api/admin/session")
  .then(showDashboard)
  .catch(showLogin);

// ==================== USER MANAGEMENT & RBAC LOGIC ====================

const ROLE_TEMPLATES = {
  super_admin: {
    view_dashboard: true,
    view_leads: true, edit_leads: true, delete_leads: true, export_leads: true,
    create_posts: true, edit_posts: true, delete_posts: true, publish_posts: true,
    create_jobs: true, edit_jobs: true, delete_jobs: true, view_applications: true, shortlist_candidates: true, export_applications: true,
    upload_images: true, edit_gallery: true, delete_images: true,
    view_students: true, add_students: true, edit_students: true, delete_students: true,
    add_universities: true, edit_universities: true, delete_universities: true,
    view_payments: true, verify_payments: true, refund_payments: true,
    create_users: true, edit_users: true, delete_users: true, assign_permissions: true,
    website_settings: true, seo_settings: true, smtp_settings: true, api_settings: true,
    view_reports: true, export_reports: true
  },
  content_manager: { view_dashboard: true, create_posts: true, edit_posts: true, delete_posts: true, publish_posts: true },
  lead_manager: { view_dashboard: true, view_leads: true, edit_leads: true, delete_leads: true, export_leads: true },
  job_manager: { view_dashboard: true, create_jobs: true, edit_jobs: true, delete_jobs: true, view_applications: true, shortlist_candidates: true, export_applications: true },
  gallery_manager: { view_dashboard: true, upload_images: true, edit_gallery: true, delete_images: true },
  counselor: { view_dashboard: true, view_leads: true, edit_leads: true, view_students: true, add_students: true, edit_students: true },
  accounts_executive: { view_dashboard: true, view_payments: true, verify_payments: true, refund_payments: true },
  staff: {}
};

const PERMISSION_GROUPS = {
  "Content & Gallery": { create_posts: "Create Posts", edit_posts: "Edit Posts", delete_posts: "Delete Posts", publish_posts: "Publish Posts", upload_images: "Upload Images", edit_gallery: "Edit Gallery", delete_images: "Delete Images" },
  "Leads & Students": { view_leads: "View Leads", edit_leads: "Edit Leads", delete_leads: "Delete Leads", export_leads: "Export Leads", view_students: "View Students", add_students: "Add Students", edit_students: "Edit Students", delete_students: "Delete Students" },
  "Jobs & Placements": { create_jobs: "Create Jobs", edit_jobs: "Edit Jobs", delete_jobs: "Delete Jobs", view_applications: "View Apps", shortlist_candidates: "Shortlist Candidates", export_applications: "Export Apps" },
  "Universities": { add_universities: "Add Univ", edit_universities: "Edit Univ", delete_universities: "Delete Univ" },
  "Payments": { view_payments: "View Payments", verify_payments: "Verify Payments", refund_payments: "Refund Payments" },
  "System Settings": { create_users: "Create Users", edit_users: "Edit Users", delete_users: "Delete Users", assign_permissions: "Assign Perms", website_settings: "Website Config", seo_settings: "SEO", smtp_settings: "SMTP", api_settings: "API Keys", view_reports: "View Reports", export_reports: "Export Reports", view_dashboard: "Dashboard Access" }
};

const userModal = document.querySelector("[data-user-modal]");
const userForm = document.getElementById("user-form");

function renderPermissionMatrix() {
  const container = document.getElementById("permission-matrix");
  if (!container) return;
  container.replaceChildren();

  for (const [groupName, perms] of Object.entries(PERMISSION_GROUPS)) {
    const groupDiv = document.createElement("div");
    groupDiv.className = "permission-group";
    
    const title = document.createElement("h4");
    title.innerHTML = `${groupName} <label><input type="checkbox" onchange="togglePermGroup(this, '${groupName}')"> Select All</label>`;
    groupDiv.appendChild(title);

    for (const [key, label] of Object.entries(perms)) {
      const labelEl = document.createElement("label");
      labelEl.className = "permission-checkbox";
      labelEl.innerHTML = `<input type="checkbox" name="permissions.${key}" data-group="${groupName}" value="true"> ${label}`;
      groupDiv.appendChild(labelEl);
    }
    container.appendChild(groupDiv);
  }
}

window.togglePermGroup = function(checkbox, groupName) {
  const checkboxes = document.querySelectorAll(`input[data-group="${groupName}"]`);
  checkboxes.forEach(cb => cb.checked = checkbox.checked);
};

document.getElementById("user-role")?.addEventListener("change", (e) => {
  const template = ROLE_TEMPLATES[e.target.value] || {};
  document.querySelectorAll("#permission-matrix input[type='checkbox'][name^='permissions.']").forEach(cb => {
    const key = cb.name.split(".")[1];
    cb.checked = !!template[key];
  });
});

async function loadUsersGrid() {
  try {
    const [usersRes, auditRes] = await Promise.all([
      request("/api/admin/users"),
      request("/api/admin/audit-logs")
    ]);
    renderUsers(usersRes.users || []);
    renderAuditLogs(auditRes.logs || []);
  } catch (error) {
    console.error("Failed to load users grid", error);
  }
}

function renderUsers(users) {
  const tbody = document.getElementById("users-tbody");
  if (!tbody) return;
  tbody.replaceChildren();
  
  if (!users.length) {
    tbody.innerHTML = "<tr><td colspan='6' class='empty'>No staff members found.</td></tr>";
    return;
  }
  
  users.forEach(user => {
    const tr = document.createElement("tr");
    
    const nameCell = document.createElement("td");
    nameCell.innerHTML = `<strong>${user.full_name}</strong><br><small class="muted">${user.designation || user.department || ''}</small>`;
    
    const emailCell = document.createElement("td");
    emailCell.textContent = user.email;
    
    const roleCell = document.createElement("td");
    const roleText = user.role.replace("_", " ").replace(/\b\w/g, l => l.toUpperCase());
    roleCell.innerHTML = `<span class="badge" style="background:var(--cream); border:1px solid var(--line);">${roleText}</span>`;
    
    const statusCell = document.createElement("td");
    const isLocked = user.locked_until && new Date(user.locked_until) > new Date();
    const statusClass = isLocked ? "locked" : user.status === "active" ? "active" : "inactive";
    const statusText = isLocked ? "Locked" : user.status === "active" ? "Active" : "Disabled";
    statusCell.innerHTML = `<span class="badge ${statusClass}">${statusText}</span>`;
    
    const loginCell = document.createElement("td");
    loginCell.textContent = user.last_login ? new Date(user.last_login).toLocaleString() : "Never";
    
    const actionsCell = document.createElement("td");
    actionsCell.className = "actions-cell";
    
    const editBtn = document.createElement("button");
    editBtn.className = "button sm outline";
    editBtn.textContent = "Edit";
    editBtn.onclick = () => openEditUserModal(user);
    
    actionsCell.appendChild(editBtn);
    
    if (user.id !== currentUser.userId) {
      const toggleBtn = document.createElement("button");
      toggleBtn.className = "button sm outline";
      toggleBtn.textContent = user.status === "active" ? "Disable" : "Enable";
      toggleBtn.onclick = () => toggleUserStatus(user.id, user.status === "active" ? "inactive" : "active");
      
      const resetBtn = document.createElement("button");
      resetBtn.className = "button sm outline";
      resetBtn.textContent = "Reset Pass";
      resetBtn.onclick = () => resetUserPassword(user.id);
      
      const delBtn = document.createElement("button");
      delBtn.className = "button sm danger";
      delBtn.textContent = "Del";
      delBtn.onclick = () => deleteUser(user.id);
      
      actionsCell.append(toggleBtn, resetBtn, delBtn);
    }
    
    tr.append(nameCell, emailCell, roleCell, statusCell, loginCell, actionsCell);
    tbody.appendChild(tr);
  });
}

function renderAuditLogs(logs) {
  const tbody = document.getElementById("audit-logs-tbody");
  if (!tbody) return;
  tbody.replaceChildren();
  
  if (!logs.length) {
    tbody.innerHTML = "<tr><td colspan='5' class='empty'>No audit logs available.</td></tr>";
    return;
  }
  
  logs.forEach(log => {
    const tr = document.createElement("tr");
    
    const timeCell = document.createElement("td");
    timeCell.textContent = new Date(log.created_at).toLocaleString();
    
    const userCell = document.createElement("td");
    userCell.textContent = log.admin_users ? log.admin_users.full_name : (log.user_id || "System");
    
    const actionCell = document.createElement("td");
    actionCell.textContent = log.action;
    
    const ipCell = document.createElement("td");
    ipCell.textContent = log.ip_address || "-";
    
    const detailsCell = document.createElement("td");
    detailsCell.textContent = log.details ? JSON.stringify(log.details) : "-";
    detailsCell.style.maxWidth = "200px";
    detailsCell.style.overflow = "hidden";
    detailsCell.style.textOverflow = "ellipsis";
    detailsCell.style.whiteSpace = "nowrap";
    detailsCell.title = log.details ? JSON.stringify(log.details, null, 2) : "";
    
    tr.append(timeCell, userCell, actionCell, ipCell, detailsCell);
    tbody.appendChild(tr);
  });
}

document.getElementById("btn-create-user")?.addEventListener("click", () => {
  userForm.reset();
  document.getElementById("user-id").value = "";
  document.getElementById("user-modal-title").textContent = "Create User";
  document.getElementById("user-email").disabled = false;
  document.getElementById("user-password").required = true;
  document.getElementById("user-password-field").style.display = "block";
  document.querySelectorAll("#permission-matrix input[type='checkbox']").forEach(cb => cb.checked = false);
  userModal.classList.add("visible");
});

function openEditUserModal(user) {
  userForm.reset();
  document.getElementById("user-id").value = user.id;
  document.getElementById("user-modal-title").textContent = "Edit User";
  
  document.getElementById("user-name").value = user.full_name || "";
  document.getElementById("user-email").value = user.email || "";
  document.getElementById("user-email").disabled = true; // Can't edit email easily
  
  document.getElementById("user-phone").value = user.phone || "";
  document.getElementById("user-department").value = user.department || "";
  document.getElementById("user-designation").value = user.designation || "";
  document.getElementById("user-role").value = user.role || "staff";
  document.getElementById("user-status").value = user.status || "active";
  
  document.getElementById("user-password").required = false;
  document.getElementById("user-password-field").style.display = "none";
  
  // Apply permissions
  document.querySelectorAll("#permission-matrix input[type='checkbox'][name^='permissions.']").forEach(cb => {
    const key = cb.name.split(".")[1];
    cb.checked = user.permissions && user.permissions[key] === true;
  });
  
  userModal.classList.add("visible");
}

document.querySelectorAll("[data-close-user-modal]").forEach(btn => {
  btn.addEventListener("click", () => userModal.classList.remove("visible"));
});

userForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  
  const userId = document.getElementById("user-id").value;
  const isEdit = !!userId;
  
  const permissions = {};
  document.querySelectorAll("#permission-matrix input[type='checkbox'][name^='permissions.']").forEach(cb => {
    const key = cb.name.split(".")[1];
    if (cb.checked) permissions[key] = true;
  });
  
  const formData = new FormData(userForm);
  const payload = Object.fromEntries(formData.entries());
  payload.permissions = permissions;
  
  try {
    if (isEdit) {
      await request(`/api/admin/users/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      await request(`/api/admin/users/${userId}/permissions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissions })
      });
      alert("User updated successfully");
    } else {
      await request("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      alert("User created successfully");
    }
    userModal.classList.remove("visible");
    loadUsersGrid();
  } catch (error) {
    console.error("Save user error:", error);
    alert(error.message);
  }
});

async function toggleUserStatus(id, newStatus) {
  try {
    await request(`/api/admin/users/${id}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus })
    });
    loadUsersGrid();
  } catch (error) {
    alert(error.message);
  }
}

async function deleteUser(id) {
  if (!confirm("Are you sure you want to permanently delete this user?")) return;
  try {
    await request(`/api/admin/users/${id}`, { method: "DELETE" });
    loadUsersGrid();
  } catch (error) {
    alert(error.message);
  }
}

async function resetUserPassword(id) {
  const newPassword = prompt("Enter the new password for this user:");
  if (!newPassword) return;
  try {
    await request(`/api/admin/users/${id}/reset-password`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: newPassword })
    });
    alert("Password reset successfully.");
  } catch (error) {
    alert(error.message);
  }
}

// Initialize matrix on script load
renderPermissionMatrix();
