const OPENING_SECTIONS = ["hero", "collection", "journal"] as const;
type Section = typeof OPENING_SECTIONS[number] | "reviews" | "memories";
type Direction = -1 | 1;

export interface PreviewSnapDetail {
  phase: "start" | "progress" | "end" | "cancel";
  from: Section;
  to: Section;
  direction: Direction;
  progress: number;
  reversing: boolean;
}

interface SnapRoute {
  from: Section;
  to: Section;
  direction: Direction;
  target: number;
}

const WHEEL_THRESHOLD = 36;
const GESTURE_GAP = 135;
const REVIEW_WHEEL_PAUSE = 260;

/** 求解 cubic-bezier(.32, 0, .18, 1)，起步有加速，后半段逐渐收住。 */
function pageEase(time: number) {
  const cubic = (t: number, a: number, b: number) => 3 * t * (1 - t) * (a * (1 - t) + b * t) + t ** 3;
  let low = 0;
  let high = 1;
  for (let i = 0; i < 16; i++) {
    const t = (low + high) / 2;
    if (cubic(t, .32, .18) < time) low = t;
    else high = t;
  }
  return cubic((low + high) / 2, 0, 1);
}

/** 在相邻整屏之间换页，长章节内部保持连续滚动。 */
export function setupPreviewSnap() {
  const collection = document.querySelector<HTMLElement>("#preview-collection");
  const journal = document.querySelector<HTMLElement>("#preview-journal");
  const reviewAnchor = document.querySelector<HTMLElement>("#preview-reviews");
  const reviews = document.querySelector<HTMLElement>("[data-pv-reviews]");
  const memories = document.querySelector<HTMLElement>("#preview-memories");
  if (!collection || !journal || !reviewAnchor || !reviews || !memories) return;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let frame = 0;
  let wheelAt = -Infinity;
  let usedWheelDirection: Direction | null = null;
  let wheelDelta = 0;
  let reviewWheelPausedUntil = 0;
  let oppositeDelta = 0;
  let touch: { x: number; y: number; used: boolean } | null = null;
  let active: (SnapRoute & { progress: number; writtenY: number; reversing: boolean }) | null = null;

  /** 短评的交接点在停留区末尾，窄屏则对齐短评底部。 */
  function reviewExitOffset() {
    return memories!.getBoundingClientRect().top - Math.min(reviews!.offsetHeight, window.innerHeight);
  }

  /** 按当前视口计算整屏落点，窗口缩放后也能准确对齐。 */
  function sectionTops(): Record<Section, number> {
    const y = window.scrollY;
    const memoriesTop = memories!.getBoundingClientRect().top + y;
    return {
      hero: 0,
      collection: collection!.getBoundingClientRect().top + y,
      journal: journal!.getBoundingClientRect().top + y,
      reviews: reviewExitOffset() + y,
      memories: memoriesTop,
    };
  }

  /** 短评读完后进入时间轴；从时间轴顶部反向滚动可回到短评。 */
  function route(direction: Direction, delta = 0): SnapRoute | undefined {
    const y = window.scrollY;
    const tops = sectionTops();
    const tolerance = Math.min(62, window.innerHeight * .065);
    if (direction === 1 && y >= tops.reviews - 1 && y < tops.memories - tolerance) {
      return { from: "reviews", to: "memories", direction, target: tops.memories };
    }
    if (direction === -1 && y >= tops.memories - tolerance && y + delta <= tops.memories + tolerance) {
      return { from: "memories", to: "reviews", direction, target: tops.reviews };
    }

    // 一次上滑可能从海报区深处跨回入口，按这一段滚动的终点判断。
    const atJournalEntrance = direction === -1 && y > tops.journal
      && y + delta <= tops.journal + tolerance;
    const index = atJournalEntrance ? 2 : OPENING_SECTIONS.findIndex((section) => Math.abs(tops[section] - y) <= tolerance);
    const from = OPENING_SECTIONS[index];
    const to = OPENING_SECTIONS[index + direction];
    if (!from || !to || Math.abs(tops[to] - tops[from]) > window.innerHeight * 1.14) return;
    return { from, to, direction, target: tops[to] };
  }

  /** 本月记录有独立的滚动区域，列表中的手势仍留给列表。 */
  function inScrollableRecords(target: EventTarget | null) {
    const list = target instanceof Element ? target.closest(".pv-memories .memory-record-list") : null;
    return list && list.scrollHeight > list.clientHeight;
  }

  /** 发布与实际滚动一致的进度，供光碟等章节动画接续。 */
  function announce(phase: PreviewSnapDetail["phase"]) {
    if (!active) return;
    const { from, to, direction, progress, reversing } = active;
    document.dispatchEvent(new CustomEvent<PreviewSnapDetail>("pv:snap", {
      detail: { phase, from, to, direction, progress, reversing },
    }));
  }

  /** 把当前帧的滚动位置交还给拖动滚动条、锚点跳转等原生操作。 */
  function cancel() {
    if (!active) return;
    cancelAnimationFrame(frame);
    announce("cancel");
    active = null;
  }

  /** 每帧直接写入曲线上的位置，避免原生平滑滚动再次插值。 */
  function animateTo(next: SnapRoute, reversing = false) {
    cancelAnimationFrame(frame);
    const start = window.scrollY;
    const distance = next.target - start;
    const duration = reversing ? Math.max(360, Math.min(1000, 1000 * Math.sqrt(Math.abs(distance) / window.innerHeight))) : 1000;
    const startedAt = performance.now();
    active = { ...next, progress: 0, writtenY: start, reversing };
    oppositeDelta = 0;
    announce("start");

    function tick(now: number) {
      if (!active) return;
      const time = Math.min(1, Math.max(0, (now - startedAt) / duration));
      active.progress = time === 1 ? 1 : pageEase(time);
      window.scrollTo({ top: start + distance * active.progress, behavior: "instant" });
      active.writtenY = window.scrollY;
      announce(time === 1 ? "end" : "progress");
      if (time < 1) frame = requestAnimationFrame(tick);
      else active = null;
    }
    frame = requestAnimationFrame(tick);
  }

  /** 明确的反向手势从当前画面退回上一章节，触控板的小幅抖动不会触发反向。 */
  function reverse() {
    if (!active) return;
    const { from, to, direction } = active;
    animateTo({ from: to, to: from, direction: direction === 1 ? -1 : 1, target: sectionTops()[from] }, true);
  }

  /** 跨过短评入口或末尾时先对齐，保留停留时间和窄屏下半部分的阅读机会。 */
  function alignReviews(delta: number) {
    if (!journal!.classList.contains("is-animated")) return false;
    const entrance = reviewAnchor!.getBoundingClientRect().top;
    const remaining = entrance > 1 ? entrance : reviewExitOffset();
    if (remaining <= 1 || remaining > delta) return false;
    window.scrollTo({ top: window.scrollY + remaining, behavior: "instant" });
    return true;
  }

  window.addEventListener("wheel", (event) => {
    // 横向光碟手势、浏览器缩放与模态窗口中的滚动有各自的处理逻辑。
    if (reducedMotion.matches || event.defaultPrevented || !event.cancelable || event.ctrlKey || event.shiftKey
      || !event.deltaY || Math.abs(event.deltaX) > Math.abs(event.deltaY)
      || inScrollableRecords(event.target) || document.querySelector("dialog:modal")) return;
    const now = performance.now();
    if (now - wheelAt > GESTURE_GAP) { usedWheelDirection = null; wheelDelta = 0; reviewWheelPausedUntil = 0; }
    wheelAt = now;
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1);
    const direction: Direction = delta > 0 ? 1 : -1;

    if (active) {
      event.preventDefault();
      oppositeDelta = direction === active.direction ? 0 : oppositeDelta + Math.abs(delta);
      if (oppositeDelta >= WHEEL_THRESHOLD) reverse();
      usedWheelDirection = active.direction;
      return;
    }
    // 消耗同方向惯性，换页结束后的反向手势仍能立即回滑。
    if (usedWheelDirection === direction) { event.preventDefault(); return; }
    if (direction === -1) reviewWheelPausedUntil = 0;
    if (now < reviewWheelPausedUntil) { event.preventDefault(); return; }
    if (direction === 1 && alignReviews(delta)) {
      event.preventDefault();
      reviewWheelPausedUntil = now + REVIEW_WHEEL_PAUSE;
      wheelDelta = 0;
      return;
    }
    const next = route(direction, delta);
    if (!next) { wheelDelta = 0; return; }
    event.preventDefault();
    if (Math.sign(wheelDelta) !== direction) wheelDelta = 0;
    wheelDelta += delta;
    if (Math.abs(wheelDelta) >= WHEEL_THRESHOLD) {
      usedWheelDirection = direction;
      wheelDelta = 0;
      animateTo(next);
    }
  }, { passive: false });

  window.addEventListener("touchstart", (event) => {
    const finger = event.touches[0];
    touch = event.touches.length === 1 ? { x: finger.clientX, y: finger.clientY, used: false } : null;
  }, { passive: true });
  window.addEventListener("touchmove", (event) => {
    if (!touch || !event.cancelable || reducedMotion.matches || event.defaultPrevented
      || event.touches.length !== 1 || inScrollableRecords(event.target) || document.querySelector("dialog:modal")) return;
    const finger = event.touches[0];
    const delta = touch.y - finger.clientY;
    if (Math.abs(finger.clientX - touch.x) > Math.abs(delta) * 1.15 || !delta) return;
    const direction: Direction = delta > 0 ? 1 : -1;
    const next = route(direction, delta);
    if (!next && !active && !touch.used) return;
    event.preventDefault();
    if (!touch.used && Math.abs(delta) >= 42) {
      touch.used = true;
      if (active && direction !== active.direction) reverse();
      else if (!active && next) animateTo(next);
    }
  }, { passive: false });
  window.addEventListener("touchend", () => { touch = null; }, { passive: true });
  window.addEventListener("touchcancel", () => { touch = null; }, { passive: true });

  window.addEventListener("keydown", (event) => {
    if (reducedMotion.matches || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey
      || document.querySelector("dialog:modal")) return;
    const target = event.target;
    if (inScrollableRecords(target)
      || (target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select")))) return;
    let direction: Direction;
    if (event.key === "PageDown" || event.key === "ArrowDown") direction = 1;
    else if (event.key === "PageUp" || event.key === "ArrowUp") direction = -1;
    else if (event.key === " " && !(target instanceof Element && target.closest("a, button, summary, [data-album-stage]"))) direction = event.shiftKey ? -1 : 1;
    else return;

    if (active) {
      event.preventDefault();
      if (!event.repeat && direction !== active.direction) reverse();
      return;
    }
    const step = event.key.startsWith("Arrow") ? 40 : window.innerHeight * .875;
    if (direction === 1 && alignReviews(step)) { event.preventDefault(); return; }
    const next = route(direction, direction * step);
    if (!next) return;
    event.preventDefault();
    if (!event.repeat) animateTo(next);
  });

  window.addEventListener("scroll", () => {
    if (active && Math.abs(window.scrollY - active.writtenY) > 4) cancel();
  }, { passive: true });
  window.addEventListener("resize", cancel, { passive: true });
  window.addEventListener("hashchange", cancel);
  reducedMotion.addEventListener("change", cancel);
}
