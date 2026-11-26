(() => {
  "use strict";

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const progressBar = document.querySelector("[data-read-progress]");
  const heroImg = document.querySelector("[data-hero-parallax]");

  let rafId = 0;

  function updateReadingState() {
    rafId = 0;
    const scrollY = window.scrollY;
    const vh = window.innerHeight || 800;
    const docMax = Math.max(1, document.documentElement.scrollHeight - vh);
    const ratio = Math.min(1, Math.max(0, scrollY / docMax));

    if (progressBar) {
      progressBar.style.transform = `scaleX(${ratio.toFixed(4)})`;
    }

    if (heroImg && !reduceMotion.matches) {
      const heroShift = Math.min(48, scrollY * 0.11);
      heroImg.style.transform = `translate3d(0, ${heroShift.toFixed(2)}px, 0)`;
    }
  }

  function scheduleUpdate() {
    if (!rafId) rafId = window.requestAnimationFrame(updateReadingState);
  }

  window.addEventListener("scroll", scheduleUpdate, { passive: true });
  window.addEventListener("resize", scheduleUpdate);

  // 点击剧照或海报灯箱放大
  const lightbox = document.querySelector("[data-ps-lightbox]");
  const lightboxImg = document.querySelector("[data-ps-lightbox-img]");
  const lightboxCap = document.querySelector("[data-ps-lightbox-cap]");
  const lightboxClose = document.querySelector("[data-ps-lightbox-close]");

  document.querySelectorAll("[data-ps-zoom]").forEach((el) => {
    el.addEventListener("click", () => {
      if (!lightbox || !lightboxImg) return;
      lightboxImg.src = el.dataset.psZoom || "";
      lightboxImg.alt = el.dataset.psCaption || "";
      if (lightboxCap) lightboxCap.textContent = el.dataset.psCaption || "";
      lightbox.showModal();
    });
  });

  lightboxClose?.addEventListener("click", () => lightbox?.close());
  lightbox?.addEventListener("click", (e) => {
    if (e.target === lightbox) lightbox.close();
  });

  updateReadingState();
})();
