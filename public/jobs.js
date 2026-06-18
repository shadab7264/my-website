"use strict";

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

  function formatSalary(min, max) {
    if (!min && !max) return "Not Disclosed";
    if (min && !max) return `₹${(min/100000).toFixed(1)} LPA+`;
    if (!min && max) return `Up to ₹${(max/100000).toFixed(1)} LPA`;
    return `₹${(min/100000).toFixed(1)} - ${(max/100000).toFixed(1)} LPA`;
  }

  function formatExp(min, max) {
    if (!min && !max) return "Any Experience";
    if (min === 0 && max === 0) return "Fresher";
    if (min && !max) return `${min}+ Years`;
    if (!min && max) return `Up to ${max} Years`;
    return `${min}-${max} Years`;
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

      card.innerHTML = `
        <div class="job-card-header">
          ${logoHtml}
          <div>
            <h3 class="job-card-title">${job.title}</h3>
            <p class="job-card-company">${job.company_name}</p>
          </div>
        </div>
        <div class="job-card-tags">
          <span class="job-tag location" title="${job.location}">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"></path><circle cx="12" cy="10" r="3"></circle></svg>
            <span>${job.location}</span>
          </span>
          <span class="job-tag salary">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="9" x2="16" y2="9"></line><line x1="6" y1="13" x2="18" y2="13"></line><path d="M6 5h12a4 4 0 0 1 0 8H6c0 0 6 6 10 11"></path></svg>
            <span>${formatSalary(job.salary_min, job.salary_max)}</span>
          </span>
          <span class="job-tag experience">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path></svg>
            <span>${formatExp(job.experience_min, job.experience_max)}</span>
          </span>
          <span class="job-tag type">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
            <span>${job.employment_type}</span>
          </span>
        </div>
        <div class="job-card-footer">
          <span class="job-date">Posted ${new Date(job.created_at).toLocaleDateString('en-IN', {day: 'numeric', month: 'short'})}</span>
          <span class="button sm outline">View & Apply</span>
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
});
