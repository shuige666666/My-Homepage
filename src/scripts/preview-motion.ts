/** 为整屏预览编排入场和滚动旋转；不接管滚动，也不改变光碟的物理参数。 */
export function setupPreviewMotion() {
  const page = document.querySelector<HTMLElement>(".pv-page");
  if (!page) return;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const compact = window.matchMedia("(max-width: 760px)");
  const sections = Array.from(page.querySelectorAll<HTMLElement>("[data-pv-motion-section]"));
  const heroStage = page.querySelector<HTMLElement>(".pv-hero-stage") ?? page;
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  const tracks: { element: HTMLElement; animation: Animation; total: number; stagger: number }[] = [];
  let frame = 0;

  /** 入场动画先暂停，再由滚动进度逐帧推进；章节进入和反向回退都连续，不再到阈值突然播放。 */
  function buildRevealTracks() {
    page!.querySelectorAll<HTMLElement>("[data-pv-reveal]").forEach((element) => {
      const artwork = element.hasAttribute("data-pv-reveal-art");
      const stagger = Number(element.style.getPropertyValue("--pv-stagger")) || 0;
      const duration = artwork ? 1100 : 850;
      const delay = stagger * 85;
      const animation = element.animate(artwork ? [
        { opacity: .25, clipPath: "inset(10% 4% 10% 4%)", translate: "0 38px" },
        { opacity: 1, clipPath: "inset(-15% -15% -15% -15%)", translate: "0 0" },
      ] : [
        { opacity: 0, translate: "0 32px" },
        { opacity: 1, translate: "0 0" },
      ], { duration, delay, easing: "cubic-bezier(.22,1,.36,1)", fill: "both" });
      animation.pause();
      tracks.push({ element, animation, total: duration + delay, stagger });
    });
  }

  /** 从信息页自身的顶部计算位移，交接期间由画廊控制首屏整体入场。 */
  function renderScroll() {
    frame = 0;
    if (reducedMotion.matches) return;
    const height = window.innerHeight;
    const heroTop = heroStage.getBoundingClientRect().top;
    sections.forEach((section) => {
      const rect = section.getBoundingClientRect();
      if (rect.bottom < -height * .15 || rect.top > height * 1.15) return;
      const isHero = section.classList.contains("pv-hero");
      const travel = isHero ? Math.min(0, heroTop) : rect.top;
      const progress = clamp(travel / height, -1, 1);
      // 首屏的视差在停留段末尾从零速接上，避免滚动起步时昵称和明信片突然抢位。
      const eased = isHero ? progress * (1 - (1 + progress) ** 2) : progress;
      // 手机只保留很轻的位移，避免窄屏海报旋转时遮住标题或触摸入口。
      section.style.setProperty("--pv-scroll", (eased * (compact.matches ? .3 : 1)).toFixed(4));
    });
    // 已在视口内的内容（尤其首屏统计）必须完全落定；只有从视口下方进入时才渐进显现。
    tracks.forEach(({ element, animation, total, stagger }) => {
      const rect = element.getBoundingClientRect();
      const lead = height * 1.15 - stagger * 18;
      animation.currentTime = clamp((lead - rect.top) / (height * .32), 0, 1) * total;
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
      tracks.forEach(({ animation }) => animation.cancel());
      tracks.length = 0;
      sections.forEach((section) => section.style.removeProperty("--pv-scroll"));
    } else {
      if (!tracks.length) buildRevealTracks();
      // 初始化时同步推进一次，首屏元素不会先停在透明帧再等下一帧。
      renderScroll();
    }
  }

  window.addEventListener("scroll", scheduleScroll, { passive: true });
  window.addEventListener("resize", scheduleScroll, { passive: true });
  reducedMotion.addEventListener("change", syncPreference);
  compact.addEventListener("change", scheduleScroll);
  syncPreference();
}
