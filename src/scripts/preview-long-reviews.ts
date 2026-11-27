export interface LongReviewStop {
  id: string;
  lockY: number;
  releaseY: number;
}

type Rgb = [number, number, number];

function parseRgb(raw: string | undefined, fallback: Rgb): Rgb {
  const parts = String(raw || "")
    .split(",")
    .map((n) => Number(n.trim()));
  return parts.length === 3 && parts.every(Number.isFinite) ? (parts as Rgb) : fallback;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const smoothstep = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

let cachedStickyTop = 146;
let cachedStickyWidth = -1;

function readStickyTop(stageCol: HTMLElement | null): number {
  const vw = window.innerWidth;
  if (vw <= 1024) return 86;
  if (cachedStickyWidth !== vw && stageCol) {
    cachedStickyTop = parseFloat(getComputedStyle(stageCol).top) || 146;
    cachedStickyWidth = vw;
  }
  return cachedStickyTop;
}

/**
 * 计算各篇长评“左图正好定住、右侧位于顶起点”的精准滚动位置，
 * 供 preview-snap.ts 统一调度（避免两套 wheel 监听器打架）。
 */
export function getLongReviewStops(scrollY = window.scrollY): LongReviewStop[] {
  const root = document.querySelector<HTMLElement>("[data-pv-long-reviews]");
  if (!root) return [];
  const editions = Array.from(root.querySelectorAll<HTMLElement>(".pv-lr-edition"));

  return editions
    .map((ed) => {
      const split = ed.querySelector<HTMLElement>(".pv-lr-split");
      const stageCol = ed.querySelector<HTMLElement>(".pv-lr-stage-col");
      const plate = ed.querySelector<HTMLElement>("[data-lr-plate]");
      if (!split || !stageCol || !plate) return null;
      const stickyTop = readStickyTop(stageCol);
      const splitTop = split.getBoundingClientRect().top + scrollY;
      const lockY = Math.max(0, Math.round(splitTop - stickyTop));
      const travel = Math.max(0, split.offsetHeight - plate.offsetHeight);
      return { id: ed.id, lockY, releaseY: lockY + travel };
    })
    .filter((v): v is LongReviewStop => Boolean(v));
}

/** 初始化主站尾部「长评」章节的暗场过渡、跨篇换色、左图纵轴平移与目录抽屉。 */
export function setupPreviewLongReviews() {
  const section = document.querySelector<HTMLElement>("[data-pv-long-reviews]");
  if (!section) return;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const chrome = section.querySelector<HTMLElement>("[data-lr-chrome]");
  const marqueeRail = section.querySelector<HTMLElement>("[data-lr-marquee-rail]");
  const marqueeTrack = section.querySelector<HTMLElement>("[data-lr-marquee-track]");
  const marqueeItems = Array.from(section.querySelectorAll<HTMLButtonElement>("[data-lr-marquee-item]"));
  const liveStatus = section.querySelector<HTMLElement>("[data-lr-live-status]");
  const ringFill = section.querySelector<SVGCircleElement>("[data-lr-ring-fill]");
  const dockPill = section.querySelector<HTMLAnchorElement>("[data-lr-dock]");

  const curtain = section.querySelector<HTMLElement>("[data-lr-curtain]");
  const curtainCopy = section.querySelector<HTMLElement>("[data-lr-curtain-copy]");
  const outro = section.querySelector<HTMLElement>("[data-lr-outro]");

  const editions = Array.from(section.querySelectorAll<HTMLElement>(".pv-lr-edition"));
  const themeNodes = Array.from(section.querySelectorAll<HTMLElement>("[data-lr-theme-section]"));

  const timelinePaperBg: Rgb = [234, 240, 235]; // WatchTimeline --sc-paper-timeline (#eaf0eb)
  const timelineInkFg: Rgb = [37, 62, 73];
  const firstBg = parseRgb(section.dataset.lrFirstBg, [74, 31, 42]);
  const firstFg = parseRgb(section.dataset.lrFirstFg, [244, 206, 216]);

  const themeStops = themeNodes.map((el) => ({
    el,
    bg: parseRgb(el.dataset.lrBg, firstBg),
    fg: parseRgb(el.dataset.lrFg, firstFg),
  }));

  const plates = editions.map((ed) => {
    const backdrop = ed.querySelector<HTMLImageElement>("[data-lr-backdrop]");
    return {
      edition: ed,
      split: ed.querySelector<HTMLElement>(".pv-lr-split"),
      stageCol: ed.querySelector<HTMLElement>(".pv-lr-stage-col"),
      plate: ed.querySelector<HTMLElement>("[data-lr-plate]"),
      backdrop,
      expansion: ed.querySelector<HTMLElement>(".pv-lr-expansion"),
      lastTransform: "",
    };
  });

  let lastPaletteKey = "";
  function applyPalette(bg: Rgb, fg: Rgb) {
    const bgr = Math.round(bg[0]);
    const bgg = Math.round(bg[1]);
    const bgb = Math.round(bg[2]);
    const fgr = Math.round(fg[0]);
    const fgg = Math.round(fg[1]);
    const fgb = Math.round(fg[2]);
    const key = `${bgr},${bgg},${bgb}|${fgr},${fgg},${fgb}`;
    if (key === lastPaletteKey) return;
    lastPaletteKey = key;

    section!.style.setProperty("--lr-bg", `rgb(${bgr}, ${bgg}, ${bgb})`);
    section!.style.setProperty("--lr-fg", `rgb(${fgr}, ${fgg}, ${fgb})`);
    section!.style.setProperty("--lr-border", `rgba(${fgr}, ${fgg}, ${fgb}, 0.30)`);
    section!.style.setProperty("--lr-rule", `rgba(${fgr}, ${fgg}, ${fgb}, 0.21)`);
    section!.style.setProperty("--lr-muted", `rgba(${fgr}, ${fgg}, ${fgb}, 0.70)`);
    section!.style.setProperty("--lr-faint", `rgba(${fgr}, ${fgg}, ${fgb}, 0.10)`);
  }

  let ringCircumference = 0;
  if (ringFill) {
    const r = Number(ringFill.getAttribute("r")) || 9;
    ringCircumference = 2 * Math.PI * r;
    ringFill.style.strokeDasharray = `${ringCircumference}`;
    ringFill.style.strokeDashoffset = `${ringCircumference}`;
  }

  let currentEditionIndex = -1;
  let currentMarqueeShift = 0;
  let targetMarqueeShift = 0;
  let isSectionActive = false;
  let lastChromeVisible: boolean | null = null;
  let lastMarqueeVisible: boolean | null = null;
  let lastMarqueeGhosted: boolean | null = null;
  let lastDockVisible: boolean | null = null;
  let rafId = 0;

  function updateFrame() {
    rafId = 0;
    const vh = window.innerHeight || 900;
    const vw = window.innerWidth;
    const scrollY = window.scrollY;
    const docScrollH = document.documentElement.scrollHeight;
    const isDesktop = vw > 1024;
    const isReduced = reduceMotion.matches;

    // ==================== 1. 纯 READ 阶段（统一读取几何，避免读写交错触发同步重排） ====================
    const secRect = section!.getBoundingClientRect();
    const firstEd = editions[0];
    const firstEdRect = firstEd?.getBoundingClientRect() ?? null;
    const curtainTop = curtain ? curtain.getBoundingClientRect().top : secRect.top;
    const curtainH = curtain ? curtain.offsetHeight : vh * 0.56;
    const outroRect = outro?.getBoundingClientRect() ?? null;

    // 远离长评章节且未激活时，提前做轻量颜色同步并跳过多余计算
    if (secRect.top > vh * 1.5 && !isSectionActive) {
      applyPalette(timelinePaperBg, timelineInkFg);
      return;
    }

    const themeTops = themeStops.map((s) => s.el.getBoundingClientRect().top + scrollY);
    const editionTops = editions.map((ed) => ed.getBoundingClientRect().top);

    let activeIdx = 0;
    const refLine = vh * 0.38;
    for (let i = 0; i < editionTops.length; i += 1) {
      if (editionTops[i] <= refLine) activeIdx = i;
    }
    const activeExpTop = plates[activeIdx]?.expansion?.getBoundingClientRect().top ?? Infinity;

    const stickyTop = isDesktop ? readStickyTop(plates[0]?.stageCol ?? null) : 86;
    const plateReads =
      isDesktop && !isReduced
        ? plates.map((item) => {
            if (!item.split || !item.plate || !item.backdrop) return null;
            const splitRect = item.split.getBoundingClientRect();
            const plateW = item.plate.clientWidth;
            const plateH = item.plate.clientHeight;
            const natW = Number(item.backdrop.getAttribute("width")) || item.backdrop.naturalWidth || plateW;
            const natH = Number(item.backdrop.getAttribute("height")) || item.backdrop.naturalHeight || plateH;
            return { splitRect, plateW, plateH, natW, natH };
          })
        : null;

    let nextTargetMarqueeShift = targetMarqueeShift;
    if (activeIdx !== currentEditionIndex && marqueeItems[activeIdx] && marqueeTrack && marqueeRail) {
      const maxShift = Math.max(0, marqueeTrack.scrollWidth - marqueeRail.clientWidth + 64);
      nextTargetMarqueeShift = -clamp(marqueeItems[activeIdx].offsetLeft, 0, maxShift);
    }

    // ==================== 2. 纯 WRITE 阶段（仅在值变化时写入 DOM / CSS 变量） ====================

    // 2.1 暗场沉降进度（WatchTimeline #eaf0eb -> Essay 01 #4A1F2A）
    const descentRaw = clamp((vh * 0.84 - curtainTop) / Math.max(240, curtainH + vh * 0.2), 0, 1);
    const descentT = smoothstep(descentRaw);

    if (curtainCopy) {
      if (isReduced) {
        curtainCopy.style.opacity = "1";
        curtainCopy.style.transform = "";
      } else {
        const appear = smoothstep(clamp(descentRaw / 0.38, 0, 1));
        const fadeOut = 1 - smoothstep(clamp((descentRaw - 0.62) / 0.34, 0, 1));
        const lift = (descentRaw - 0.45) * -46;
        curtainCopy.style.opacity = (appear * fadeOut).toFixed(3);
        curtainCopy.style.transform = `translate3d(0, ${lift.toFixed(1)}px, 0)`;
      }
    }

    // 2.2 顶部双层细线栏与水平标题带仅在进入长评第一篇之后显现，进入尾声页脚区域时自动收起
    const enteredFirst = firstEdRect ? firstEdRect.top <= vh * 0.48 : secRect.top <= 0;
    const inOutro = Boolean(outroRect && outroRect.top <= vh * 0.72);
    isSectionActive = enteredFirst && secRect.bottom > vh * 0.22 && !inOutro;

    if (chrome && isSectionActive !== lastChromeVisible) {
      lastChromeVisible = isSectionActive;
      chrome.classList.toggle("is-visible", isSectionActive);
      chrome.setAttribute("aria-hidden", String(!isSectionActive));
    }

    // 2.3 长评区间内部总进度环
    if (ringFill && ringCircumference && firstEdRect) {
      const startY = firstEdRect.top + scrollY;
      const endY = (outroRect ? outroRect.top + scrollY : secRect.bottom + scrollY) - vh * 0.6;
      const localProgress = clamp((scrollY - startY) / Math.max(1, endY - startY), 0, 1);
      ringFill.style.strokeDashoffset = `${(ringCircumference * (1 - localProgress)).toFixed(2)}`;
    }

    // 2.4 色彩过渡：暗场过渡幕（时间轴纸色 -> 首篇酒红），进入篇目后各篇连续 RGB 换色直至尾声浅纸白
    if (descentRaw < 0.995 && (!firstEdRect || firstEdRect.top > vh * 0.35)) {
      applyPalette(
        [
          lerp(timelinePaperBg[0], firstBg[0], descentT),
          lerp(timelinePaperBg[1], firstBg[1], descentT),
          lerp(timelinePaperBg[2], firstBg[2], descentT),
        ],
        [
          lerp(timelineInkFg[0], firstFg[0], descentT),
          lerp(timelineInkFg[1], firstFg[1], descentT),
          lerp(timelineInkFg[2], firstFg[2], descentT),
        ],
      );
    } else if (themeStops.length) {
      const maxScroll = Math.max(1, docScrollH - vh);
      const bottomBoost = smoothstep(clamp((scrollY - (maxScroll - vh * 0.55)) / (vh * 0.45), 0, 1));
      const anchorY = scrollY + vh * lerp(0.44, 0.92, bottomBoost);

      let idx = 0;
      for (let i = 0; i < themeTops.length; i += 1) {
        if (anchorY >= themeTops[i]) idx = i;
      }

      const current = themeStops[idx];
      const next = themeStops[idx + 1];
      let mixT = 0;
      if (next) {
        const band = Math.min(vh * 0.68, Math.max(260, (themeTops[idx + 1] - themeTops[idx]) * 0.34));
        const startTrans = themeTops[idx + 1] - band;
        if (anchorY > startTrans) {
          mixT = smoothstep((anchorY - startTrans) / band);
        }
      }

      if (next && mixT > 0.001) {
        applyPalette(
          [
            lerp(current.bg[0], next.bg[0], mixT),
            lerp(current.bg[1], next.bg[1], mixT),
            lerp(current.bg[2], next.bg[2], mixT),
          ],
          [
            lerp(current.fg[0], next.fg[0], mixT),
            lerp(current.fg[1], next.fg[1], mixT),
            lerp(current.fg[2], next.fg[2], mixT),
          ],
        );
      } else {
        applyPalette(current.bg, current.fg);
      }
    }

    // 2.5 跑马灯与左下角直达条状态
    let shouldGhostMarquee = false;
    let shouldHideDock = !isSectionActive;
    if (inOutro) {
      shouldGhostMarquee = true;
      shouldHideDock = true;
    } else if (Number.isFinite(activeExpTop)) {
      if (activeExpTop < vh * 0.54) shouldGhostMarquee = true;
      if (activeExpTop < vh - 64) shouldHideDock = true;
    }

    if (marqueeRail && (isSectionActive !== lastMarqueeVisible || shouldGhostMarquee !== lastMarqueeGhosted)) {
      lastMarqueeVisible = isSectionActive;
      lastMarqueeGhosted = shouldGhostMarquee;
      marqueeRail.classList.toggle("is-visible", isSectionActive);
      marqueeRail.classList.toggle("is-ghosted", shouldGhostMarquee);
      marqueeRail.setAttribute("aria-hidden", String(!isSectionActive || shouldGhostMarquee));
    }

    const dockVisible = !shouldHideDock;
    if (dockPill && dockVisible !== lastDockVisible) {
      lastDockVisible = dockVisible;
      dockPill.classList.toggle("is-visible", dockVisible);
      dockPill.setAttribute("aria-hidden", String(!dockVisible));
    }

    if (activeIdx !== currentEditionIndex && editions[activeIdx]) {
      currentEditionIndex = activeIdx;
      targetMarqueeShift = nextTargetMarqueeShift;
      const activeEd = editions[activeIdx];
      const num = activeEd.dataset.lrNo || "01";
      const total = String(editions.length).padStart(2, "0");
      const dateLabel = activeEd.dataset.lrDate || "";
      const workLabel = activeEd.dataset.lrWork || "";
      const scoreLabel = activeEd.dataset.lrScore || "";
      const href = activeEd.dataset.lrHref || "#";

      if (liveStatus) {
        liveStatus.textContent = `[ ${num} / ${total} · ${dateLabel} · ${workLabel} ]`;
      }
      if (dockPill) {
        dockPill.href = href;
        dockPill.innerHTML = `<span>▸</span><span>NO.${num} ${workLabel}${scoreLabel ? ` · ${scoreLabel}` : ""}</span>`;
      }

      marqueeItems.forEach((item, i) => {
        item.classList.toggle("is-active", i === activeIdx);
      });
    }

    if (marqueeTrack) {
      if (isReduced) {
        currentMarqueeShift = targetMarqueeShift;
      } else {
        currentMarqueeShift += (targetMarqueeShift - currentMarqueeShift) * 0.16;
        if (Math.abs(targetMarqueeShift - currentMarqueeShift) > 0.35 && !rafId) {
          rafId = window.requestAnimationFrame(updateFrame);
        } else {
          currentMarqueeShift = targetMarqueeShift;
        }
      }
      marqueeTrack.style.transform = `translate3d(${currentMarqueeShift.toFixed(2)}px, 0, 0)`;
    }

    // 2.6 左图进出场纯纵向平移（宽 100% 恒定、原比例不缩放、停驻期间严格居中）
    for (let i = 0; i < plates.length; i += 1) {
      const item = plates[i];
      if (!item.backdrop) continue;
      if (!plateReads || !plateReads[i]) {
        const tf = "translate3d(0, -50%, 0)";
        if (item.lastTransform !== tf) {
          item.lastTransform = tf;
          item.backdrop.style.transform = tf;
        }
        continue;
      }

      const { splitRect, plateW, plateH, natW, natH } = plateReads[i]!;
      const imgRenderedH = plateW * (natH / natW);
      const overflowY = Math.max(0, (imgRenderedH - plateH) / 2);
      // 充分利用竖版海报上下余量（保留 4% 安全边距确保绝不露底），让进出场纵轴视差更舒展明显
      const maxPan = Math.min(overflowY * 0.96, 380);

      let panRatio = 0;
      const panSpan = vh * 0.74;
      if (splitRect.top > stickyTop + 1) {
        panRatio = -clamp((splitRect.top - stickyTop) / panSpan, 0, 1);
      } else if (splitRect.bottom < stickyTop + plateH - 1) {
        panRatio = clamp((stickyTop + plateH - splitRect.bottom) / panSpan, 0, 1);
      }

      const imgPanY = panRatio * maxPan;
      const tf = `translate3d(0, calc(-50% + ${imgPanY.toFixed(2)}px), 0)`;
      if (item.lastTransform !== tf) {
        item.lastTransform = tf;
        item.backdrop.style.transform = tf;
      }
    }
  }

  function scheduleUpdate() {
    if (!rafId) rafId = window.requestAnimationFrame(updateFrame);
  }

  window.addEventListener("scroll", scheduleUpdate, { passive: true });
  window.addEventListener("resize", () => {
    cachedStickyWidth = -1;
    currentEditionIndex = -1;
    scheduleUpdate();
  });

  // 跑马灯点击直达各篇精准定住位 lockY
  marqueeItems.forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.lrMarqueeItem;
      const stop = getLongReviewStops().find((s) => s.id === targetId);
      if (stop) {
        window.scrollTo({ top: stop.lockY, behavior: reduceMotion.matches ? "auto" : "smooth" });
      }
    });
  });

  // 主站顶栏「长评」导航直达第一篇精准定住位
  document.querySelectorAll<HTMLAnchorElement>('a[href="#preview-long-reviews"]').forEach((link) => {
    link.addEventListener("click", (event) => {
      const stops = getLongReviewStops();
      if (!stops.length) return;
      event.preventDefault();
      window.scrollTo({ top: stops[0].lockY, behavior: reduceMotion.matches ? "auto" : "smooth" });
    });
  });

  // 从详情页返回 /#review-edition-{id} 时自动对齐到对应篇目定住位
  function alignInitialHash() {
    const hash = window.location.hash.replace(/^#/, "");
    if (!hash) return;
    if (hash === "preview-long-reviews") {
      const firstStop = getLongReviewStops()[0];
      if (firstStop) window.scrollTo({ top: firstStop.lockY, behavior: "instant" });
      return;
    }
    if (hash.startsWith("review-edition-")) {
      const stop = getLongReviewStops().find((s) => s.id === hash);
      if (stop) window.scrollTo({ top: stop.lockY, behavior: "instant" });
    }
  }
  requestAnimationFrame(() => requestAnimationFrame(alignInitialHash));

  // ---------- [ ARCHIVE ] 缩略图画廊切换 ----------
  section.querySelectorAll<HTMLElement>("[data-lr-colophon-gallery]").forEach((gallery) => {
    const mainImg = gallery.querySelector<HTMLImageElement>("[data-lr-gallery-main]");
    const capText = gallery.querySelector<HTMLElement>("[data-lr-gallery-caption]");
    const capIdx = gallery.querySelector<HTMLElement>("[data-lr-gallery-index]");
    const thumbs = Array.from(gallery.querySelectorAll<HTMLButtonElement>("[data-lr-thumb-btn]"));

    thumbs.forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.getAttribute("aria-pressed") === "true" || !mainImg) return;
        thumbs.forEach((t) => t.setAttribute("aria-pressed", String(t === btn)));
        const nextSrc = btn.dataset.src || "";
        const nextAlt = btn.dataset.alt || "";
        const nextCap = btn.dataset.caption || "";
        const nextIdx = btn.dataset.index || "01";
        const isContain = btn.dataset.fit === "contain" || btn.dataset.kind === "poster";

        mainImg.classList.add("is-swapping");
        window.setTimeout(() => {
          mainImg.src = nextSrc;
          mainImg.alt = nextAlt;
          mainImg.classList.toggle("is-contain", isContain);
          if (capText) capText.textContent = nextCap;
          if (capIdx) capIdx.textContent = nextIdx;
          mainImg.classList.remove("is-swapping");
        }, 160);
      });
    });
  });

  // ---------- [ESC] 全屏长评目录抽屉 ----------
  const shelf = section.querySelector<HTMLElement>("[data-lr-shelf]");
  const shelfOpeners = Array.from(section.querySelectorAll<HTMLButtonElement>("[data-lr-shelf-open]"));
  const shelfCloser = section.querySelector<HTMLButtonElement>("[data-lr-shelf-close]");
  const shelfFilters = Array.from(section.querySelectorAll<HTMLButtonElement>("[data-lr-shelf-filter]"));
  const shelfRows = Array.from(section.querySelectorAll<HTMLElement>("[data-lr-shelf-row]"));
  const shelfPreviewImg = section.querySelector<HTMLImageElement>("[data-lr-shelf-preview-img]");
  const shelfPreviewTitle = section.querySelector<HTMLElement>("[data-lr-shelf-preview-title]");
  const shelfPreviewMeta = section.querySelector<HTMLElement>("[data-lr-shelf-preview-meta]");
  let lastTrigger: HTMLElement | null = null;

  function openShelf(trigger?: HTMLElement | null) {
    if (!shelf) return;
    lastTrigger = trigger ?? (document.activeElement as HTMLElement | null);
    shelf.classList.add("is-open");
    shelf.setAttribute("aria-hidden", "false");
    document.body.classList.add("is-lr-shelf-open");
    shelfCloser?.focus();
  }

  function closeShelf() {
    if (!shelf || !shelf.classList.contains("is-open")) return;
    shelf.classList.remove("is-open");
    shelf.setAttribute("aria-hidden", "true");
    document.body.classList.remove("is-lr-shelf-open");
    lastTrigger?.focus();
  }

  shelfOpeners.forEach((btn) => btn.addEventListener("click", () => openShelf(btn)));
  shelfCloser?.addEventListener("click", closeShelf);

  shelfFilters.forEach((btn) => {
    btn.addEventListener("click", () => {
      const year = btn.dataset.lrShelfFilter || "all";
      shelfFilters.forEach((f) => f.setAttribute("aria-pressed", String(f === btn)));
      shelfRows.forEach((row) => {
        row.hidden = year !== "all" && row.dataset.year !== year;
      });
    });
  });

  shelfRows.forEach((row) => {
    const activate = () => {
      shelfRows.forEach((r) => r.classList.toggle("is-previewed", r === row));
      if (shelfPreviewImg && row.dataset.previewSrc) {
        shelfPreviewImg.src = row.dataset.previewSrc;
        shelfPreviewImg.alt = row.dataset.previewTitle || "";
      }
      if (shelfPreviewTitle) shelfPreviewTitle.textContent = row.dataset.previewTitle || "";
      if (shelfPreviewMeta) shelfPreviewMeta.textContent = row.dataset.previewMeta || "";
    };
    row.addEventListener("mouseenter", activate);
    row.addEventListener("focusin", activate);

    const jumpBtn = row.querySelector<HTMLButtonElement>("[data-lr-shelf-jump]");
    jumpBtn?.addEventListener("click", () => {
      const targetId = jumpBtn.dataset.lrShelfJump;
      closeShelf();
      const stop = getLongReviewStops().find((s) => s.id === targetId);
      if (stop) {
        window.scrollTo({ top: stop.lockY, behavior: reduceMotion.matches ? "auto" : "smooth" });
      }
    });
  });

  // Lightbox
  const lightbox = section.querySelector<HTMLDialogElement>("[data-lr-lightbox]");
  const lightboxImg = section.querySelector<HTMLImageElement>("[data-lr-lightbox-img]");
  const lightboxCap = section.querySelector<HTMLElement>("[data-lr-lightbox-cap]");
  const lightboxClose = section.querySelector<HTMLButtonElement>("[data-lr-lightbox-close]");

  section.querySelectorAll<HTMLButtonElement>("[data-lr-zoom-src]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!lightbox || !lightboxImg) return;
      lightboxImg.src = btn.dataset.lrZoomSrc || "";
      lightboxImg.alt = btn.dataset.lrZoomCaption || "";
      if (lightboxCap) lightboxCap.textContent = btn.dataset.lrZoomCaption || "";
      lightbox.showModal();
    });
  });

  lightboxClose?.addEventListener("click", () => lightbox?.close());
  lightbox?.addEventListener("click", (e) => {
    if (e.target === lightbox) lightbox.close();
  });

  // 仅当用户正在长评章节内且没有其他弹窗打开时，按 ESC 呼出或关闭长评目录，避免干扰光碟与短评弹窗
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (lightbox?.open) return;
    if (shelf?.classList.contains("is-open")) {
      event.preventDefault();
      closeShelf();
      return;
    }
    if (!isSectionActive) return;
    if (document.querySelector("dialog[open], [data-sc-archive-drawer]:not([hidden])")) return;
    event.preventDefault();
    openShelf(document.activeElement as HTMLElement | null);
  });

  updateFrame();
}
