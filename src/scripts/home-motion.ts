const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
const shell = document.querySelector<HTMLElement>(".page-shell")!;
const ease = "cubic-bezier(0.22, 1, 0.36, 1)";

/** 内容进入视口后只展开一次，默认 HTML 始终可读，不依赖脚本解除隐藏。 */
const reveal = (element: Element, delay = 0) => {
  if (reducedMotion.matches) return;
  element.animate(
    [{ opacity: 0, translate: "0 12px" }, { opacity: 1, translate: "0 0" }],
    { duration: 560, delay, easing: ease, fill: "backwards" },
  );
};

// 1. 个人资料按阅读顺序展开；使用独立 translate，保留原有 hover transform。
const sections = new IntersectionObserver((entries) => {
  entries.forEach(({ target, isIntersecting }) => {
    if (!isIntersecting) return;
    target.classList.add("is-visible");
    if (target.matches(".profile-hero")) {
      target.querySelectorAll(".profile-avatar, .eyebrow, h1, .subtitle, .introduction, .stat, .bangumi-link")
        .forEach((element, index) => reveal(element, index * 45));
    } else {
      reveal(target.querySelector(".section-heading") ?? target);
    }
    sections.unobserve(target);
  });
}, { threshold: 0.12 });
shell.querySelectorAll(".reveal").forEach((section) => sections.observe(section));

// 2. 横向滚动中新出现的封面也能展开，已经浏览过的卡片不会重复播放。
const cards = new IntersectionObserver((entries) => {
  let order = 0;
  entries.forEach(({ target, isIntersecting }) => {
    if (!isIntersecting) return;
    reveal(target, Math.min(order++, 5) * 55);
    cards.unobserve(target);
  });
}, { threshold: 0.15 });
shell.querySelectorAll(".favorite-card, .recent-card, .review-card").forEach((card) => cards.observe(card));

/** 归位时清除倾斜变量，让鼠标离开和系统动效设置变更使用同一套收尾。 */
const resetCover = (cover: HTMLElement) => {
  cover.style.removeProperty("--tilt-x");
  cover.style.removeProperty("--tilt-y");
  cover.style.removeProperty("--cover-x");
  cover.style.removeProperty("--cover-y");
};

// 3. 仅精细指针启用轻倾斜，每帧最多写入一次，空闲时不运行渲染循环。
shell.querySelectorAll<HTMLElement>(".favorite-card").forEach((card) => {
  const cover = card.querySelector<HTMLElement>(".cover-frame")!;
  let frame = 0;
  card.addEventListener("pointermove", (event) => {
    if (reducedMotion.matches || !finePointer.matches || event.pointerType === "touch") return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const bounds = card.getBoundingClientRect();
      const x = (event.clientX - bounds.left) / bounds.width - 0.5;
      const y = (event.clientY - bounds.top) / bounds.height - 0.5;
      cover.style.setProperty("--tilt-x", `${-y * 4}deg`);
      cover.style.setProperty("--tilt-y", `${x * 4}deg`);
      cover.style.setProperty("--cover-x", `${x * -4}px`);
      cover.style.setProperty("--cover-y", `${y * -4}px`);
    });
  });
  /** 离开卡片时取消尚未执行的帧，避免归位后被旧坐标再次倾斜。 */
  const reset = () => { cancelAnimationFrame(frame); resetCover(cover); };
  card.addEventListener("pointerleave", reset);
  card.addEventListener("pointercancel", reset);
  finePointer.addEventListener("change", reset);
  reducedMotion.addEventListener("change", reset);
});

reducedMotion.addEventListener("change", () => {
  if (!reducedMotion.matches) return;
  // 系统开启减少动态效果时，立即结束数据主页中的脚本动画。
  shell.getAnimations({ subtree: true }).forEach((animation) => animation.cancel());
});
