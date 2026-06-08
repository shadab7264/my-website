"use strict";

document.body.classList.add("motion-ready");

fetch("/api/content/site")
  .then(res => res.json())
  .then(data => {
    const siteContent = data.content;
    if (!siteContent) return;
    document.querySelectorAll("[data-content-key]").forEach(el => {
      const key = el.getAttribute("data-content-key");
      if (siteContent[key]) {
        el.textContent = siteContent[key];
      }
    });
  })
  .catch(err => console.error("Failed to load site content", err));

const typingElement = document.querySelector("[data-typing-text]");
if (typingElement) {
  const words = [
    "College Admission",
    "Job Counselling",
    "JEE and NEET Counselling",
    "B.Ed and D.El.Ed Admission",
    "PGDCA Admission",
    "B.Lib Admission",
    "Private Jobs"
  ];
  let wordIndex = 0;
  let charIndex = 0;
  let isDeleting = false;
  let typingDelay = 100;

  function typeEffect() {
    const currentWord = words[wordIndex];
    if (isDeleting) {
      typingElement.textContent = currentWord.substring(0, charIndex - 1);
      charIndex--;
      typingDelay = 50;
    } else {
      typingElement.textContent = currentWord.substring(0, charIndex + 1);
      charIndex++;
      typingDelay = 100;
    }

    if (!isDeleting && charIndex === currentWord.length) {
      isDeleting = true;
      typingDelay = 2000;
    } else if (isDeleting && charIndex === 0) {
      isDeleting = false;
      wordIndex = (wordIndex + 1) % words.length;
      typingDelay = 500;
    }

    setTimeout(typeEffect, typingDelay);
  }

  setTimeout(typeEffect, 500);
}

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

const postsSlideshow = document.querySelector("[data-posts-slideshow]");
if (postsSlideshow) {
  const stage = postsSlideshow.querySelector("[data-posts-stage]");
  const controls = postsSlideshow.querySelector("[data-posts-controls]");
  const dotsWrapper = postsSlideshow.querySelector("[data-posts-dots]");
  const previous = postsSlideshow.querySelector("[data-posts-prev]");
  const next = postsSlideshow.querySelector("[data-posts-next]");
  let posts = [];
  let activeIndex = 0;
  let timer = null;

  function renderSlide(index) {
    if (!posts.length) return;
    activeIndex = (index + posts.length) % posts.length;
    const post = posts[activeIndex];
    stage.replaceChildren();

    const article = document.createElement("article");
    article.className = "post-card";

    const content = document.createElement("div");
    content.className = "post-content";

    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = post.category;

    const title = document.createElement("h3");
    title.textContent = post.title;

    const description = document.createElement("p");
    description.textContent = post.description;

    const time = document.createElement("time");
    time.dateTime = post.createdAt;
    time.textContent = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date(post.createdAt));

    let applyButton = null;
    if (post.showApply) {
      applyButton = document.createElement("a");
      applyButton.href = "#consultation";
      applyButton.className = "apply-btn";
      applyButton.textContent = "Apply Now";
    }

    if (applyButton) {
      content.append(tag, title, description, applyButton, time);
    } else {
      content.append(tag, title, description, time);
    }

    if (post.mediaUrl) {
      const media = post.mediaType === "video" ? document.createElement("video") : document.createElement("img");
      media.className = "post-media admission-ratio";
      media.src = post.mediaUrl;
      media.alt = post.mediaType === "image" ? post.title : "";
      if (post.mediaType === "video") {
        media.controls = true;
        media.preload = "metadata";
      } else {
        media.loading = "lazy";
      }
      article.classList.add("has-media");
      article.append(media, content);
    } else {
      article.append(content);
    }

    stage.append(article);

    dotsWrapper.querySelectorAll("button").forEach((dot, dotIndex) => {
      dot.classList.toggle("is-active", dotIndex === activeIndex);
      dot.setAttribute("aria-selected", String(dotIndex === activeIndex));
    });
  }

  function pause() {
    if (timer) window.clearInterval(timer);
  }

  function play() {
    pause();
    if (!reducedMotion && posts.length > 1) timer = window.setInterval(() => renderSlide(activeIndex + 1), 5000);
  }

  fetch("/api/content")
    .then((response) => response.json())
    .then(({ posts: fetchedPosts }) => {
      posts = fetchedPosts.slice(0, 6) || [];
      if (!posts.length) {
        stage.innerHTML = "<p class=\"muted\">Latest guidance will appear here soon.</p>";
        return;
      }
      dotsWrapper.replaceChildren();
      posts.forEach((item, index) => {
        const dot = document.createElement("button");
        dot.className = "slider-dot";
        dot.type = "button";
        dot.setAttribute("aria-label", `Show post ${index + 1}`);
        dot.setAttribute("aria-selected", "false");
        dot.addEventListener("click", () => {
          renderSlide(index);
          play();
        });
        dotsWrapper.append(dot);
      });
      controls.hidden = posts.length < 2;
      renderSlide(0);
      play();
      addReveal(document.querySelectorAll(".posts-slideshow"));
    })
    .catch(() => {
      stage.innerHTML = "<p class=\"muted\">Latest guidance will appear here soon.</p>";
    });

  previous.addEventListener("click", () => {
    renderSlide(activeIndex - 1);
    play();
  });
  next.addEventListener("click", () => {
    renderSlide(activeIndex + 1);
    play();
  });
  postsSlideshow.addEventListener("mouseenter", pause);
  postsSlideshow.addEventListener("mouseleave", play);
}

const gallerySlideshow = document.querySelector("[data-gallery-slideshow]");
if (gallerySlideshow) {
  const stage = gallerySlideshow.querySelector("[data-gallery-stage]");
  const controls = gallerySlideshow.querySelector("[data-gallery-controls]");
  const dotsWrapper = gallerySlideshow.querySelector("[data-gallery-dots]");
  const previous = gallerySlideshow.querySelector("[data-gallery-prev]");
  const next = gallerySlideshow.querySelector("[data-gallery-next]");
  let gallery = [];
  let activeGalleryIndex = 0;
  let galleryTimer = null;

  function renderGallerySlide(index) {
    if (!gallery.length) return;
    activeGalleryIndex = (index + gallery.length) % gallery.length;
    const item = gallery[activeGalleryIndex];
    stage.replaceChildren();

    const figure = document.createElement("figure");
    figure.className = "gallery-slide";
    const image = document.createElement("img");
    image.src = item.imageUrl;
    image.alt = item.title || "Skyward gallery image";
    image.loading = "lazy";

    const caption = document.createElement("figcaption");
    const title = document.createElement("h3");
    title.textContent = item.title || "Skyward Gallery";
    const description = document.createElement("p");
    description.textContent = item.description || "A glimpse from Skyward Career and Placement Hub.";
    caption.append(title, description);

    figure.append(image, caption);
    stage.append(figure);

    dotsWrapper.querySelectorAll("button").forEach((dot, dotIndex) => {
      dot.classList.toggle("is-active", dotIndex === activeGalleryIndex);
      dot.setAttribute("aria-selected", String(dotIndex === activeGalleryIndex));
    });
  }

  function pauseGallery() {
    if (galleryTimer) window.clearInterval(galleryTimer);
  }

  function playGallery() {
    pauseGallery();
    if (!reducedMotion && gallery.length > 1) galleryTimer = window.setInterval(() => renderGallerySlide(activeGalleryIndex + 1), 5000);
  }

  fetch("/api/gallery")
    .then((response) => response.json())
    .then(({ gallery: items }) => {
      gallery = items || [];
      if (!gallery.length) {
        stage.innerHTML = "<p class=\"muted\">Gallery images will appear here soon.</p>";
        return;
      }
      dotsWrapper.replaceChildren();
      gallery.forEach((item, index) => {
        const dot = document.createElement("button");
        dot.className = "slider-dot";
        dot.type = "button";
        dot.setAttribute("aria-label", `Show gallery image ${index + 1}`);
        dot.setAttribute("aria-selected", "false");
        dot.addEventListener("click", () => {
          renderGallerySlide(index);
          playGallery();
        });
        dotsWrapper.append(dot);
      });
      controls.hidden = gallery.length < 2;
      renderGallerySlide(0);
      playGallery();
      addReveal(document.querySelectorAll(".gallery-slideshow"));
    })
    .catch(() => {
      stage.innerHTML = "<p class=\"muted\">Gallery images could not be loaded.</p>";
    });

  previous.addEventListener("click", () => {
    renderGallerySlide(activeGalleryIndex - 1);
    playGallery();
  });
  next.addEventListener("click", () => {
    renderGallerySlide(activeGalleryIndex + 1);
    playGallery();
  });
  gallerySlideshow.addEventListener("mouseenter", pauseGallery);
  gallerySlideshow.addEventListener("mouseleave", playGallery);
}

// Interactive 3D Tilt Parallax Effect (0ms loading time, GPU-accelerated)
(function init3DTilt() {
  const tiltElements = document.querySelectorAll("[data-tilt]");
  const isMobile = window.matchMedia("(max-width: 768px)").matches;
  if (isMobile) return; // Disable on mobile to prevent layout shifting on touch

  tiltElements.forEach((el) => {
    el.addEventListener("mousemove", (e) => {
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      
      // Calculate tilt: max 6 degrees rotation
      const rotateX = ((centerY - y) / centerY) * 6;
      const rotateY = ((x - centerX) / centerX) * -6;
      
      el.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-6px)`;
      el.style.boxShadow = "0 30px 60px rgba(9, 43, 33, 0.12)";
      el.style.transition = "transform 100ms ease, box-shadow 100ms ease";
    });
    
    el.style.transformStyle = "preserve-3d";
    
    el.addEventListener("mouseleave", () => {
      el.style.transform = "perspective(1000px) rotateX(0deg) rotateY(0deg) translateY(0)";
      el.style.boxShadow = "";
      el.style.transition = "transform 400ms ease, box-shadow 400ms ease";
    });
  });
})();

// Premium 3D Rotating Globe Network Animation (0ms external load, GPU-accelerated)
(function init3DGlobe() {
  const canvas = document.getElementById("hero-globe-3d");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  let width = canvas.offsetWidth;
  let height = canvas.offsetHeight;
  
  // High DPI support
  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.scale(dpr, dpr);

  const points = [];
  const pointCount = 90;
  const maxDistance = 90;

  // Generate points on a sphere using Fibonacci lattice for even distribution
  for (let i = 0; i < pointCount; i++) {
    const phi = Math.acos(-1 + (2 * i) / pointCount);
    const theta = Math.sqrt(pointCount * Math.PI) * phi;
    
    // Base radius: 180px
    const r = 180;
    points.push({
      x: r * Math.sin(phi) * Math.cos(theta),
      y: r * Math.sin(phi) * Math.sin(theta),
      z: r * Math.cos(phi)
    });
  }

  let angleX = 0.0012;
  let angleY = 0.0015;

  // Interactive mouse influence
  let targetAngleX = 0.0012;
  let targetAngleY = 0.0015;
  
  window.addEventListener("mousemove", (e) => {
    const amountX = (e.clientY / window.innerHeight) - 0.5;
    const amountY = (e.clientX / window.innerWidth) - 0.5;
    // Tweak speeds based on mouse position
    targetAngleX = amountX * 0.006;
    targetAngleY = amountY * 0.006;
  });

  function rotateX(p, angle) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const y = p.y * cos - p.z * sin;
    const z = p.y * sin + p.z * cos;
    return { x: p.x, y, z };
  }

  function rotateY(p, angle) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const x = p.x * cos - p.z * sin;
    const z = p.x * sin + p.z * cos;
    return { x, y: p.y, z };
  }

  function render() {
    ctx.clearRect(0, 0, width, height);

    // Ease speeds
    angleX += (targetAngleX - angleX) * 0.05;
    angleY += (targetAngleY - angleY) * 0.05;

    // Minimum slow rotation speed
    const currentAngleX = Math.abs(angleX) < 0.0006 ? 0.0006 * Math.sign(angleX || 1) : angleX;
    const currentAngleY = Math.abs(angleY) < 0.0008 ? 0.0008 * Math.sign(angleY || 1) : angleY;

    // Rotate and project points
    const projected = points.map((p, i) => {
      // Apply rotations
      points[i] = rotateY(rotateX(p, currentAngleX), currentAngleY);
      
      const fov = 350;
      const scale = fov / (fov + points[i].z + 200);
      return {
        x: width / 2 + points[i].x * scale,
        y: height / 2 + points[i].y * scale,
        z: points[i].z,
        scale: scale
      };
    });

    // Draw connection lines
    ctx.lineWidth = 0.65;
    for (let i = 0; i < projected.length; i++) {
      for (let j = i + 1; j < projected.length; j++) {
        const p1 = projected[i];
        const p2 = projected[j];
        
        // Calculate 2D distance
        const dx = p1.x - p2.x;
        const dy = p1.y - p2.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist < maxDistance) {
          // Fade connection lines based on distance and depth
          const opacity = (1 - dist / maxDistance) * 0.14 * ((p1.scale + p2.scale) / 2);
          ctx.strokeStyle = `rgba(197, 165, 114, ${opacity})`;
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
        }
      }
    }

    // Draw nodes
    projected.forEach((p) => {
      // Node opacity based on depth z
      const opacity = Math.max(0.12, (p.z + 180) / 360) * 0.65;
      const size = Math.max(1.2, p.scale * 3.5);
      
      ctx.fillStyle = `rgba(197, 165, 114, ${opacity})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, size, 0, 2 * Math.PI);
      ctx.fill();
    });

    requestAnimationFrame(render);
  }

  // Handle window resizing
  window.addEventListener("resize", () => {
    width = canvas.offsetWidth;
    height = canvas.offsetHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
  });

  render();
})();
