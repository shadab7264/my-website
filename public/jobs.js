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
  const jobsGrid = document.querySelector("[data-jobs-grid]");
  const jobsCount = document.querySelector("[data-jobs-count]");
  const pagination = document.querySelector("[data-jobs-pagination]");
  
  const searchInput = document.querySelector("[data-search-keyword]");
  const locationInput = document.querySelector("[data-search-location]");
  const categorySelect = document.querySelector("[data-search-category]");
  const searchBtn = document.querySelector("[data-search-submit]");
  
  const filterPanel = document.getElementById("jobs-filters");
  const filterToggle = document.querySelector("[data-filter-toggle]");
  const clearFiltersBtn = document.querySelector("[data-clear-filters]");
  
  const levelChecks = document.querySelectorAll("input[name='level']");
  const typeChecks = document.querySelectorAll("input[name='type']");
  const modeChecks = document.querySelectorAll("input[name='mode']");
  const salaryMinInput = document.querySelector("[data-salary-min]");
  const salaryMaxInput = document.querySelector("[data-salary-max]");

  let currentPage = 1;
  const limit = 12;

  // Load categories
  async function loadCategories() {
    try {
      const res = await fetch("/api/job-categories");
      const data = await res.json();
      if (data.categories) {
        data.categories.forEach(cat => {
          const opt = document.createElement("option");
          opt.value = cat.slug;
          opt.textContent = cat.name;
          categorySelect.appendChild(opt);
        });
      }
    } catch (e) {
      console.error("Failed to load categories:", e);
    }
  }

  // Fetch and render jobs
  async function fetchJobs() {
    jobsGrid.innerHTML = '<p class="muted">Loading jobs...</p>';
    
    // Build query params
    const params = new URLSearchParams({
      page: currentPage,
      limit: limit,
      q: searchInput.value.trim(),
      location: locationInput.value.trim(),
      category: categorySelect.value
    });

    // Filters
    const level = Array.from(levelChecks).find(c => c.checked)?.value;
    const type = Array.from(typeChecks).find(c => c.checked)?.value;
    const mode = Array.from(modeChecks).find(c => c.checked)?.value;
    
    if (level) params.append("level", level);
    if (type) params.append("type", type);
    if (mode) params.append("mode", mode);
    if (salaryMinInput.value) params.append("salaryMin", salaryMinInput.value * 100000); // Convert LPA to absolute
    if (salaryMaxInput.value) params.append("salaryMax", salaryMaxInput.value * 100000);

    // Update URL quietly
    window.history.replaceState({}, "", `/jobs?${params.toString()}`);

    try {
      const res = await fetch(`/api/jobs?${params.toString()}`);
      const data = await res.json();
      renderJobs(data.jobs || [], data.total || 0);
      renderPagination(data.total || 0);
    } catch (e) {
      console.error("Failed to fetch jobs:", e);
      jobsGrid.innerHTML = '<p class="error">Failed to load jobs. Please try again later.</p>';
      jobsCount.textContent = "0 jobs found";
    }
  }

  function formatSalary(min, max, period = "Yearly") {
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
  }

  function formatExp(min, max, level = "") {
    if (level === "Fresher" || (min === 0 && max === 0)) return "No Experience Needed";
    if (!min && !max) return "Any Experience";
    if (min && !max) return `${min}+ Years`;
    if (!min && max) return `Up to ${max} Years`;
    return `${min}-${max} Years`;
  }

  function formatLoc(loc) {
    if (!loc) return "India";
    const parts = loc.split(',').map(s => s.trim()).filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : "India";
  }

  function renderJobs(jobs, total) {
    jobsCount.textContent = `${total} job${total !== 1 ? 's' : ''} found`;
    jobsGrid.replaceChildren();

    if (jobs.length === 0) {
      jobsGrid.innerHTML = '<div class="empty-state"><h3>No jobs found</h3><p>Try adjusting your search or filters.</p></div>';
      return;
    }

    jobs.forEach(job => {
      const card = document.createElement("a");
      card.className = `job-card ${job.is_featured ? 'featured' : ''}`;
      card.href = `/jobs/${job.slug}`;

      let logoHtml = '';
      if (job.company_logo_url) {
        logoHtml = `<img src="${job.company_logo_url}" alt="${job.company_name} logo" class="job-card-logo">`;
      } else {
        const initial = job.company_name.charAt(0).toUpperCase();
        logoHtml = `<div class="job-card-logo-placeholder">${initial}</div>`;
      }

      const cleanLocation = formatLoc(job.location);

      card.innerHTML = `
        <div class="job-card-header">
          ${logoHtml}
          <div>
            <h3 class="job-card-title">${job.title}</h3>
            <p class="job-card-company">${job.company_name}</p>
          </div>
        </div>
        <div class="job-card-tags">
          <span class="job-tag location" title="${cleanLocation}">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"></path><circle cx="12" cy="10" r="3"></circle></svg>
            <span>${cleanLocation}</span>
          </span>
          <span class="job-tag salary">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="9" x2="16" y2="9"></line><line x1="6" y1="13" x2="18" y2="13"></line><path d="M6 5h12a4 4 0 0 1 0 8H6c0 0 6 6 10 11"></path></svg>
            <span>${formatSalary(job.salary_min, job.salary_max, job.salary_period)}</span>
          </span>
          <span class="job-tag experience">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path></svg>
            <span>${formatExp(job.experience_min, job.experience_max, job.experience_level)}</span>
          </span>
          <span class="job-tag type">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
            <span>${job.employment_type}</span>
          </span>
        </div>
        <div class="job-card-footer">
          <span class="job-date">Posted ${new Date(job.created_at).toLocaleDateString('en-IN', {day: 'numeric', month: 'short'})}</span>
          <div class="job-card-actions" style="display: flex; gap: 8px; align-items: center;">
            <button class="button sm outline share-btn" title="Share Job" type="button" data-share-title="${job.title}" data-share-slug="${job.slug}" style="padding: 0 10px; display: flex; align-items: center; justify-content: center; height: 36px; min-width: 36px;">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path><polyline points="16 6 12 2 8 6"></polyline><line x1="12" y1="2" x2="12" y2="15"></line></svg>
            </button>
            <span class="button sm gold">View & Apply</span>
          </div>
        </div>
      `;
      jobsGrid.appendChild(card);
    });
  }

  function renderPagination(total) {
    pagination.replaceChildren();
    const totalPages = Math.ceil(total / limit);
    if (totalPages <= 1) return;

    for (let i = 1; i <= totalPages; i++) {
      const btn = document.createElement("button");
      btn.className = `page-btn ${i === currentPage ? 'active' : ''}`;
      btn.textContent = i;
      btn.addEventListener("click", () => {
        currentPage = i;
        fetchJobs();
        window.scrollTo({ top: document.querySelector('.jobs-section').offsetTop - 100, behavior: 'smooth' });
      });
      pagination.appendChild(btn);
    }
  }

  // Event Listeners
  searchBtn.addEventListener("click", () => {
    currentPage = 1;
    fetchJobs();
  });

  searchInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      currentPage = 1;
      fetchJobs();
    }
  });

  // Debounced filter changes
  let filterTimeout;
  const onFilterChange = () => {
    clearTimeout(filterTimeout);
    filterTimeout = setTimeout(() => {
      currentPage = 1;
      fetchJobs();
    }, 500);
  };

  [...levelChecks, ...typeChecks, ...modeChecks].forEach(cb => {
    // Only allow one checkbox per group to act like radio for simplicity, or handle arrays in backend.
    // Backend API currently accepts single values for type/mode/level.
    cb.addEventListener("change", (e) => {
      if (e.target.checked) {
        const groupName = e.target.name;
        document.querySelectorAll(`input[name='${groupName}']`).forEach(other => {
          if (other !== e.target) other.checked = false;
        });
      }
      onFilterChange();
    });
  });

  categorySelect.addEventListener("change", onFilterChange);
  salaryMinInput.addEventListener("input", onFilterChange);
  salaryMaxInput.addEventListener("input", onFilterChange);

  clearFiltersBtn.addEventListener("click", () => {
    [...levelChecks, ...typeChecks, ...modeChecks].forEach(cb => cb.checked = false);
    salaryMinInput.value = "";
    salaryMaxInput.value = "";
    categorySelect.value = "";
    searchInput.value = "";
    locationInput.value = "";
    currentPage = 1;
    fetchJobs();
  });

  filterToggle.addEventListener("click", () => {
    filterPanel.classList.toggle("active");
  });

  // Initial load
  loadCategories().then(() => {
    // Parse URL params on load
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("q")) searchInput.value = urlParams.get("q");
    if (urlParams.get("location")) locationInput.value = urlParams.get("location");
    if (urlParams.get("category")) categorySelect.value = urlParams.get("category");
    if (urlParams.get("level")) document.querySelector(`input[name='level'][value='${urlParams.get("level")}']`)?.setAttribute("checked", "true");
    if (urlParams.get("type")) document.querySelector(`input[name='type'][value='${urlParams.get("type")}']`)?.setAttribute("checked", "true");
    if (urlParams.get("mode")) document.querySelector(`input[name='mode'][value='${urlParams.get("mode")}']`)?.setAttribute("checked", "true");
    if (urlParams.get("salaryMin")) salaryMinInput.value = urlParams.get("salaryMin") / 100000;
    if (urlParams.get("salaryMax")) salaryMaxInput.value = urlParams.get("salaryMax") / 100000;
    if (urlParams.get("page")) currentPage = parseInt(urlParams.get("page")) || 1;
    
    fetchJobs();
  });

  // Share Button Action Handler
  document.addEventListener("click", async (e) => {
    const shareBtn = e.target.closest(".share-btn");
    if (shareBtn) {
      e.preventDefault();
      e.stopPropagation();
      const title = shareBtn.getAttribute("data-share-title");
      const slug = shareBtn.getAttribute("data-share-slug");
      const url = `${window.location.origin}/jobs/${slug}`;

      if (navigator.share) {
        try {
          await navigator.share({
            title: `Job Opening: ${title} at Skyward`,
            text: `Check out this job opening: ${title}`,
            url: url
          });
        } catch (err) {
          if (err.name !== "AbortError") {
            console.error("Share failed:", err);
          }
        }
      } else {
        // Fallback: Copy to clipboard
        try {
          await navigator.clipboard.writeText(url);
          showToast("Job link copied to clipboard!");
        } catch (err) {
          console.error("Clipboard copy failed:", err);
        }
      }
    }
  });

  function showToast(message) {
    let toast = document.getElementById("share-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "share-toast";
      toast.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        background: var(--navy, #092b21);
        color: white;
        padding: 12px 24px;
        border-radius: 8px;
        border: 1px solid var(--gold, #c5a572);
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
        z-index: 9999;
        font-size: 14px;
        font-family: 'Outfit', sans-serif;
        transform: translateY(100px);
        opacity: 0;
        transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.35s ease;
      `;
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    requestAnimationFrame(() => {
      toast.style.transform = "translateY(0)";
      toast.style.opacity = "1";
    });
    
    if (toast.timeoutId) clearTimeout(toast.timeoutId);
    toast.timeoutId = setTimeout(() => {
      toast.style.transform = "translateY(100px)";
      toast.style.opacity = "0";
    }, 3000);
  }
});
