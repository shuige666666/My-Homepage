(() => {
  "use strict";

  const root = document.documentElement;
  const body = document.body;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const sections = Array.from(document.querySelectorAll("[data-theme-section]"));
  const editions = Array.from(document.querySelectorAll(".essay-edition"));
  const marqueeRail = document.querySelector("[data-marquee-rail]");
  const marqueeTrack = document.querySelector("[data-marquee-track]");
  const marqueeItems = Array.from(document.querySelectorAll("[data-marquee-item]"));
  const liveStatus = document.querySelector("[data-live-status]");
  const ringFill = document.querySelector("[data-ring-fill]");
  const dockPill = document.querySelector("[data-dock-pill]");

  function parseRgb(raw, fallback) {
    const parts = String(raw || "")
      .split(",")
      .map((n) => Number(n.trim()));
    return parts.length === 3 && parts.every(Number.isFinite) ? parts : fallback;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  function smoothstep(t) {
    const x = clamp(t, 0, 1);
    return x * x * (3 - 2 * x);
  }

  function applySurfacePalette(bg, fg) {
    const bgr = Math.round(bg[0]);
    const bgg = Math.round(bg[1]);
    const bgb = Math.round(bg[2]);
    const fgr = Math.round(fg[0]);
    const fgg = Math.round(fg[1]);
    const fgb = Math.round(fg[2]);

    root.style.setProperty("--surface-bg", `rgb(${bgr}, ${bgg}, ${bgb})`);
    root.style.setProperty("--surface-fg", `rgb(${fgr}, ${fgg}, ${fgb})`);
    root.style.setProperty("--surface-border", `rgba(${fgr}, ${fgg}, ${fgb}, 0.30)`);
    root.style.setProperty("--surface-rule", `rgba(${fgr}, ${fgg}, ${fgb}, 0.21)`);
    root.style.setProperty("--surface-muted", `rgba(${fgr}, ${fgg}, ${fgb}, 0.70)`);
    root.style.setProperty("--surface-faint", `rgba(${fgr}, ${fgg}, ${fgb}, 0.10)`);
  }

  const themeStops = sections.map((el) => ({
    el,
    bg: parseRgb(el.dataset.themeBg, [74, 31, 42]),
    fg: parseRgb(el.dataset.themeFg, [244, 206, 216]),
  }));

  const plates = editions.map((ed) => ({
    edition: ed,
    split: ed.querySelector(".ed-split"),
    expansion: ed.querySelector(".ed-expansion"),
    stageCol: ed.querySelector(".ed-stage-col"),
    plate: ed.querySelector("[data-parallax-plate]"),
    backdrop: ed.querySelector("[data-parallax-backdrop]"),
  }));

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
  let rafId = 0;

  /**
   * 仅对本身高宽比接近或宽于画框的横图做轻量检查；常规桌面下始终维持 Stripe Press 式高幅画框。
   */
  function syncPlateHeights() {
    for (const item of plates) {
      if (!item.plate) continue;
      item.plate.style.height = "";
    }
  }

  function updateOnScroll() {
    rafId = 0;
    const vh = window.innerHeight || 900;
    const scrollY = window.scrollY;
    const maxScroll = Math.max(1, document.documentElement.scrollHeight - vh);
    const totalProgress = clamp(scrollY / maxScroll, 0, 1);

    // 1. 顶部圆形进度环
    if (ringFill && ringCircumference) {
      ringFill.style.strokeDashoffset = `${ringCircumference * (1 - totalProgress)}`;
    }

    // 2. 跨篇连续 RGB 色彩过渡
    if (themeStops.length) {
      const anchorY = scrollY + vh * 0.44;
      const tops = themeStops.map((s) => s.el.getBoundingClientRect().top + scrollY);

      let idx = 0;
      for (let i = 0; i < tops.length; i += 1) {
        if (anchorY >= tops[i]) idx = i;
      }

      const current = themeStops[idx];
      const next = themeStops[idx + 1];
      let mixT = 0;

      if (next) {
        const transitionBand = Math.min(vh * 0.68, Math.max(260, (tops[idx + 1] - tops[idx]) * 0.34));
        const startTransition = tops[idx + 1] - transitionBand;
        if (anchorY > startTransition) {
          mixT = smoothstep((anchorY - startTransition) / transitionBand);
        }
      }

      if (next && mixT > 0.001) {
        applySurfacePalette(
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
        applySurfacePalette(current.bg, current.fg);
      }
    }

    // 3. 当前活跃长评、顶栏状态、跑马灯与左下角浮标
    let activeIdx = 0;
    let shouldGhostMarquee = false;
    const refLine = vh * 0.36;

    editions.forEach((ed, i) => {
      const rect = ed.getBoundingClientRect();
      if (rect.top <= refLine) activeIdx = i;
    });

    const footerEl = document.querySelector(".sc-footer");
    let shouldHideDock = false;
    if (footerEl && footerEl.getBoundingClientRect().top < vh * 0.62) {
      shouldGhostMarquee = true;
      shouldHideDock = true;
    } else if (plates[activeIdx]?.expansion) {
      const expTop = plates[activeIdx].expansion.getBoundingClientRect().top;
      if (expTop < vh * 0.54) shouldGhostMarquee = true;
      if (expTop < vh - 64) shouldHideDock = true;
    }

    if (marqueeRail) {
      marqueeRail.classList.toggle("is-ghosted", shouldGhostMarquee);
    }
    if (dockPill) {
      dockPill.classList.toggle("is-hidden", shouldHideDock);
    }

    if (activeIdx !== currentEditionIndex && editions[activeIdx]) {
      currentEditionIndex = activeIdx;
      const activeEd = editions[activeIdx];
      const num = activeEd.dataset.essayNo || "01";
      const total = String(editions.length).padStart(2, "0");
      const dateLabel = activeEd.dataset.essayDate || "";
      const workLabel = activeEd.dataset.essayWork || "";
      const scoreLabel = activeEd.dataset.essayScore || "";
      const href = activeEd.dataset.essayHref || "#";

      if (liveStatus) {
        liveStatus.textContent = `[ ${num} / ${total} · ${dateLabel} · ${workLabel} ]`;
      }
      if (dockPill) {
        dockPill.setAttribute("href", href);
        dockPill.innerHTML = `<span>▸</span><span>NO.${num} ${workLabel}${scoreLabel ? ` · ${scoreLabel}` : ""}</span>`;
      }

      marqueeItems.forEach((item, i) => {
        item.classList.toggle("is-active", i === activeIdx);
      });

      const activeMarquee = marqueeItems[activeIdx];
      if (activeMarquee && marqueeTrack && marqueeRail) {
        const maxShift = Math.max(0, marqueeTrack.scrollWidth - marqueeRail.clientWidth + 64);
        targetMarqueeShift = -clamp(activeMarquee.offsetLeft, 0, maxShift);
      }
    }

    if (marqueeTrack) {
      if (reduceMotion.matches) {
        currentMarqueeShift = targetMarqueeShift;
      } else {
        currentMarqueeShift += (targetMarqueeShift - currentMarqueeShift) * 0.16;
        if (Math.abs(targetMarqueeShift - currentMarqueeShift) > 0.35 && !rafId) {
          rafId = window.requestAnimationFrame(updateOnScroll);
        } else {
          currentMarqueeShift = targetMarqueeShift;
        }
      }
      marqueeTrack.style.transform = `translate3d(${currentMarqueeShift.toFixed(2)}px, 0, 0)`;
    }

    // 4. Stripe Press 式“停驻 + 进出纯纵向平移”动效：
    //    - 进场（splitRect.top > stickyTop）：图片框随滚动上移进入，框内图片从上方平滑滑向正中；
    //    - 停驻（右侧文字长于左图，滚动阅读右侧内容期间）：左侧图片框完全不动（原生 sticky），图片严格纵轴居中；
    //    - 离场（右侧文字滑到底，splitRect.bottom < stickyTop + plateH）：图片框随段落一起向上离场，框内图片反向平滑下移。
    const isDesktop = window.innerWidth > 1024;

    for (const item of plates) {
      if (!item.split || !item.stageCol || !item.plate || !item.backdrop) continue;
      item.plate.style.transform = "";

      if (reduceMotion.matches || !isDesktop) {
        item.backdrop.style.transform = "translate3d(0, -50%, 0)";
        continue;
      }

      const stickyTop = parseFloat(getComputedStyle(item.stageCol).top) || 146;
      const splitRect = item.split.getBoundingClientRect();
      const plateW = item.plate.clientWidth;
      const plateH = item.plate.clientHeight;
      const natW = Number(item.backdrop.getAttribute("width")) || item.backdrop.naturalWidth || plateW;
      const natH = Number(item.backdrop.getAttribute("height")) || item.backdrop.naturalHeight || plateH;
      const imgRenderedH = plateW * (natH / natW);
      const overflowY = Math.max(0, (imgRenderedH - plateH) / 2);
      const maxPan = Math.min(overflowY, 220);

      let panRatio = 0; // -1 = 进场上方偏移, 0 = 停驻居中, +1 = 离场下方偏移
      if (splitRect.top > stickyTop + 1) {
        panRatio = -clamp((splitRect.top - stickyTop) / (vh * 0.85), 0, 1);
      } else if (splitRect.bottom < stickyTop + plateH - 1) {
        panRatio = clamp((stickyTop + plateH - splitRect.bottom) / (vh * 0.85), 0, 1);
      } else {
        panRatio = 0;
      }

      const imgPanY = panRatio * maxPan;
      item.backdrop.style.transform = `translate3d(0, calc(-50% + ${imgPanY.toFixed(2)}px), 0)`;
    }
  }

  function scheduleUpdate() {
    if (!rafId) rafId = window.requestAnimationFrame(updateOnScroll);
  }

  /** 计算每篇长评“左图正好定住、右侧刚好位于顶起点”的精准滚动锚点 lockY 与释放点 releaseY。 */
  function getEditionStops() {
    const scrollY = window.scrollY;
    return plates
      .map((item) => {
        if (!item.split || !item.stageCol || !item.plate) return null;
        const stickyTop = parseFloat(getComputedStyle(item.stageCol).top) || 146;
        const splitTop = item.split.getBoundingClientRect().top + scrollY;
        const lockY = Math.max(0, Math.round(splitTop - stickyTop));
        const travel = Math.max(0, item.split.offsetHeight - item.plate.offsetHeight);
        return {
          id: item.edition.id,
          lockY,
          releaseY: lockY + travel,
        };
      })
      .filter(Boolean);
  }

  // ---------- 图片定住边界收住逻辑（到达某篇定住位时收住当次滚动，下一次滑动再推动右侧向下滚动） ----------
  let settleRaf = 0;
  let settleWrittenY = 0;
  let lastWheelAt = -Infinity;
  let lastWheelDir = 0;
  let catchGate = null; // { dir, until, hardCap }

  function cancelSettle() {
    if (!settleRaf) return;
    window.cancelAnimationFrame(settleRaf);
    settleRaf = 0;
  }

  function smoothSettleTo(targetY, dir) {
    cancelSettle();
    const startY = window.scrollY;
    const dist = targetY - startY;
    if (Math.abs(dist) < 1.5) {
      window.scrollTo({ top: targetY, behavior: "instant" });
      return;
    }
    const duration = Math.min(340, Math.max(180, Math.round(Math.abs(dist) * 1.15)));
    const startAt = performance.now();
    catchGate = { dir, until: startAt + duration + 160, hardCap: startAt + duration + 380 };

    function step(now) {
      const t = clamp((now - startAt) / duration, 0, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const nextY = startY + dist * eased;
      window.scrollTo({ top: nextY, behavior: "instant" });
      settleWrittenY = window.scrollY;
      if (t < 1) {
        settleRaf = window.requestAnimationFrame(step);
      } else {
        settleRaf = 0;
      }
    }
    settleRaf = window.requestAnimationFrame(step);
  }

  window.addEventListener("scroll", () => {
    if (settleRaf && Math.abs(window.scrollY - settleWrittenY) > 6) {
      cancelSettle();
    }
    scheduleUpdate();
  }, { passive: true });

  window.addEventListener(
    "wheel",
    (event) => {
      if (
        reduceMotion.matches ||
        window.innerWidth <= 1024 ||
        event.defaultPrevented ||
        !event.cancelable ||
        event.ctrlKey ||
        event.shiftKey ||
        !event.deltaY ||
        Math.abs(event.deltaX) > Math.abs(event.deltaY) ||
        body.classList.contains("is-shelf-open") ||
        document.querySelector("dialog[open]")
      ) {
        return;
      }

      const now = performance.now();
      const delta =
        event.deltaY *
        (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1);
      const dir = delta > 0 ? 1 : -1;
      const gap = now - lastWheelAt;
      const isFreshGesture = gap > 165 || dir !== lastWheelDir;
      lastWheelAt = now;
      lastWheelDir = dir;

      if (settleRaf) {
        if (dir !== catchGate?.dir) {
          cancelSettle();
          catchGate = null;
          return;
        }
        event.preventDefault();
        return;
      }

      // 刚刚把本篇图片定住在停驻位：吞掉同一笔滑动的剩余惯性；等用户下一次滑动时立即放行右侧滚动
      if (catchGate) {
        if (isFreshGesture || now >= catchGate.until || now >= catchGate.hardCap) {
          catchGate = null;
        } else {
          event.preventDefault();
          catchGate.until = Math.min(catchGate.hardCap, now + 150);
          return;
        }
      }

      const y = window.scrollY;
      const stops = getEditionStops();

      if (dir === 1) {
        // 向下滚动穿过某篇长评的定住位 lockY：先精准定住左图，下一次滑动再让右侧内容向下滚动
        for (const stop of stops) {
          if (y < stop.lockY - 2 && y + delta >= stop.lockY - 2) {
            event.preventDefault();
            smoothSettleTo(stop.lockY, 1);
            return;
          }
        }
      } else {
        // 在某篇右侧阅读区间内向上滚回本篇顶部 lockY 时也轻柔停住，避免直接越回上一篇
        for (let i = stops.length - 1; i >= 0; i -= 1) {
          const stop = stops[i];
          if (y > stop.lockY + 2 && y <= stop.releaseY + 60 && y + delta <= stop.lockY + 2) {
            event.preventDefault();
            smoothSettleTo(stop.lockY, -1);
            return;
          }
        }
      }
    },
    { passive: false },
  );

  window.addEventListener("resize", () => {
    cancelSettle();
    catchGate = null;
    currentEditionIndex = -1;
    syncPlateHeights();
    scheduleUpdate();
  });

  // 顶部标题条点击平滑滚动至对应长评定住位 lockY
  marqueeItems.forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.marqueeItem;
      const stop = getEditionStops().find((s) => s.id === targetId);
      if (stop) {
        cancelSettle();
        catchGate = null;
        window.scrollTo({ top: stop.lockY, behavior: reduceMotion.matches ? "auto" : "smooth" });
      }
    });
  });

  // ---------- Colophon 缩略图切换 ----------
  document.querySelectorAll("[data-colophon-gallery]").forEach((gallery) => {
    const mainImg = gallery.querySelector("[data-gallery-main]");
    const capText = gallery.querySelector("[data-gallery-caption]");
    const capIdx = gallery.querySelector("[data-gallery-index]");
    const thumbs = Array.from(gallery.querySelectorAll("[data-thumb-btn]"));

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

  // ---------- [ESC] 全屏目录抽屉 ----------
  const shelf = document.querySelector("[data-shelf]");
  const shelfOpeners = Array.from(document.querySelectorAll("[data-shelf-open]"));
  const shelfCloser = document.querySelector("[data-shelf-close]");
  const shelfFilters = Array.from(document.querySelectorAll("[data-shelf-filter]"));
  const shelfRows = Array.from(document.querySelectorAll("[data-shelf-row]"));
  const shelfPreviewImg = document.querySelector("[data-shelf-preview-img]");
  const shelfPreviewTitle = document.querySelector("[data-shelf-preview-title]");
  const shelfPreviewMeta = document.querySelector("[data-shelf-preview-meta]");
  let lastTrigger = null;

  function openShelf(trigger) {
    if (!shelf) return;
    lastTrigger = trigger || document.activeElement;
    shelf.classList.add("is-open");
    shelf.setAttribute("aria-hidden", "false");
    body.classList.add("is-shelf-open");
    shelfCloser?.focus();
  }

  function closeShelf() {
    if (!shelf || !shelf.classList.contains("is-open")) return;
    shelf.classList.remove("is-open");
    shelf.setAttribute("aria-hidden", "true");
    body.classList.remove("is-shelf-open");
    if (lastTrigger && typeof lastTrigger.focus === "function") {
      lastTrigger.focus();
    }
  }

  shelfOpeners.forEach((btn) => btn.addEventListener("click", () => openShelf(btn)));
  shelfCloser?.addEventListener("click", closeShelf);

  shelfFilters.forEach((btn) => {
    btn.addEventListener("click", () => {
      const year = btn.dataset.shelfFilter || "all";
      shelfFilters.forEach((f) => f.setAttribute("aria-pressed", String(f === btn)));
      shelfRows.forEach((row) => {
        const match = year === "all" || row.dataset.year === year;
        row.hidden = !match;
      });
    });
  });

  shelfRows.forEach((row) => {
    const activatePreview = () => {
      shelfRows.forEach((r) => r.classList.toggle("is-previewed", r === row));
      if (shelfPreviewImg && row.dataset.previewSrc) {
        shelfPreviewImg.src = row.dataset.previewSrc;
        shelfPreviewImg.alt = row.dataset.previewTitle || "";
      }
      if (shelfPreviewTitle) shelfPreviewTitle.textContent = row.dataset.previewTitle || "";
      if (shelfPreviewMeta) shelfPreviewMeta.textContent = row.dataset.previewMeta || "";
    };
    row.addEventListener("mouseenter", activatePreview);
    row.addEventListener("focusin", activatePreview);

    const jumpBtn = row.querySelector("[data-shelf-jump]");
    jumpBtn?.addEventListener("click", () => {
      const targetId = jumpBtn.dataset.shelfJump;
      closeShelf();
      const stop = getEditionStops().find((s) => s.id === targetId);
      if (stop) {
        cancelSettle();
        catchGate = null;
        window.scrollTo({ top: stop.lockY, behavior: reduceMotion.matches ? "auto" : "smooth" });
      }
    });
  });

  // Lightbox 放大预览
  const lightbox = document.querySelector("[data-lightbox]");
  const lightboxImg = document.querySelector("[data-lightbox-img]");
  const lightboxCap = document.querySelector("[data-lightbox-cap]");
  const lightboxClose = document.querySelector("[data-lightbox-close]");

  document.querySelectorAll("[data-zoom-src]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!lightbox || !lightboxImg) return;
      lightboxImg.src = btn.dataset.zoomSrc || "";
      lightboxImg.alt = btn.dataset.zoomCaption || "";
      if (lightboxCap) lightboxCap.textContent = btn.dataset.zoomCaption || "";
      lightbox.showModal();
    });
  });

  lightboxClose?.addEventListener("click", () => lightbox?.close());
  lightbox?.addEventListener("click", (e) => {
    if (e.target === lightbox) lightbox.close();
  });

  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (lightbox?.open) return;
    if (shelf?.classList.contains("is-open")) {
      event.preventDefault();
      closeShelf();
    } else {
      event.preventDefault();
      openShelf(document.activeElement);
    }
  });

  syncPlateHeights();
  updateOnScroll();
})();
