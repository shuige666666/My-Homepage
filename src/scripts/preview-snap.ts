import { FAN_END } from "./preview-watched";

type Section = "hero" | "collection" | "journal" | "reviews" | "memories";
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
const ALIGN_TOLERANCE = 1.5;

type Boundary = { at: number; snap?: SnapRoute };
type ScrollAction = { target: number } | SnapRoute;
type ActiveSnap = SnapRoute & { origin: number; progress: number; writtenY: number; reversing: boolean };

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
  const page = document.querySelector<HTMLElement>(".pv-page");
  const heroAnchor = page?.querySelector<HTMLElement>("[data-depth-home-top]");
  const heroStage = page?.querySelector<HTMLElement>(".pv-hero-stage");
  const collection = document.querySelector<HTMLElement>("#preview-collection");
  const journal = document.querySelector<HTMLElement>("#preview-journal");
  const journalStage = journal?.querySelector<HTMLElement>("[data-pv-journal-pin]");
  const reviewAnchor = document.querySelector<HTMLElement>("#preview-reviews");
  const reviews = document.querySelector<HTMLElement>("[data-pv-reviews]");
  const memories = document.querySelector<HTMLElement>("#preview-memories");
  if (!page || !heroStage || !collection || !journal || !journalStage || !reviewAnchor || !reviews || !memories) return;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let frame = 0;
  let wheelAt = -Infinity;
  let previousWheelDelta = 0;
  let consumedWheel: { direction: Direction; until: number } | null = null;
  let wheelDelta = 0;
  let oppositeDelta = 0;
  let touch: { x: number; y: number; lastY: number; used: boolean } | null = null;
  let active: ActiveSnap | null = null;

  /** 用稳定舞台的位置计算各章节入口和可读区域的末端。 */
  function scrollLayout(y: number) {
    const { clientHeight: height, scrollHeight } = document.documentElement;
    const hero = (heroAnchor ?? page!).getBoundingClientRect().top + y;
    const collectionTop = collection!.getBoundingClientRect().top + y;
    const journalTop = journal!.getBoundingClientRect().top + y;
    const reviewsTop = reviewAnchor!.getBoundingClientRect().top + y;
    const memoriesTop = memories!.getBoundingClientRect().top + y;
    const hasJournalAnimation = journal!.classList.contains("is-animated");
    const heroRestEnd = Math.max(hero, collectionTop - heroStage!.getBoundingClientRect().height);
    const reviewsRestEnd = hasJournalAnimation
      ? Math.max(reviewsTop, memoriesTop - reviews!.getBoundingClientRect().height)
      : reviewsTop;
    return {
      hero,
      heroEnd: Math.max(heroRestEnd, collectionTop - height),
      heroRestEnd,
      collection: collectionTop,
      collectionEnd: Math.max(collectionTop, journalTop - height),
      journal: journalTop,
      journalFanEnd: journalTop + (journal!.offsetHeight - journalStage!.clientHeight) * FAN_END,
      journalEnd: hasJournalAnimation ? reviewsTop : Math.max(journalTop, reviewsTop - height),
      reviews: reviewsTop,
      reviewsRestEnd,
      reviewsEnd: Math.max(reviewsRestEnd, memoriesTop - height),
      memories: Math.min(memoriesTop, scrollHeight - height),
      hasJournalAnimation,
    };
  }

  /** 沿滚动方向处理第一个边界，长章节内的行程由其自身的动画或内容使用。 */
  function scrollAction(delta: number): ScrollAction | undefined {
    const y = window.scrollY;
    const direction: Direction = delta > 0 ? 1 : -1;
    const { hero, heroEnd, heroRestEnd, collection, collectionEnd, journal, journalEnd,
      journalFanEnd, reviews: reviewsTop, reviewsRestEnd, reviewsEnd, memories: memoriesTop, hasJournalAnimation } = scrollLayout(y);

    // 画廊和海报动画可能还在追赶滚动位置，完全显现后才能消耗阅读行程。
    if (direction === 1) {
      if (heroAnchor && y >= hero - ALIGN_TOLERANCE && y < collection - ALIGN_TOLERANCE
        && !document.body.classList.contains("depth-gallery-home")) return { target: Math.max(y, hero) };
      if (hasJournalAnimation && y >= reviewsTop - ALIGN_TOLERANCE && y < memoriesTop - ALIGN_TOLERANCE
        && reviews!.inert) return { target: Math.max(y, reviewsTop) };
    }

    // 起点负责保留可读行程，终点负责吸附；跨过多个章节时只处理遇到的第一个。
    const boundaries: Boundary[] = direction === 1 ? [
      { at: hero },
      { at: heroRestEnd },
      { at: heroEnd, snap: { from: "hero", to: "collection", direction, target: collection } },
      { at: collectionEnd, snap: { from: "collection", to: "journal", direction, target: journal } },
      hasJournalAnimation ? { at: reviewsTop }
        : { at: journalEnd, snap: { from: "journal", to: "reviews", direction, target: reviewsTop } },
      { at: reviewsRestEnd },
      { at: reviewsEnd, snap: { from: "reviews", to: "memories", direction, target: memoriesTop } },
    ] : [
      { at: memoriesTop, snap: { from: "memories", to: "reviews", direction, target: reviewsEnd } },
      // 回到最近看过时让液面退回已打开的海报，避免一帧越过所有卡片。
      { at: reviewsTop, snap: { from: "reviews", to: "journal", direction, target: hasJournalAnimation ? journalFanEnd : journalEnd } },
      { at: journal, snap: { from: "journal", to: "collection", direction, target: collectionEnd } },
      { at: collection, snap: { from: "collection", to: "hero", direction, target: hero } },
    ];
    for (const { at, snap } of boundaries) {
      const distance = direction * (at - y);
      if (distance > ALIGN_TOLERANCE || (!snap && distance > 0.5)) {
        if (distance > Math.abs(delta) + ALIGN_TOLERANCE) return;
        // 上行跨到章节顶部时直接衔接上一屏。下行进入停留段时先对齐。
        return direction === -1 && snap ? snap : { target: at };
      }
      // 已在过渡区中的位置也能继续吸附，例如从窄屏地址栏变化后接着滚动。
      if (snap && direction * (snap.target - y) > ALIGN_TOLERANCE
        && (direction === 1 || distance >= -ALIGN_TOLERANCE)) return snap;
    }
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
  function animateTo(next: SnapRoute, returnTo?: number) {
    cancelAnimationFrame(frame);
    const start = window.scrollY;
    const distance = next.target - start;
    const reversing = returnTo !== undefined;
    const duration = reversing ? Math.max(360, Math.min(1000, 1000 * Math.sqrt(Math.abs(distance) / window.innerHeight))) : 1000;
    const startedAt = performance.now();
    active = { ...next, origin: returnTo ?? start, progress: 0, writtenY: start, reversing };
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
      else {
        active = null;
        if (consumedWheel) consumedWheel.until = now + GESTURE_GAP;
      }
    }
    frame = requestAnimationFrame(tick);
  }

  /** 明确的反向手势回到本次换页的起点，触控板的小幅抖动不会触发反向。 */
  function reverse() {
    if (!active) return;
    const { from, to, direction, origin, target } = active;
    animateTo({ from: to, to: from, direction: direction === 1 ? -1 : 1, target: origin }, target);
  }

  /** 对齐阅读段边界，或触发整屏缓动。 */
  function applyScroll(action: ScrollAction) {
    if ("from" in action) animateTo(action);
    else if (action.target !== window.scrollY) {
      window.scrollTo({ top: action.target, behavior: "instant" });
    }
  }

  window.addEventListener("wheel", (event) => {
    // 横向光碟手势、浏览器缩放与模态窗口中的滚动有各自的处理逻辑。
    const mode = event.deltaMode;
    if (reducedMotion.matches || event.defaultPrevented || !event.cancelable || event.ctrlKey || event.shiftKey
      || !event.deltaY || Math.abs(event.deltaX) > Math.abs(event.deltaY)
      || inScrollableRecords(event.target) || document.querySelector("dialog:modal")) return;
    const now = performance.now();
    const delta = event.deltaY * (mode === 1 ? 16 : mode === 2 ? window.innerHeight : 1);
    // 同一手势从第一笔就统一处理，后续滚轮的原生惯性才不会直接越过边界。
    event.preventDefault();
    const direction: Direction = delta > 0 ? 1 : -1;
    // 同向滚轮的尾段通常逐步变小，新的发力或持续滚轮都能继续前进。
    if (now - wheelAt > GESTURE_GAP || (consumedWheel
      && (direction !== consumedWheel.direction || now >= consumedWheel.until
        || Math.abs(delta) >= Math.max(WHEEL_THRESHOLD, previousWheelDelta * 1.75)))) {
      consumedWheel = null;
      wheelDelta = 0;
    }
    wheelAt = now;
    previousWheelDelta = Math.abs(delta);

    if (active) {
      oppositeDelta = direction === active.direction ? 0 : oppositeDelta + Math.abs(delta);
      if (oppositeDelta >= WHEEL_THRESHOLD) reverse();
      consumedWheel = { direction: active.direction, until: now + GESTURE_GAP };
      return;
    }
    // 消耗同方向惯性，换页结束后的反向手势仍能立即回滑。
    if (consumedWheel) return;
    const next = scrollAction(delta);
    if (!next) {
      wheelDelta = 0;
      window.scrollBy({ top: delta, behavior: "instant" });
      return;
    }
    if (Math.sign(wheelDelta) !== direction) wheelDelta = 0;
    wheelDelta += delta;
    if (!("from" in next) || Math.abs(wheelDelta) >= WHEEL_THRESHOLD) {
      consumedWheel = { direction, until: now + GESTURE_GAP };
      wheelDelta = 0;
      applyScroll(next);
    }
  }, { passive: false });

  window.addEventListener("touchstart", (event) => {
    const finger = event.touches[0];
    touch = event.touches.length === 1 && !inScrollableRecords(event.target) && !document.querySelector("dialog:modal")
      ? { x: finger.clientX, y: finger.clientY, lastY: finger.clientY, used: false } : null;
  }, { passive: true });
  window.addEventListener("touchmove", (event) => {
    if (!touch || !event.cancelable || reducedMotion.matches || event.defaultPrevented
      || event.touches.length !== 1) return;
    const finger = event.touches[0];
    const distance = touch.y - finger.clientY;
    const delta = touch.lastY - finger.clientY;
    touch.lastY = finger.clientY;
    if (touch.used) { event.preventDefault(); return; }
    if (Math.abs(finger.clientX - touch.x) > Math.abs(distance) * 1.15 || !delta) return;
    const direction: Direction = delta > 0 ? 1 : -1;
    event.preventDefault();
    if (active) {
      if (Math.abs(distance) >= 42 && direction !== active.direction) {
        touch.used = true;
        reverse();
      }
      return;
    }
    const next = scrollAction(delta);
    if (next && !("from" in next)) {
      touch.used = true;
      applyScroll(next);
    } else if (next) {
      if (Math.abs(distance) >= 42) {
        touch.used = true;
        applyScroll(next);
      }
    } else {
      // 手指逐段推进长章节，避免松手后的惯性跨过下一章节的吸附边界。
      window.scrollBy({ top: delta, behavior: "instant" });
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
    const next = scrollAction(direction * step);
    if (!next) return;
    event.preventDefault();
    if (!event.repeat) applyScroll(next);
  });

  window.addEventListener("scroll", () => {
    if (active && Math.abs(window.scrollY - active.writtenY) > 4) cancel();
  }, { passive: true });
  window.addEventListener("resize", cancel, { passive: true });
  window.addEventListener("hashchange", cancel);
  reducedMotion.addEventListener("change", cancel);
}
