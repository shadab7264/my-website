"use strict";

document.body.classList.add("motion-ready");

// Floating Header Scroll Effect
const header = document.querySelector(".site-header");
if (header) {
  const handleScroll = () => {
    if (window.scrollY > 40) {
      header.classList.add("scrolled");
    } else {
      header.classList.remove("scrolled");
    }
  };
  window.addEventListener("scroll", handleScroll, { passive: true });
  handleScroll(); // Run immediately on load
}

document.addEventListener("DOMContentLoaded", () => {
  const slug = window.location.pathname.split("/").pop();
  if (!slug || slug === "jobs") {
    window.location.href = "/jobs";
    return;
  }

  let currentJobId = null;

  // DOM Elements
  const jobTitle = document.getElementById("job-title");
  const jobCompany = document.getElementById("job-company");
  const logoContainer = document.getElementById("job-logo-container");
  const jobStats = document.getElementById("job-stats");
  const jobDesc = document.getElementById("job-description-content");
  const jobSkills = document.getElementById("job-skills");
  const jobOpeningsText = document.getElementById("job-openings-text");
  
  // Modal Elements
  const modal = document.getElementById("application-modal");
  const startBtn = document.getElementById("start-application-btn");
  const closeBtn = document.getElementById("close-app-modal");
  const modalJobTitle = document.getElementById("modal-job-title");
  const modalJobCompany = document.getElementById("modal-job-company");
  
  // Form Elements
  const form = document.getElementById("application-form");
  const steps = document.querySelectorAll(".app-step[data-step]");
  const progressBar = document.getElementById("app-progress-bar");
  const appMessage = document.getElementById("app-message");
  const successStep = document.getElementById("app-success");
  
  const fresherRadios = document.querySelectorAll("input[name='employment_status']");
  const expFields = document.getElementById("experienced-fields");

  let currentStep = 1;
  const totalSteps = steps.length;

  // --- Auto-upload Resume State & Event Listeners ---
  let isUploading = false;
  const resumeInput = document.getElementById("app-resume");
  const uploadBox = document.querySelector(".upload-box");

  // Create hidden inputs to hold pre-uploaded details
  let hiddenUrlInput = document.getElementById("uploaded-resume-url");
  let hiddenNameInput = document.getElementById("uploaded-resume-name");

  if (!hiddenUrlInput && form) {
    hiddenUrlInput = document.createElement("input");
    hiddenUrlInput.type = "hidden";
    hiddenUrlInput.id = "uploaded-resume-url";
    hiddenUrlInput.name = "uploaded_resume_url";
    form.appendChild(hiddenUrlInput);
  }
  if (!hiddenNameInput && form) {
    hiddenNameInput = document.createElement("input");
    hiddenNameInput.type = "hidden";
    hiddenNameInput.id = "uploaded-resume-name";
    hiddenNameInput.name = "uploaded_resume_name";
    form.appendChild(hiddenNameInput);
  }

  // Create status label for user feedback
  let uploadStatusText = document.getElementById("upload-status-text");
  if (!uploadStatusText && uploadBox) {
    uploadStatusText = document.createElement("p");
    uploadStatusText.id = "upload-status-text";
    uploadStatusText.style.fontSize = "13px";
    uploadStatusText.style.marginTop = "8px";
    uploadStatusText.style.fontWeight = "500";
    uploadBox.appendChild(uploadStatusText);
  }

  resumeInput?.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    isUploading = true;
    uploadStatusText.style.color = "var(--navy)";
    uploadStatusText.textContent = "Uploading resume to secure storage...";
    resumeInput.disabled = true;

    try {
      const formData = new FormData();
      formData.append("resume", file);

      const res = await fetch("/api/upload-resume", {
        method: "POST",
        body: formData
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");

      hiddenUrlInput.value = data.resumeUrl;
      hiddenNameInput.value = data.resumeName;

      uploadStatusText.style.color = "var(--success)";
      uploadStatusText.textContent = `✓ Uploaded: ${data.resumeName}`;
    } catch (err) {
      uploadStatusText.style.color = "var(--danger)";
      uploadStatusText.textContent = `❌ Upload failed: ${err.message}`;
      resumeInput.value = "";
      hiddenUrlInput.value = "";
      hiddenNameInput.value = "";
    } finally {
      resumeInput.disabled = false;
      isUploading = false;
    }
  });

  // --- 1. Fetch & Render Job Data ---
  async function loadJobDetails() {
    try {
      const res = await fetch(`/api/jobs/${slug}`);
      if (!res.ok) throw new Error("Job not found");
      const data = await res.json();
      const job = data.job;
      currentJobId = job.id;

      // Populate UI
      jobTitle.textContent = job.title;
      jobCompany.textContent = job.company_name;
      modalJobTitle.textContent = `Apply: ${job.title}`;
      modalJobCompany.textContent = job.company_name;

      if (job.company_logo_url) {
        logoContainer.innerHTML = `<img src="${job.company_logo_url}" alt="${job.company_name}" class="detail-logo">`;
      } else {
        logoContainer.innerHTML = `<div class="detail-logo-placeholder">${job.company_name.charAt(0).toUpperCase()}</div>`;
      }

      // Stats
      const formatSal = (min, max, period = "Yearly") => {
        if (!min && !max) return "Not Disclosed";
        const isMonthly = period === "Monthly";
        const unit = isMonthly ? "/ Month" : "LPA";
        const formatNumber = (val) => {
          if (isMonthly) {
            return val >= 1000 ? `${(val / 1000).toFixed(0)}K` : val;
          } else {
            return `${(val / 100000).toFixed(1)}`;
          }
        };

        if (min && !max) return `₹${formatNumber(min)} ${unit}+`;
        if (!min && max) return `Up to ₹${formatNumber(max)} ${unit}`;
        return `₹${formatNumber(min)} - ${formatNumber(max)} ${unit}`;
      };
      
      const formatExp = (min, max, level = "") => {
        if (level === "Fresher" || (min === 0 && max === 0)) return "No Experience Needed";
        if (!min && !max) return "Any Experience";
        if (min && !max) return `${min}+ Years`;
        if (!min && max) return `Up to ${max} Years`;
        return `${min}-${max} Years`;
      };

      const formatLoc = (loc) => {
        if (!loc) return "India";
        const parts = loc.split(',').map(s => s.trim()).filter(Boolean);
        return parts.length > 0 ? parts.join(', ') : "India";
      };

      jobStats.innerHTML = `
        <div class="stat-item">
          <span class="icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"></path><circle cx="12" cy="10" r="3"></circle></svg>
          </span>
          <div><strong>Location</strong><br>${formatLoc(job.location)}</div>
        </div>
        <div class="stat-item">
          <span class="icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="9" x2="16" y2="9"></line><line x1="6" y1="13" x2="18" y2="13"></line><path d="M6 5h12a4 4 0 0 1 0 8H6c0 0 6 6 10 11"></path></svg>
          </span>
          <div><strong>Salary</strong><br>${formatSal(job.salary_min, job.salary_max, job.salary_period)}</div>
        </div>
        <div class="stat-item">
          <span class="icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path></svg>
          </span>
          <div><strong>Experience</strong><br>${formatExp(job.experience_min, job.experience_max, job.experience_level)}</div>
        </div>
        <div class="stat-item">
          <span class="icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
          </span>
          <div><strong>Type</strong><br>${job.employment_type}</div>
        </div>
        <div class="stat-item">
          <span class="icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"></path><circle cx="12" cy="10" r="3"></circle></svg>
          </span>
          <div><strong>Work Mode</strong><br>${job.work_mode}</div>
        </div>
        ${job.job_categories ? `
        <div class="stat-item">
          <span class="icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"></path></svg>
          </span>
          <div><strong>Category</strong><br>${job.job_categories.name}</div>
        </div>` : ''}
      `;

      jobDesc.innerHTML = `<div style="white-space: pre-wrap;">${job.description}</div>`;

      if (job.skills_required && job.skills_required.length) {
        jobSkills.innerHTML = job.skills_required.map(s => `<span class="skill-tag">${s}</span>`).join("");
      } else {
        jobSkills.innerHTML = "<p class='muted'>No specific skills listed.</p>";
      }

      jobOpeningsText.textContent = `${job.openings} opening${job.openings !== 1 ? 's' : ''} available.`;

      // Update document title for SEO
      document.title = `${job.title} at ${job.company_name} | Skyward Career Hub`;

    } catch (e) {
      document.getElementById("job-content").innerHTML = `
        <div class="empty-state">
          <h2>Job not found</h2>
          <p>This position may have been closed or removed.</p>
          <a href="/jobs" class="button gold mt-4">Browse other jobs</a>
        </div>
      `;
      document.querySelector(".job-apply-col").style.display = "none";
    }
  }

  // --- 2. Modal & Form Navigation ---
  startBtn?.addEventListener("click", () => {
    modal.classList.add("visible");
    document.body.style.overflow = "hidden";
  });

  closeBtn?.addEventListener("click", () => {
    modal.classList.remove("visible");
    document.body.style.overflow = "";
  });

  function updateStep() {
    steps.forEach(s => s.classList.remove("active"));
    document.querySelector(`.app-step[data-step="${currentStep}"]`).classList.add("active");
    progressBar.style.width = `${(currentStep / totalSteps) * 100}%`;
  }

  document.querySelectorAll(".next-step-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      // Basic validation for current step
      const currentStepEl = document.querySelector(`.app-step[data-step="${currentStep}"]`);
      const requiredInputs = currentStepEl.querySelectorAll("input[required], select[required]");
      let valid = true;
      requiredInputs.forEach(input => {
        if (!input.value) {
          input.reportValidity();
          valid = false;
        }
      });
      if (!valid) return;

      if (currentStep < totalSteps) {
        currentStep++;
        updateStep();
      }
    });
  });

  document.querySelectorAll(".prev-step-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      if (currentStep > 1) {
        currentStep--;
        updateStep();
      }
    });
  });

  // Toggle experienced fields
  fresherRadios.forEach(r => {
    r.addEventListener("change", (e) => {
      if (e.target.value === "Experienced") {
        expFields.classList.remove("hidden");
      } else {
        expFields.classList.add("hidden");
      }
    });
  });

  // --- 3. Form Submission ---
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentJobId) return;

    if (isUploading) {
      appMessage.classList.add("error");
      appMessage.textContent = "Please wait for your resume upload to finish.";
      return;
    }

    appMessage.classList.remove("error");
    appMessage.textContent = "Submitting application...";
    
    const submitBtn = form.querySelector("button[type='submit']");
    submitBtn.disabled = true;

    try {
      const formData = new FormData(form);
      const res = await fetch(`/api/jobs/${currentJobId}/apply`, {
        method: "POST",
        body: formData // Let browser set multipart boundary
      });
      
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Submission failed");

      // Show Success Step
      form.style.display = "none";
      progressBar.style.width = "100%";
      document.querySelector(".app-progress").style.display = "none";
      successStep.style.display = "block";
      document.getElementById("success-app-id").textContent = payload.applicationId;
      
    } catch (err) {
      appMessage.classList.add("error");
      appMessage.textContent = err.message;
      submitBtn.disabled = false;
    }
  });

  // Init
  loadJobDetails();
});
