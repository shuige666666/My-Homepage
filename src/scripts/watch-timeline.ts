/** 管理月份选择、回忆叠卡交接，以及本月作品的展开阅读。 */
function setupWatchTimeline() {
  const root = document.querySelector<HTMLElement>(".watch-timeline");
  if (!root?.dataset.initialMonth) return;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  const picker = root.querySelector<HTMLDetailsElement>(".timeline-range-picker")!;
  const rangeLabel = root.querySelector<HTMLElement>("[data-timeline-range-label]")!;
  const rangeButtons = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-timeline-range]"));
  const panels = Array.from(root.querySelectorAll<HTMLElement>("[data-timeline-panel]"));
  const monthButtons = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-timeline-month]"));
  const scenes = Array.from(root.querySelectorAll<HTMLElement>("[data-memory-month]"));
  const sceneByMonth = new Map(scenes.map((scene) => [scene.dataset.memoryMonth!, scene]));
  const recordMonths = Array.from(root.querySelectorAll<HTMLElement>("[data-record-month]"));
  const records = root.querySelector<HTMLElement>(".memory-records")!;
  const toggles = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-memory-toggle]"));
  const status = root.querySelector<HTMLElement>("[data-memory-status]")!;
  const previewStage = root.closest(".pv-memories") ? root.querySelector<HTMLElement>(".memory-stage") : null;
  // 预览的列表移到照片舞台内，同一个月度列表仍供原主页使用。
  previewStage?.append(records);
  const ease = "cubic-bezier(0.22, 1, 0.36, 1)";
  let activeMonth = root.dataset.initialMonth;
  let expanded = false;
  let hoverTimer = 0;
  let transitionId = 0;
  let memoryAnimations: Animation[] = [];
  let recordsAnimation: Animation | undefined;
  let hasEntered = false;

  /** 停止等待中的悬停切月，让点击和键盘即时接管。 */
  const cancelHover = () => {
    window.clearTimeout(hoverTimer);
    hoverTimer = 0;
  };

  /** 读取当前呈现姿态，连续切换时从屏幕上的位置接续动画。 */
  const readPose = (element: Element) => {
    const style = getComputedStyle(element);
    return { transform: style.transform, opacity: style.opacity };
  };

  /** 动画结束后只保留当前月份，退场纸页不参与焦点和无障碍阅读。 */
  const settleScenes = () => {
    scenes.forEach((scene) => {
      const current = scene.dataset.memoryMonth === activeMonth;
      scene.hidden = !current;
      scene.inert = !current;
      scene.style.removeProperty("z-index");
      scene.setAttribute("aria-hidden", String(!current));
    });
    memoryAnimations.forEach((animation) => animation.cancel());
    memoryAnimations = [];
  };

  /** 同步折线上的选中位置，月份切换只移动标记，不重画数据曲线。 */
  const updateSelection = () => {
    monthButtons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.timelineMonth === activeMonth)));
    root.querySelectorAll<SVGCircleElement>("[data-point-month]").forEach((point) => {
      point.classList.toggle("is-highlighted", point.dataset.pointMonth === activeMonth);
    });
    root.querySelectorAll<HTMLElement>("[data-label-month]").forEach((label) => {
      label.classList.toggle("is-selected", label.dataset.labelMonth === activeMonth);
    });
    panels.forEach((panel) => {
      const button = Array.from(panel.querySelectorAll<HTMLButtonElement>("[data-timeline-month]"))
        .find((item) => item.dataset.timelineMonth === activeMonth);
      const marker = panel.querySelector<SVGGElement>("[data-timeline-marker]")!;
      const guide = panel.querySelector<SVGLineElement>("[data-timeline-guide]")!;
      marker.style.opacity = guide.style.opacity = button ? "1" : "0";
      if (!button) return;
      marker.style.transform = `translate(${button.dataset.pointX}px, ${button.dataset.pointY}px)`;
      guide.style.transform = `translateX(${button.dataset.pointX}px)`;
    });
  };

  /** 预览在舞台右侧打开记录，原主页仍使用随内容展开的列表。 */
  const updateRecords = (animate = true) => {
    const wasVisible = !records.hidden;
    const previousHeight = !previewStage && wasVisible ? records.getBoundingClientRect().height : 0;
    recordsAnimation?.cancel();
    recordsAnimation = undefined;
    recordMonths.forEach((month) => { month.hidden = month.dataset.recordMonth !== activeMonth; });
    toggles.forEach((button) => {
      button.setAttribute("aria-expanded", String(expanded));
      button.querySelector("[data-memory-toggle-label]")!.textContent = button.disabled ? "暂无观看记录" : expanded ? "收起本月记录" : "展开本月记录";
    });
    records.inert = !expanded;
    const finish = () => {
      records.hidden = !expanded;
      previewStage?.classList.toggle("has-records", expanded);
    };
    if (reducedMotion.matches || !animate || (!expanded && !wasVisible)) {
      finish();
      return;
    }
    records.hidden = false;
    if (expanded) previewStage?.classList.add("has-records");
    const frames = previewStage ? [
      { opacity: wasVisible ? (expanded ? .65 : 1) : 0, translate: expanded ? "0 6px" : "0 0" },
      { opacity: expanded ? 1 : 0, translate: expanded ? "0 0" : "0 6px" },
    ] : [
      { height: `${previousHeight}px`, opacity: previousHeight ? 1 : 0 },
      { height: `${expanded ? records.getBoundingClientRect().height : 0}px`, opacity: expanded ? 1 : 0 },
    ];
    const animation = records.animate(frames, { duration: previewStage ? 220 : 320, easing: ease, fill: "both" });
    recordsAnimation = animation;
    animation.finished.then(() => {
      if (recordsAnimation === animation) {
        finish();
        recordsAnimation = undefined;
        animation.cancel();
      }
    }).catch(() => {});
  };

  /** 按时间方向收拢旧照片、展开新照片；快速经过月份时不积压动画。 */
  const selectMonth = (month: string, announce = false, animate = true) => {
    cancelHover();
    const next = sceneByMonth.get(month);
    if (!next) return;
    if (month === activeMonth) {
      if (announce) status.textContent = `${next.dataset.monthTitle}，记录 ${next.dataset.monthCount} 部动画`;
      return;
    }

    // 1. 优先保留当前更清晰的一页，避免快速反向选择时从透明状态闪回。
    const visible = scenes.filter((scene) => !scene.hidden);
    const poses = new Map<Element, ReturnType<typeof readPose>>();
    visible.forEach((scene) => scene.querySelectorAll(".memory-art, [data-memory-deck], [data-memory-photo], [data-memory-copy]")
      .forEach((element) => poses.set(element, readPose(element))));
    const deckOpacity = (scene: Element) => Number(poses.get(scene.querySelector("[data-memory-deck]")!)?.opacity ?? 0)
      * Number(poses.get(scene.querySelector(".memory-art")!)?.opacity ?? 1);
    const previous = visible.reduce((best, scene) => deckOpacity(scene) > deckOpacity(best) ? scene : best, visible[0]);
    const direction = month > activeMonth ? 1 : -1;
    const id = ++transitionId;
    memoryAnimations.forEach((animation) => animation.cancel());
    memoryAnimations = [];
    activeMonth = month;
    if (next.dataset.monthCount === "0") expanded = false;
    updateSelection();
    updateRecords(animate);
    if (announce) status.textContent = `${next.dataset.monthTitle}，记录 ${next.dataset.monthCount} 部动画`;

    if (reducedMotion.matches || !animate) {
      settleScenes();
      return;
    }

    scenes.forEach((scene) => {
      scene.hidden = scene !== next && scene !== previous;
      scene.inert = scene !== next;
      // 退场页整体压在入场页之上，避免新页的装饰圆环在旧照片淡出时遮到前面。
      scene.style.zIndex = scene === next ? "2" : scene === previous && previous !== next ? "3" : "";
      scene.setAttribute("aria-hidden", String(scene !== next));
    });

    /** 收集本轮动画，以便下一次选择或减少动态效果设置能立即接管。 */
    const play = (element: Element, frames: Keyframe[], duration: number, delay = 0) => {
      memoryAnimations.push(element.animate(frames, { duration, delay, easing: ease, fill: "both" }));
    };

    // 2. 旧页的照片先向中央收拢，文字同时退出，纸夹保持在固定位置。
    if (previous && previous !== next) {
      const art = previous.querySelector<HTMLElement>(".memory-art")!;
      const deck = previous.querySelector<HTMLElement>("[data-memory-deck]")!;
      const copy = previous.querySelector<HTMLElement>("[data-memory-copy]")!;
      // 装饰圆环属于 .memory-art，不随叠卡淡出的话会在照片透明时独自留在前面。
      if (!previewStage) play(art, [{ opacity: poses.get(art)?.opacity ?? 1 }, { opacity: 0 }], 200);
      play(deck, [poses.get(deck)!, { transform: `translate(${-direction * 16}px, 7px) scale(.97)`, opacity: 0 }], 200);
      previous.querySelectorAll<HTMLElement>("[data-memory-photo]").forEach((photo) => {
        play(photo, [poses.get(photo)!, { transform: `translate(-50%, -50%) translate(0, 8px) rotate(${-direction * 3}deg) scale(.95)` }], 210);
      });
      play(copy, [poses.get(copy)!, { transform: `translate(${-direction * 7}px, -3px)`, opacity: 0 }], 150);
    }

    // 3. 新页从时间前进的一侧落位，再以轻微错峰展开真实封面。
    const art = next.querySelector<HTMLElement>(".memory-art")!;
    const deck = next.querySelector<HTMLElement>("[data-memory-deck]")!;
    const copy = next.querySelector<HTMLElement>("[data-memory-copy]")!;
    if (!previewStage) play(art, [{ opacity: poses.get(art)?.opacity ?? 0 }, { opacity: 1 }], 360, 65);
    play(deck, [poses.get(deck) ?? { transform: `translate(${direction * 20}px, 9px)`, opacity: 0 }, { transform: "none", opacity: 1 }], 360, 65);
    next.querySelectorAll<HTMLElement>("[data-memory-photo]").forEach((photo, index) => {
      const destination = readPose(photo);
      play(photo, [poses.get(photo) ?? { transform: `translate(-50%, -50%) translate(${direction * 9}px, 12px) rotate(${direction * 4}deg) scale(.94)`, opacity: 1 }, destination], 410, 65 + index * 32);
    });
    play(copy, [poses.get(copy) ?? { transform: `translate(${direction * 8}px, 5px)`, opacity: 0 }, { transform: "none", opacity: 1 }], 300, 90);
    Promise.allSettled(memoryAnimations.map((animation) => animation.finished)).then(() => {
      if (id === transitionId) settleScenes();
    });
  };

  /** 只滚动图表容器，让当前选择进入视野，不改变整页阅读位置。 */
  const scrollToSelection = (panel: HTMLElement) => {
    const chart = panel.querySelector<HTMLElement>(".timeline-chart-wrap")!;
    const canvas = panel.querySelector<HTMLElement>(".timeline-chart-canvas")!;
    const selected = Array.from(panel.querySelectorAll<HTMLButtonElement>("[data-timeline-month]"))
      .find((button) => button.dataset.timelineMonth === activeMonth);
    const x = selected ? Number(selected.dataset.pointX) * canvas.clientWidth / Number(canvas.dataset.chartWidth) : chart.scrollWidth;
    chart.scrollLeft = x - chart.clientWidth * 0.7;
  };

  /** 从图表当前可见的左侧开始描线，底色稍后跟上。 */
  const drawChart = (panel: HTMLElement, delay = 0) => {
    if (reducedMotion.matches) return [];
    const chart = panel.querySelector<HTMLElement>(".timeline-chart-wrap")!;
    const line = panel.querySelector<SVGPolylineElement>("polyline")!;
    const area = panel.querySelector<SVGPolygonElement>("polygon")!;
    const start = 100 * (1 - chart.scrollLeft / chart.scrollWidth);
    return [
      line.animate([{ clipPath: `inset(0 ${start}% 0 0)` }, { clipPath: "inset(0 0% 0 0)" }], {
        duration: 900, delay, fill: "backwards", easing: "cubic-bezier(0.4, 0, 0.2, 1)",
      }),
      area.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 700, delay: delay + 240, fill: "backwards" }),
    ];
  };

  /** 预览按区块入场，照片从叠放展开，月份和图表随后落位。 */
  const setupPreviewEntrance = (stage: HTMLElement) => {
    const heading = root.querySelector<HTMLElement>(".timeline-topline")!;
    const memoryRegion = root.querySelector<HTMLElement>(".timeline-memory")!;
    const chartRegion = root.querySelector<HTMLElement>(".timeline-panels")!;
    const entranceEase = "cubic-bezier(.24, .68, .24, 1)";
    const playing = new Map<Element, Animation[]>();

    /** 用独立位移属性留出月份切换所用的 transform。 */
    const lift = (element: Element, distance: number, duration: number, delay = 0) => element.animate([
      { opacity: 0, translate: `0 ${distance}px` }, { opacity: 1, translate: "0 0" },
    ], { duration, delay, easing: entranceEase, fill: "backwards" });

    /** 同一月的照片从接近中央的姿态错峰扇开，圆形底板随舞台一起升起。 */
    const showMonth = () => {
      const scene = sceneByMonth.get(activeMonth!)!;
      const photos = Array.from(scene.querySelectorAll<HTMLElement>("[data-memory-photo]"));
      const copy = scene.querySelector<HTMLElement>("[data-memory-copy]")!;
      return [
        lift(stage, 32, 660, 70),
        lift(copy, 22, 640, 170),
        ...photos.map((photo, index) => photo.animate([
          { translate: "calc(-.75 * var(--card-x)) 28px", rotate: "calc(-.8 * var(--card-angle))" },
          { translate: "0 0", rotate: "0deg" },
        ], { duration: 730, delay: 85 + index * 55, easing: entranceEase, fill: "backwards" })),
      ];
    };

    /** 图表先有刻度，再描出折线，最后点亮当前月份的标记。 */
    const showChart = () => {
      const panel = panels.find((item) => !item.hidden)!;
      const marks = panel.querySelectorAll(".timeline-guide, .timeline-point, .timeline-marker");
      return [
        lift(panel, 16, 460),
        ...drawChart(panel, 100),
        ...Array.from(marks, (mark) => mark.animate([{ opacity: 0 }, {}], {
          duration: 300, delay: mark.classList.contains("timeline-point") ? 475 : 690, fill: "backwards",
        })),
      ];
    };

    // 观察未做位移的外层，避免入场的位移反复跨过视口边缘。
    const entrances = new Map<Element, () => Animation[]>([
      [heading, () => Array.from(heading.children, (element) => lift(element, 18, 460))],
      [memoryRegion, showMonth],
      [chartRegion, showChart],
    ]);
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(({ target, isIntersecting, boundingClientRect, rootBounds }) => {
        // 退回上一屏时允许重新入场；继续向下阅读页脚时保持时间轴静止。
        if (!isIntersecting && boundingClientRect.top >= (rootBounds?.bottom ?? window.innerHeight)) {
          playing.get(target)?.forEach((animation) => animation.cancel());
          playing.delete(target);
        }
        if (!isIntersecting || playing.has(target)) return;
        if (target === chartRegion) hasEntered = true;
        playing.set(target, reducedMotion.matches ? [] : entrances.get(target)!());
      });
    });
    entrances.forEach((_, element) => observer.observe(element));
  };

  // 精细指针短暂停留才切换，触摸与键盘直接选择，离开后保留最后一页。
  monthButtons.forEach((button) => {
    const month = button.dataset.timelineMonth!;
    // 预览折线滑到静止光标下时不切月，等用户移动指针再响应。
    button.addEventListener(previewStage ? "pointermove" : "pointerenter", (event) => {
      if (!finePointer.matches || event.pointerType === "touch" || month === activeMonth || hoverTimer) return;
      hoverTimer = window.setTimeout(() => selectMonth(month), 100);
    });
    button.addEventListener("pointerleave", cancelHover);
    button.addEventListener("click", () => selectMonth(month, true));
    button.addEventListener("focus", () => {
      if (button.matches(":focus-visible")) selectMonth(month, true);
    });
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const siblings = Array.from(button.parentElement!.querySelectorAll<HTMLButtonElement>("[data-timeline-month]"));
      const index = siblings.indexOf(button);
      const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? siblings.length - 1 : Math.max(0, Math.min(siblings.length - 1, index + (event.key === "ArrowRight" ? 1 : -1)));
      siblings[nextIndex].focus({ preventScroll: true });
      selectMonth(siblings[nextIndex].dataset.timelineMonth!, true);
      scrollToSelection(button.closest<HTMLElement>("[data-timeline-panel]")!);
    });
  });

  toggles.forEach((button) => button.addEventListener("click", () => {
    expanded = !expanded;
    updateRecords();
  }));

  rangeButtons.forEach((button) => button.addEventListener("click", () => {
    const value = button.dataset.timelineRange!;
    picker.open = false;
    // 选项收起后将焦点还给范围入口，避免键盘焦点停在隐藏按钮中。
    picker.querySelector("summary")!.focus({ preventScroll: true });
    if (button.getAttribute("aria-pressed") === "true") return;
    cancelHover();
    panels.forEach((panel) => {
      panel.getAnimations({ subtree: true }).forEach((animation) => animation.cancel());
      panel.hidden = panel.dataset.timelinePanel !== value;
    });
    rangeButtons.forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
    rangeLabel.textContent = button.textContent!.trim();
    const panel = panels.find((item) => !item.hidden)!;
    const availableMonths = Array.from(panel.querySelectorAll<HTMLButtonElement>("[data-timeline-month]"));
    if (!availableMonths.some((item) => item.dataset.timelineMonth === activeMonth)) {
      const fallback = [...availableMonths].reverse().find((item) => sceneByMonth.get(item.dataset.timelineMonth!)!.dataset.monthCount !== "0") ?? availableMonths[availableMonths.length - 1];
      selectMonth(fallback.dataset.timelineMonth!, true);
    }
    requestAnimationFrame(() => { scrollToSelection(panel); if (hasEntered) drawChart(panel); });
  }));

  if (previewStage) setupPreviewEntrance(previewStage);
  else {
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      hasEntered = true;
      const panel = panels.find((item) => !item.hidden);
      if (panel) drawChart(panel);
      observer.disconnect();
    }, { threshold: 0.25 });
    observer.observe(root);
  }

  reducedMotion.addEventListener("change", () => {
    if (!reducedMotion.matches) return;
    ++transitionId;
    root.getAnimations({ subtree: true }).forEach((animation) => animation.cancel());
    settleScenes();
    updateRecords(false);
  });

  settleScenes();
  updateSelection();
  updateRecords(false);
  requestAnimationFrame(() => scrollToSelection(panels.find((panel) => !panel.hidden)!));
}

setupWatchTimeline();
