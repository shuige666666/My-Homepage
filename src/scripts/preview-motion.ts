/** 为整屏预览编排入场和滚动旋转；不接管滚动，也不改变光碟的物理参数。 */
export function setupPreviewMotion() {
  const page = document.querySelector<HTMLElement>(".pv-page");
  if (!page) return;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const compact = window.matchMedia("(max-width: 760px)");
  const sections = Array.from(page.querySelectorAll<HTMLElement>("[data-pv-motion-section]"));
  const animations = new Set<Animation>();
  let frame = 0;

  // 只增强时间轴的外层标题和图表，月份照片交接仍由原时间轴脚本负责。
  page.querySelectorAll<HTMLElement>(".timeline-topline, .timeline-chart-wrap").forEach((element) => { element.dataset.pvReveal = ""; });

  /** 图像先于相邻文字落定，错开海报的到达时间，避免整页一起淡入。 */
  const reveal = new IntersectionObserver((entries) => {
    entries.forEach(({ target, isIntersecting }) => {
      if (!isIntersecting) return;
      reveal.unobserve(target);
      if (reducedMotion.matches) return;
      const element = target as HTMLElement;
      const stagger = Number(element.style.getPropertyValue("--pv-stagger")) || 0;
      const artwork = element.hasAttribute("data-pv-reveal-art");
      const animation = element.animate(artwork ? [
        { opacity: .25, clipPath: "inset(10% 4% 10% 4%)", translate: "0 38px" },
        { opacity: 1, clipPath: "inset(-15% -15% -15% -15%)", translate: "0 0" },
      ] : [
        { opacity: 0, translate: "0 32px" },
        { opacity: 1, translate: "0 0" },
      ], { duration: artwork ? 1100 : 850, delay: stagger * 85, easing: "cubic-bezier(.22,1,.36,1)", fill: "backwards" });
      animations.add(animation);
      animation.finished.then(() => animations.delete(animation)).catch(() => animations.delete(animation));
    });
  }, { threshold: .12 });
  page.querySelectorAll<HTMLElement>("[data-pv-reveal]").forEach((element) => reveal.observe(element));

  /** 用章节位置驱动内部图像，章节落在屏幕中央时回到稳定姿态。 */
  function renderScroll() {
    frame = 0;
    if (reducedMotion.matches) return;
    const height = window.innerHeight;
    const positions = sections.map((section) => ({ section, rect: section.getBoundingClientRect() }));
    positions.forEach(({ section, rect }) => {
      if (rect.bottom < -height * .15 || rect.top > height * 1.15) return;
      const origin = section.classList.contains("pv-hero") ? 80 : 0;
      const progress = Math.max(-1, Math.min(1, (rect.top - origin) / height));
      // 手机只保留很轻的位移，避免窄屏海报旋转时遮住标题或触摸入口。
      section.style.setProperty("--pv-scroll", (progress * (compact.matches ? .3 : 1)).toFixed(4));
    });
  }

  /** 事件触发时才请求一帧，静止阅读时不运行持续动画。 */
  function scheduleScroll() {
    if (!frame && !reducedMotion.matches) frame = requestAnimationFrame(renderScroll);
  }

  /** 系统减少动态效果发生变化时立即停止当前入场，并恢复静态图像。 */
  function syncPreference() {
    page!.classList.toggle("pv-motion-on", !reducedMotion.matches);
    if (reducedMotion.matches) {
      cancelAnimationFrame(frame);
      frame = 0;
      animations.forEach((animation) => animation.cancel());
      sections.forEach((section) => section.style.removeProperty("--pv-scroll"));
    } else scheduleScroll();
  }

  window.addEventListener("scroll", scheduleScroll, { passive: true });
  window.addEventListener("resize", scheduleScroll, { passive: true });
  reducedMotion.addEventListener("change", syncPreference);
  compact.addEventListener("change", scheduleScroll);
  syncPreference();
}
