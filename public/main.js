"use strict";

document.body.classList.add("motion-ready");

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let revealObserver = null;

if (!reducedMotion && "IntersectionObserver" in window) {
  revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          revealObserver.unobserve(entry.target);
        }
      });
    },
    { rootMargin: "0px 0px -10% 0px", threshold: 0.14 }
  );
}

function addReveal(elements) {
  elements.forEach((element, index) => {
    if (element.classList.contains("reveal")) return;
    element.classList.add("reveal");
    element.style.setProperty("--reveal-delay", `${Math.min(index % 4, 3) * 85}ms`);
    if (reducedMotion || !revealObserver) {
      element.classList.add("is-visible");
    } else {
      revealObserver.observe(element);
    }
  });
}

addReveal(
  document.querySelectorAll(
    ".section-heading, .service-card, .journey-copy, .step, .cta-panel, .story-card, .text-content, .value, .contact-item, .contact-form, .detail-slider"
  )
);

const navToggle = document.querySelector(".menu-toggle");
const navigation = document.querySelector(".main-nav");
if (navToggle && navigation) {
  navToggle.addEventListener("click", () => {
    const open = navigation.classList.toggle("open");
    navToggle.setAttribute("aria-expanded", String(open));
  });
}

document.querySelectorAll("[data-slider]").forEach((slider) => {
  const slides = Array.from(slider.querySelectorAll("[data-slide]"));
  const dots = Array.from(slider.querySelectorAll("[data-slide-to]"));
  const previous = slider.querySelector("[data-slide-prev]");
  const next = slider.querySelector("[data-slide-next]");
  let activeIndex = 0;
  let timer = null;

  function showSlide(index) {
    activeIndex = (index + slides.length) % slides.length;
    slides.forEach((slide, slideIndex) => {
      const active = slideIndex === activeIndex;
      slide.classList.toggle("is-active", active);
      slide.setAttribute("aria-hidden", String(!active));
    });
    dots.forEach((dot, dotIndex) => {
      const active = dotIndex === activeIndex;
      dot.classList.toggle("is-active", active);
      dot.setAttribute("aria-selected", String(active));
    });
  }

  function pause() {
    if (timer) window.clearInterval(timer);
  }

  function play() {
    pause();
    if (!reducedMotion) timer = window.setInterval(() => showSlide(activeIndex + 1), 6000);
  }

  dots.forEach((dot, index) => dot.addEventListener("click", () => {
    showSlide(index);
    play();
  }));
  previous.addEventListener("click", () => {
    showSlide(activeIndex - 1);
    play();
  });
  next.addEventListener("click", () => {
    showSlide(activeIndex + 1);
    play();
  });
  slider.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") showSlide(activeIndex - 1);
    if (event.key === "ArrowRight") showSlide(activeIndex + 1);
  });
  slider.addEventListener("mouseenter", pause);
  slider.addEventListener("mouseleave", play);
  slider.addEventListener("focusin", pause);
  slider.addEventListener("focusout", play);
  play();
});

document.querySelectorAll("[data-lead-form]").forEach((form) => {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = form.querySelector(".form-message");
    const submit = form.querySelector("button[type='submit']");
    const formData = Object.fromEntries(new FormData(form).entries());
    message.classList.remove("error");
    message.textContent = "Sending your request...";
    submit.disabled = true;

    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData)
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      form.reset();
      message.textContent = payload.message;
    } catch (error) {
      message.classList.add("error");
      message.textContent = error.message || "Please try again or call our office.";
    } finally {
      submit.disabled = false;
    }
  });
});

const postGrid = document.querySelector("[data-posts]");
if (postGrid) {
  fetch("/api/content")
    .then((response) => response.json())
    .then(({ posts }) => {
      postGrid.innerHTML = "";
      posts.slice(0, 6).forEach((post) => {
        const article = document.createElement("article");
        article.className = "post-card";

        const tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = post.category;
        if (post.mediaUrl) {
          const media = post.mediaType === "video" ? document.createElement("video") : document.createElement("img");
          media.className = "post-media";
          media.src = post.mediaUrl;
          media.alt = post.mediaType === "image" ? post.title : "";
          if (post.mediaType === "video") {
            media.controls = true;
            media.preload = "metadata";
          } else {
            media.loading = "lazy";
          }
          article.append(media);
        }
        const title = document.createElement("h3");
        title.textContent = post.title;
        const description = document.createElement("p");
        description.textContent = post.description;
        const time = document.createElement("time");
        time.dateTime = post.createdAt;
        time.textContent = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date(post.createdAt));

        article.append(tag, title, description, time);
        postGrid.append(article);
      });
      addReveal(postGrid.querySelectorAll(".post-card"));
    })
    .catch(() => {
      postGrid.innerHTML = "<p class=\"muted\">Latest guidance will appear here soon.</p>";
    });
}
