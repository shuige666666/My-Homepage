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
  const ease = "cubic-bezier(0.22, 1, 0.36, 1)";
  let activeMonth = root.dataset.initialMonth;
  let expanded = false;
  let hoverTimer = 0;
  let transitionId = 0;
  let memoryAnimations: Animation[] = [];
  let recordsAnimation: Animation | undefined;
  let hasEntered = false;

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

  /** 展开状态下切换月份时平滑接续列表高度，收起后移出键盘顺序。 */
  const updateRecords = (animate = true) => {
    const previousHeight = records.hidden ? 0 : records.getBoundingClientRect().height;
    recordsAnimation?.cancel();
    recordMonths.forEach((month) => { month.hidden = month.dataset.recordMonth !== activeMonth; });
    toggles.forEach((button) => {
      button.setAttribute("aria-expanded", String(expanded));
      button.querySelector("[data-memory-toggle-label]")!.textContent = button.disabled ? "暂无观看记录" : expanded ? "收起本月记录" : "展开本月记录";
    });
    records.inert = !expanded;
    if (reducedMotion.matches || !animate) {
      records.hidden = !expanded;
      return;
    }
    records.hidden = false;
    const nextHeight = expanded ? records.scrollHeight : 0;
    if (!previousHeight && !nextHeight) {
      records.hidden = true;
      return;
    }
    const animation = records.animate(
      [{ height: `${previousHeight}px`, opacity: previousHeight ? 1 : 0 }, { height: `${nextHeight}px`, opacity: expanded ? 1 : 0 }],
      { duration: 320, easing: ease },
    );
    recordsAnimation = animation;
    animation.finished.then(() => {
      if (recordsAnimation === animation) {
        records.hidden = !expanded;
        recordsAnimation = undefined;
      }
    }).catch(() => {});
  };

  /** 按时间方向收拢旧照片、展开新照片；快速经过月份时不积压动画。 */
  const selectMonth = (month: string, announce = false, animate = true) => {
    window.clearTimeout(hoverTimer);
    const next = sceneByMonth.get(month);
    if (!next) return;
    if (month === activeMonth) {
      if (announce) status.textContent = `${next.dataset.monthTitle}，记录 ${next.dataset.monthCount} 部动画`;
      return;
    }

    // 1. 优先保留当前更清晰的一页，避免快速反向选择时从透明状态闪回。
    const visible = scenes.filter((scene) => !scene.hidden);
    const previous = visible.reduce((best, scene) => Number(readPose(scene.querySelector("[data-memory-deck]")!).opacity) > Number(readPose(best.querySelector("[data-memory-deck]")!).opacity) ? scene : best, visible[0]);
    const poses = new Map<Element, ReturnType<typeof readPose>>();
    visible.forEach((scene) => scene.querySelectorAll("[data-memory-deck], [data-memory-photo], [data-memory-copy]")
      .forEach((element) => poses.set(element, readPose(element))));
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
      scene.setAttribute("aria-hidden", String(scene !== next));
    });

    /** 收集本轮动画，以便下一次选择或减少动态效果设置能立即接管。 */
    const play = (element: Element, frames: Keyframe[], duration: number, delay = 0) => {
      memoryAnimations.push(element.animate(frames, { duration, delay, easing: ease, fill: "both" }));
    };

    // 2. 旧页的照片先向中央收拢，文字同时退出，纸夹保持在固定位置。
    if (previous && previous !== next) {
      const deck = previous.querySelector<HTMLElement>("[data-memory-deck]")!;
      const copy = previous.querySelector<HTMLElement>("[data-memory-copy]")!;
      play(deck, [poses.get(deck)!, { transform: `translate(${-direction * 16}px, 7px) scale(.97)`, opacity: 0 }], 200);
      previous.querySelectorAll<HTMLElement>("[data-memory-photo]").forEach((photo) => {
        play(photo, [poses.get(photo)!, { transform: `translate(-50%, -50%) translate(0, 8px) rotate(${-direction * 3}deg) scale(.95)` }], 210);
      });
      play(copy, [poses.get(copy)!, { transform: `translate(${-direction * 7}px, -3px)`, opacity: 0 }], 150);
    }

    // 3. 新页从时间前进的一侧落位，再以轻微错峰展开真实封面。
    const deck = next.querySelector<HTMLElement>("[data-memory-deck]")!;
    const copy = next.querySelector<HTMLElement>("[data-memory-copy]")!;
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

  /** 保留原先的首次描线，并仅在范围改变后重新播放当前可见段。 */
  const drawChart = (panel: HTMLElement) => {
    if (reducedMotion.matches) return;
    const chart = panel.querySelector<HTMLElement>(".timeline-chart-wrap")!;
    const line = panel.querySelector<SVGPolylineElement>("polyline")!;
    const area = panel.querySelector<SVGPolygonElement>("polygon")!;
    const start = 100 * (1 - chart.scrollLeft / chart.scrollWidth);
    line.animate([{ clipPath: `inset(0 ${start}% 0 0)` }, { clipPath: "inset(0 0% 0 0)" }], { duration: 900, easing: "cubic-bezier(0.4, 0, 0.2, 1)" });
    area.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 700, delay: 240, fill: "backwards" });
  };

  // 精细指针短暂停留才切换，触摸与键盘直接选择，离开后保留最后一页。
  monthButtons.forEach((button) => {
    const month = button.dataset.timelineMonth!;
    button.addEventListener("pointerenter", (event) => {
      if (!finePointer.matches || event.pointerType === "touch") return;
      window.clearTimeout(hoverTimer);
      hoverTimer = window.setTimeout(() => selectMonth(month), 100);
    });
    button.addEventListener("pointerleave", () => window.clearTimeout(hoverTimer));
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
    window.clearTimeout(hoverTimer);
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

  const observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    hasEntered = true;
    const panel = panels.find((item) => !item.hidden);
    if (panel) drawChart(panel);
    observer.disconnect();
  }, { threshold: 0.25 });
  observer.observe(root);

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
