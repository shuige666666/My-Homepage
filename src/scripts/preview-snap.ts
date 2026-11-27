import { HANDOFF_DOCK } from "./preview-showcase";
import { FAN_END } from "./preview-watched";
import { getLongReviewStops } from "./preview-long-reviews";

type Section = "hero" | "collection" | "journal" | "reviews" | "memories" | "long-reviews";
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
  fromBoundary?: number;
  finale?: boolean;
}

const WHEEL_THRESHOLD = 36;
const HERO_EXIT_WHEEL_THRESHOLD = 6;
const HERO_EXIT_DURATION = 760;
const SHOWCASE_FINALE_FORWARD_DURATION = 760;
const SHOWCASE_FINALE_REVERSE_DURATION = 680;
const SHOWCASE_MORPH_REVERSE_DURATION = 1650;
const GESTURE_GAP = 135;
const ALIGN_TOLERANCE = 1.5;
// 触摸位移放大 15%，余滑按松手速度衰减，最多滑过视口的 28%。
const TOUCH_SCROLL_SCALE = 1.15;
const TOUCH_SNAP_DISTANCE = 42;
const TOUCH_FLING_MIN_SPEED = .12;
const TOUCH_FLING_DAMPING = 8;
const TOUCH_FLING_LIMIT = .28;
const TOUCH_FLING_MAX_DURATION = 440;

type Boundary = { at: number; snap?: SnapRoute; smoothDirection?: Direction };
type ScrollAction = { target: number; smoothDirection?: Direction } | SnapRoute;
type ActiveSnap = SnapRoute & { origin: number; progress: number; writtenY: number; reversing: boolean };
type TouchDrag = { x: number; y: number; lastY: number; lastAt: number; speed: number; used: boolean };

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

/** 短评与时间轴之间的空间接力使用对称正弦缓入缓出，让三段形变有足够呼吸感。 */
function morphEase(time: number) {
  return 0.5 - 0.5 * Math.cos(Math.PI * time);
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
  let touch: TouchDrag | null = null;
  let touchFrame = 0;
  let active: ActiveSnap | null = null;
  let lrSettleFrame = 0;
  let lrSettleWrittenY = 0;
  let lrCatchGate: { direction: Direction; until: number; hardCap: number } | null = null;
  let lrLastWheelAt = -Infinity;
  let lrLastWheelDir: Direction | 0 = 0;
  let lrProjectedY: number | null = null;
  let lrLastProjectedDir: Direction | 0 = 0;

  function cancelLrSettle() {
    if (!lrSettleFrame) return;
    cancelAnimationFrame(lrSettleFrame);
    lrSettleFrame = 0;
  }

  /** 长评各篇左图定住位的柔滑收停（与 demo2 一致的立方缓出 + 同手势余波抑制）。 */
  function smoothSettleLongReview(targetY: number, direction: Direction) {
    cancelLrSettle();
    // 先即时打断浏览器仍在进行的原生平滑滚轮惯性，再同步基准位，防止 scroll 监听误取消首帧。
    const startY = window.scrollY;
    window.scrollTo({ top: startY, behavior: "instant" });
    lrSettleWrittenY = window.scrollY;
    const dist = targetY - lrSettleWrittenY;
    const startAt = performance.now();
    if (Math.abs(dist) < 1.5) {
      window.scrollTo({ top: targetY, behavior: "instant" });
      lrSettleWrittenY = window.scrollY;
      lrCatchGate = { direction, until: startAt + 180, hardCap: startAt + 380 };
      return;
    }
    const originY = lrSettleWrittenY;
    const duration = Math.min(340, Math.max(180, Math.round(Math.abs(dist) * 1.15)));
    lrCatchGate = { direction, until: startAt + duration + 160, hardCap: startAt + duration + 380 };

    function step(now: number) {
      const t = Math.min(1, Math.max(0, (now - startAt) / duration));
      const eased = 1 - (1 - t) ** 3;
      window.scrollTo({ top: originY + dist * eased, behavior: "instant" });
      lrSettleWrittenY = window.scrollY;
      if (t < 1) {
        lrSettleFrame = requestAnimationFrame(step);
      } else {
        lrSettleFrame = 0;
      }
    }
    lrSettleFrame = requestAnimationFrame(step);
  }

  /** 用稳定舞台的位置计算各章节入口和可读区域的末端。 */
  function scrollLayout(y: number) {
    const { clientHeight: height, scrollHeight } = document.documentElement;
    const hero = (heroAnchor ?? page!).getBoundingClientRect().top + y;
    const collectionTop = collection!.getBoundingClientRect().top + y;
    const journalTop = journal!.getBoundingClientRect().top + y;
    const reviewsTop = reviewAnchor!.getBoundingClientRect().top + y;
    const memoriesTop = memories!.getBoundingClientRect().top + y;
    const hasJournalAnimation = journal!.classList.contains("is-animated");
    const showcaseSticky = reviews!.dataset.scHandoff === "sticky";
    const heroRestEnd = Math.max(hero, collectionTop - heroStage!.getBoundingClientRect().height);
    const reviewsEnd = showcaseSticky
      ? reviewsTop
      : Math.max(reviewsTop, memoriesTop - height);
    const reviewsDock = showcaseSticky
      ? Math.round(reviewsTop + (memoriesTop - reviewsTop) * HANDOFF_DOCK)
      : reviewsEnd;
    const longReviewStops = getLongReviewStops(y);
    const hasLongReviews = longReviewStops.length > 0;
    const longReviewsFirst = hasLongReviews ? longReviewStops[0].lockY : Math.min(memoriesTop, scrollHeight - height);
    return {
      hero,
      heroEnd: Math.max(heroRestEnd, collectionTop - height),
      collection: collectionTop,
      collectionEnd: Math.max(collectionTop, journalTop - height),
      journal: journalTop,
      journalFanEnd: journalTop + (journal!.offsetHeight - journalStage!.clientHeight) * FAN_END,
      journalEnd: hasJournalAnimation ? reviewsTop : Math.max(journalTop, reviewsTop - height),
      reviews: reviewsTop,
      reviewsDock,
      reviewsEnd,
      memories: hasLongReviews ? memoriesTop : Math.min(memoriesTop, scrollHeight - height),
      hasLongReviews,
      longReviewsFirst,
      longReviewStops,
      hasJournalAnimation,
      showcaseSticky,
    };
  }

  /** 沿滚动方向处理第一个边界，长章节内的行程由其自身的动画或内容使用。 */
  function scrollAction(delta: number, coasting = false): ScrollAction | undefined {
    const y = window.scrollY;
    const direction: Direction = delta > 0 ? 1 : -1;
    const { hero, heroEnd, collection, collectionEnd, journal, journalEnd,
      journalFanEnd, reviews: reviewsTop, reviewsDock, reviewsEnd, memories: memoriesTop,
      hasLongReviews, longReviewsFirst, longReviewStops, hasJournalAnimation, showcaseSticky } = scrollLayout(y);

    // 画廊和海报动画可能还在追赶滚动位置，完全显现后才能消耗阅读行程。
    if (direction === 1) {
      if (heroAnchor && y >= hero - ALIGN_TOLERANCE && y < collection - ALIGN_TOLERANCE
        && !document.body.classList.contains("depth-gallery-home")) return { target: Math.max(y, hero) };
      if (hasJournalAnimation && y >= reviewsTop - ALIGN_TOLERANCE && y < memoriesTop - ALIGN_TOLERANCE
        && reviews!.dataset.journalReady === "false") return { target: Math.max(y, reviewsTop) };
    }

    // 长评区域内各篇“左图正好定住”的边界：向下跨过时先定住左图，下一次滑动再让右侧内容向下滚动。
    const longReviewDownBoundaries: Boundary[] = hasLongReviews
      ? [
          { at: memoriesTop, snap: { from: "memories", to: "long-reviews", direction: 1, target: longReviewsFirst } },
          ...longReviewStops.slice(1).map((stop) => ({ at: stop.lockY, smoothDirection: 1 as Direction })),
        ]
      : [];

    // 在某篇长评右侧阅读区向上滚回本篇顶起点时轻柔停住；在首篇顶部或暗场过渡幕内往上滑则平滑退回「观看时间轴」。
    const inCurtainZone = hasLongReviews && y > memoriesTop + ALIGN_TOLERANCE && y < longReviewsFirst - ALIGN_TOLERANCE;
    const longReviewUpBoundaries: Boundary[] = hasLongReviews
      ? [
          ...[...longReviewStops]
            .reverse()
            .filter((stop, idxFromEnd) => idxFromEnd < longReviewStops.length - 1 && y > stop.lockY + ALIGN_TOLERANCE && y <= stop.releaseY + 60)
            .map((stop) => ({ at: stop.lockY, smoothDirection: -1 as Direction })),
          ...(y > longReviewsFirst + ALIGN_TOLERANCE && y <= longReviewStops[0].releaseY + 60
            ? [{ at: longReviewsFirst, smoothDirection: -1 as Direction }]
            : []),
          {
            at: inCurtainZone ? y : longReviewsFirst,
            snap: { from: "long-reviews", to: "memories", direction: -1, target: memoriesTop },
          },
        ]
      : [];

    // 起点负责保留可读行程，终点负责吸附；跨过多个章节时只处理遇到的第一个。
    const boundaries: Boundary[] = direction === 1 ? [
      { at: hero },
      { at: heroEnd, snap: { from: "hero", to: "collection", direction, target: collection, fromBoundary: heroEnd } },
      { at: collectionEnd, snap: { from: "collection", to: "journal", direction, target: journal } },
      hasJournalAnimation ? { at: reviewsTop }
        : { at: journalEnd, snap: { from: "journal", to: "reviews", direction, target: reviewsTop } },
      // 滚轮拖到卡片接力停靠点后，连续自动完成最后换图与拍立得扇开段。
      showcaseSticky
        ? { at: reviewsDock, snap: { from: "reviews", to: "memories", direction, target: memoriesTop, fromBoundary: reviewsDock, finale: true } }
        : { at: reviewsEnd, snap: { from: "reviews", to: "memories", direction, target: memoriesTop } },
      ...longReviewDownBoundaries,
    ] : [
      ...longReviewUpBoundaries,
      { at: memoriesTop },
      showcaseSticky
        ? { at: memoriesTop, snap: { from: "memories", to: "reviews", direction, target: reviewsDock, finale: true } }
        : { at: memoriesTop, snap: { from: "memories", to: "reviews", direction, target: reviewsEnd } },
      { at: reviewsTop },
      // 回到最近看过时让液面退回已打开的海报，避免一帧越过所有卡片。
      { at: reviewsTop, snap: { from: "reviews", to: "journal", direction, target: hasJournalAnimation ? journalFanEnd : journalEnd } },
      { at: journal, snap: { from: "journal", to: "collection", direction, target: collectionEnd } },
      { at: collection, snap: { from: "collection", to: "hero", direction, target: hero } },
    ];
    for (const { at, snap, smoothDirection } of boundaries) {
      const distance = direction * (at - y);
      if (distance > ALIGN_TOLERANCE || (!snap && distance > 0.5)) {
        if (coasting) return distance <= Math.abs(delta) ? { target: at } : undefined;
        // 首屏停留的最后一段也由同一笔输入推进，跨过后才启动换页。
        if (snap?.fromBoundary !== undefined) return distance <= delta ? snap : undefined;
        if (distance > Math.abs(delta) + ALIGN_TOLERANCE) return;
        return direction === -1 && snap ? snap : { target: at, smoothDirection };
      }
      // 已在过渡区中的位置也能继续吸附，例如从窄屏地址栏变化后接着滚动。
      if (snap && direction * (snap.target - y) > ALIGN_TOLERANCE
        && (direction === 1 || distance >= -ALIGN_TOLERANCE)) return coasting ? { target: y } : snap;
    }
  }

  /** 本月记录与长短评区有独立的滚动区域，列表中的手势仍留给列表。 */
  function inScrollableRecords(target: EventTarget | null) {
    if (!(target instanceof Element)) return false;
    const list = target.closest(".pv-memories .memory-record-list, [data-sc-contact-list], .pv-sc-prose-scroll");
    return Boolean(list && list.scrollHeight > list.clientHeight);
  }

  function isModalActive() {
    return Boolean(document.querySelector("dialog:modal, [data-sc-archive-drawer]:not([hidden]), .pv-lr-shelf.is-open"));
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
    cancelLrSettle();
    lrCatchGate = null;
    lrProjectedY = null;
    // 滚轮跨过首屏停留末尾时，先用这笔输入走完剩余行程，再从首屏边缘起步；同时中止浏览器尚未结束的锚点平滑滚动。
    const boundary = next.fromBoundary;
    const initY = boundary !== undefined && window.scrollY < boundary ? boundary : window.scrollY;
    window.scrollTo({ top: initY, behavior: "instant" });
    const start = window.scrollY;
    const distance = next.target - start;
    const reversing = returnTo !== undefined;
    const heroExit = next.from === "hero" && next.to === "collection";
    const showcaseMorph =
      (next.from === "reviews" && next.to === "memories") ||
      (next.from === "memories" && next.to === "reviews");
    const finaleForward = showcaseMorph && Boolean(next.finale) && next.to === "memories";
    const morphBaseDuration = finaleForward
      ? SHOWCASE_FINALE_FORWARD_DURATION
      : next.finale
        ? SHOWCASE_FINALE_REVERSE_DURATION
        : SHOWCASE_MORPH_REVERSE_DURATION;
    const minReverse = next.finale ? 320 : 480;
    const longReviewCurtain =
      (next.from === "memories" && next.to === "long-reviews") ||
      (next.from === "long-reviews" && next.to === "memories");
    const duration = heroExit ? HERO_EXIT_DURATION
      : longReviewCurtain
        ? (next.to === "long-reviews" ? 1160 : 980)
        : showcaseMorph
          ? reversing
            ? Math.max(minReverse, Math.min(morphBaseDuration, Math.round(morphBaseDuration * Math.abs(distance) / Math.max(1, Math.abs(returnTo - next.target)))))
            : morphBaseDuration
          : reversing ? Math.max(360, Math.min(1000, 1000 * Math.sqrt(Math.abs(distance) / window.innerHeight))) : 1000;
    const startedAt = performance.now();
    active = { ...next, origin: returnTo ?? start, progress: 0, writtenY: start, reversing };
    oppositeDelta = 0;
    announce("start");

    function tick(now: number) {
      if (!active) return;
      const time = Math.min(1, Math.max(0, (now - startedAt) / duration));
      // 末段交接正向承接滚轮速度直接流出，反向、长评暗场沉降与整段回跳采用对称正弦缓入缓出。
      active.progress = heroExit
        ? 1 - (1 - time) ** 2.4
        : finaleForward
          ? 1 - (1 - time) ** 2.6
          : (showcaseMorph || longReviewCurtain)
            ? (time === 1 ? 1 : morphEase(time))
            : time === 1 ? 1 : pageEase(time);
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
    const { from, to, direction, origin, target, finale } = active;
    animateTo({ from: to, to: from, direction: direction === 1 ? -1 : 1, target: origin, finale }, target);
  }

  /** 对齐阅读段边界，或触发整屏缓动。 */
  function applyScroll(action: ScrollAction) {
    if ("from" in action) animateTo(action);
    else if (action.smoothDirection) smoothSettleLongReview(action.target, action.smoothDirection);
    else if (action.target !== window.scrollY) {
      window.scrollTo({ top: action.target, behavior: "instant" });
    }
  }

  /** 新的手势或导航接管时立即中止上一段余滑。 */
  function stopTouchMomentum() {
    if (!touchFrame) return;
    cancelAnimationFrame(touchFrame);
    touchFrame = 0;
  }

  /** 短评与时间轴使用松手速度续滑，行程在当前阅读段的边界内收住。 */
  function startTouchMomentum(speed: number) {
    const start = window.scrollY;
    const speedMagnitude = Math.abs(speed);
    if (speedMagnitude < TOUCH_FLING_MIN_SPEED || reviewAnchor!.getBoundingClientRect().top > ALIGN_TOLERANCE || reviews!.dataset.journalReady === "false") return;

    const scrollRoot = document.documentElement;
    const direction = Math.sign(speed);
    const duration = Math.min(TOUCH_FLING_MAX_DURATION, 1000 * Math.log(speedMagnitude / .035) / TOUCH_FLING_DAMPING);
    const damping = (ms: number) => 1 - Math.exp(-TOUCH_FLING_DAMPING * ms / 1000);
    const travelFraction = damping(duration);
    const naturalDistance = speedMagnitude * 1000 / TOUCH_FLING_DAMPING * travelFraction;
    const delta = direction * Math.min(scrollRoot.clientHeight * TOUCH_FLING_LIMIT, naturalDistance);
    // 复用主动滚动的边界，余滑到达边界就停，下一次手势再触发换页。
    const target = scrollAction(delta, true)?.target ?? start + delta;
    const distance = Math.min(scrollRoot.scrollHeight - scrollRoot.clientHeight, Math.max(0, target)) - start;
    if (distance * direction < 2) return;

    // 从松手速度向零速衰减，距离不足时提前收住，避免在吸附边界突然刹停。
    const startedAt = performance.now();
    function tick(now: number) {
      const elapsed = Math.min(duration, Math.max(0, now - startedAt));
      const position = start + distance * damping(elapsed) / travelFraction;
      window.scrollTo({ top: position, behavior: "instant" });
      touchFrame = elapsed < duration ? requestAnimationFrame(tick) : 0;
    }
    touchFrame = requestAnimationFrame(tick);
  }

  window.addEventListener("wheel", (event) => {
    stopTouchMomentum();
    // 横向光碟手势、浏览器缩放与模态窗口中的滚动有各自的处理逻辑。
    const mode = event.deltaMode;
    if (reducedMotion.matches || event.defaultPrevented || !event.cancelable || event.ctrlKey || event.shiftKey
      || !event.deltaY || Math.abs(event.deltaX) > Math.abs(event.deltaY)
      || inScrollableRecords(event.target) || isModalActive()) return;
    const now = performance.now();
    const delta = event.deltaY * (mode === 1 ? 16 : mode === 2 ? window.innerHeight : 1);
    const direction: Direction = delta > 0 ? 1 : -1;

    // 长评连续阅读区：保留浏览器原生平滑滚动（避免 behavior:"instant" 按格生硬闪跳），
    // 仅在跨过某篇左图定住位 lockY 或从首篇顶部向上返回时间轴时介入平滑收停。
    if (!active) {
      const y = window.scrollY;
      const layout = scrollLayout(y);
      if (layout.hasLongReviews && y >= layout.longReviewsFirst - ALIGN_TOLERANCE) {
        const gap = now - lrLastWheelAt;
        const isFreshGesture = gap > 165 || direction !== lrLastWheelDir;
        lrLastWheelAt = now;
        lrLastWheelDir = direction;

        if (consumedWheel) {
          if (direction !== consumedWheel.direction || now >= consumedWheel.until
            || Math.abs(delta) >= Math.max(WHEEL_THRESHOLD, previousWheelDelta * 1.75)) {
            consumedWheel = null;
            wheelDelta = 0;
          } else {
            event.preventDefault();
            consumedWheel.until = now + GESTURE_GAP;
            wheelAt = now;
            previousWheelDelta = Math.abs(delta);
            return;
          }
        }

        if (lrSettleFrame) {
          if (direction !== lrCatchGate?.direction) {
            cancelLrSettle();
            lrCatchGate = null;
            lrProjectedY = null;
          } else {
            event.preventDefault();
            return;
          }
        }

        if (lrCatchGate) {
          if (isFreshGesture || now >= lrCatchGate.until || now >= lrCatchGate.hardCap) {
            lrCatchGate = null;
          } else {
            event.preventDefault();
            lrCatchGate.until = Math.min(lrCatchGate.hardCap, now + 150);
            return;
          }
        }

        const atFirstTopGoingUp = direction === -1 && y <= layout.longReviewsFirst + ALIGN_TOLERANCE;
        if (!atFirstTopGoingUp) {
          if (window.innerWidth > 1024) {
            const baseY =
              gap > 240 || lrProjectedY === null || direction !== lrLastProjectedDir
                ? y
                : direction === 1
                  ? Math.max(lrProjectedY, y)
                  : Math.min(lrProjectedY, y);
            const projectedNext = baseY + delta;

            if (direction === 1) {
              for (const stop of layout.longReviewStops.slice(1)) {
                if (y < stop.lockY - 2 && projectedNext >= stop.lockY - 2) {
                  event.preventDefault();
                  lrProjectedY = stop.lockY;
                  lrLastProjectedDir = 1;
                  smoothSettleLongReview(stop.lockY, 1);
                  return;
                }
              }
            } else {
              for (let i = layout.longReviewStops.length - 1; i >= 0; i -= 1) {
                const stop = layout.longReviewStops[i];
                if (y > stop.lockY + 2 && y <= stop.releaseY + 60 && projectedNext <= stop.lockY + 2) {
                  event.preventDefault();
                  lrProjectedY = stop.lockY;
                  lrLastProjectedDir = -1;
                  smoothSettleLongReview(stop.lockY, -1);
                  return;
                }
              }
            }

            lrProjectedY = projectedNext;
            lrLastProjectedDir = direction;
          }

          wheelAt = now;
          previousWheelDelta = Math.abs(delta);
          wheelDelta = 0;
          return;
        }
      }
    }

    // 同一手势从第一笔就统一处理，后续滚轮的原生惯性才不会直接越过边界。
    event.preventDefault();
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
    // 消耗同方向惯性，换页结束后的反向手势仍能立即回滑；连续未停顿的余波继续刷新抑制窗，避免惯性冲破章节边界。
    if (consumedWheel) {
      consumedWheel.until = now + GESTURE_GAP;
      return;
    }
    const next = scrollAction(delta);
    if (!next) {
      wheelDelta = 0;
      window.scrollBy({ top: delta, behavior: "instant" });
      return;
    }
    if (Math.sign(wheelDelta) !== direction) wheelDelta = 0;
    wheelDelta += delta;
    if ("from" in next && next.fromBoundary !== undefined) {
      const remaining = Math.max(0, next.fromBoundary - window.scrollY);
      // 停留段内按原滚轮距离走，只有超过末尾的输入计入换页阈值；短评接力抵达停靠点即顺畅续演末段。
      wheelDelta = Math.max(0, wheelDelta - remaining);
      if (remaining > 0 && remaining <= delta) {
        window.scrollTo({ top: next.fromBoundary, behavior: "instant" });
      }
      if (next.from === "hero" && wheelDelta < HERO_EXIT_WHEEL_THRESHOLD) return;
    } else if ("from" in next && Math.abs(wheelDelta) < WHEEL_THRESHOLD) return;
    consumedWheel = { direction, until: now + GESTURE_GAP };
    wheelDelta = 0;
    applyScroll(next);
  }, { passive: false });

  window.addEventListener("touchstart", (event) => {
    stopTouchMomentum();
    cancelLrSettle();
    lrCatchGate = null;
    lrProjectedY = null;
    const finger = event.touches[0];
    touch = event.touches.length === 1 && !inScrollableRecords(event.target) && !isModalActive()
      ? { x: finger.clientX, y: finger.clientY, lastY: finger.clientY, lastAt: event.timeStamp, speed: 0, used: false } : null;
  }, { passive: true });
  window.addEventListener("touchmove", (event) => {
    if (!touch || !event.cancelable || reducedMotion.matches || event.defaultPrevented
      || event.touches.length !== 1) return;
    const finger = event.touches[0];
    const distance = touch.y - finger.clientY;
    const delta = (touch.lastY - finger.clientY) * TOUCH_SCROLL_SCALE;
    touch.lastY = finger.clientY;
    if (touch.used) { event.preventDefault(); return; }
    if (Math.abs(finger.clientX - touch.x) > Math.abs(distance) * 1.15) {
      touch.speed = 0;
      return;
    }
    if (!delta) return;
    const direction: Direction = delta > 0 ? 1 : -1;
    const movedEnough = Math.abs(distance) * TOUCH_SCROLL_SCALE >= TOUCH_SNAP_DISTANCE;
    event.preventDefault();
    if (active) {
      if (movedEnough && direction !== active.direction) {
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
      touch.speed = 0;
      if (movedEnough) {
        touch.used = true;
        applyScroll(next);
      }
    } else {
      // 用最后几帧的手速估算余滑，快速反向时以新的方向重新取样。
      const elapsed = event.timeStamp - touch.lastAt;
      const speed = delta / Math.max(8, elapsed);
      touch.speed = elapsed > 80 || Math.sign(touch.speed) !== direction ? speed : touch.speed * .35 + speed * .65;
      touch.lastAt = event.timeStamp;
      window.scrollBy({ top: delta, behavior: "instant" });
    }
  }, { passive: false });
  window.addEventListener("touchend", (event) => {
    if (touch && !touch.used && !active && !reducedMotion.matches) {
      // 手指停住再松开时，余滑随停顿衰减至零。
      const freshness = Math.max(0, 1 - (event.timeStamp - touch.lastAt) / 90);
      startTouchMomentum(touch.speed * freshness);
    }
    touch = null;
  }, { passive: true });
  window.addEventListener("touchcancel", () => { touch = null; }, { passive: true });

  window.addEventListener("keydown", (event) => {
    if (reducedMotion.matches || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey
      || isModalActive()) return;
    const target = event.target;
    if (inScrollableRecords(target)
      || (target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select")))) return;
    let direction: Direction;
    if (event.key === "PageDown" || event.key === "ArrowDown") direction = 1;
    else if (event.key === "PageUp" || event.key === "ArrowUp") direction = -1;
    else if (event.key === " " && !(target instanceof Element && target.closest("a, button, summary, [data-album-stage]"))) direction = event.shiftKey ? -1 : 1;
    else return;

    stopTouchMomentum();
    cancelLrSettle();
    lrCatchGate = null;
    lrProjectedY = null;
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
    if (lrSettleFrame && Math.abs(window.scrollY - lrSettleWrittenY) > 6) cancelLrSettle();
  }, { passive: true });
  document.addEventListener("pv:snap-to", (event) => {
    const detail = (event as CustomEvent<{ to?: Section }>).detail;
    if (!detail?.to || reducedMotion.matches || !event.cancelable) return;
    if (detail.to === "reviews") {
      const y = window.scrollY;
      const { reviews: reviewsTop } = scrollLayout(y);
      if (reviews!.dataset.scHandoff === "sticky" && y > reviewsTop + ALIGN_TOLERANCE) {
        event.preventDefault();
        stopTouchMomentum();
        animateTo({ from: "memories", to: "reviews", direction: -1, target: reviewsTop });
      }
    }
  });
  /** 视口或导航改变时同时放下换页与触摸余滑。 */
  function cancelScrollMotion() {
    cancel();
    cancelLrSettle();
    lrCatchGate = null;
    lrProjectedY = null;
    stopTouchMomentum();
  }
  window.addEventListener("resize", cancelScrollMotion, { passive: true });
  window.addEventListener("hashchange", cancelScrollMotion);
  reducedMotion.addEventListener("change", cancelScrollMotion);
}
