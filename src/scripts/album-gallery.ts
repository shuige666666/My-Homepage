/** 初始化收藏光碟画廊，并把所有交互限制在打开的对话框内。 */
export function setupAlbumGallery() {
  const dialog = document.querySelector<HTMLDialogElement>("[data-album-gallery]");
  if (!dialog) return;

  const stage = dialog.querySelector<HTMLElement>("[data-album-stage]");
  const discs = Array.from(dialog.querySelectorAll<HTMLButtonElement>("[data-album-disc]"));
  const discImages = discs.map((disc) => disc.querySelector<HTMLImageElement>("img"));
  const openers = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-album-open]"));
  const closeButton = dialog.querySelector<HTMLButtonElement>("[data-album-close]");
  const previous = dialog.querySelector<HTMLButtonElement>("[data-album-prev]");
  const next = dialog.querySelector<HTMLButtonElement>("[data-album-next]");
  const pages = Array.from(dialog.querySelectorAll<HTMLButtonElement>("[data-album-page]"));
  const number = dialog.querySelector<HTMLElement>("[data-album-number]");
  const title = dialog.querySelector<HTMLElement>("[data-album-title]");
  const nativeTitle = dialog.querySelector<HTMLElement>("[data-album-native]");
  const score = dialog.querySelector<HTMLElement>("[data-album-score]");
  const note = dialog.querySelector<HTMLElement>("[data-album-note]");
  if (!stage || discs.length === 0) return;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let position = 0;
  let destination = 0;
  let shownIndex = -1;
  let flippedIndex = -1;
  let animationFrame = 0;
  let animationGeneration = 0;
  let opener: HTMLButtonElement | null = null;
  let previousBodyOverflow = "";
  let lastWheelAt = 0;
  let suppressClickUntil = 0;
  let pointerStart: { id: number; x: number; y: number; position: number } | null = null;
  let didDrag = false;

  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

  /** 同步编号、标题与导航状态，盘面滑过中途时文字跟随当前光碟。 */
  function showMetadata(index: number) {
    if (shownIndex === index) return;
    shownIndex = index;
    const disc = discs[index];
    if (number) number.textContent = String(index + 1).padStart(2, "0");
    if (title) title.textContent = disc.dataset.title || "";
    if (nativeTitle) nativeTitle.textContent = disc.dataset.native || "";
    if (score) score.textContent = disc.dataset.score || "";
    if (note) note.textContent = disc.dataset.note || disc.dataset.native || "";
    pages.forEach((page, pageIndex) => {
      if (pageIndex === index) page.setAttribute("aria-current", "true");
      else page.removeAttribute("aria-current");
    });
    discs.forEach((item, discIndex) => {
      item.classList.toggle("is-active", discIndex === index);
      item.tabIndex = discIndex === index ? 0 : -1;
      if (discIndex !== index) {
        item.style.setProperty("--tilt-x", "0deg");
        item.style.setProperty("--tilt-y", "0deg");
      }
    });
  }

  /** 每张盘沿同一条左下至右上的弧线移动，倾角随轨迹同步变化。 */
  function render() {
    const discWidth = discs[0].offsetWidth || 600;
    const current = clamp(Math.round(position), 0, discs.length - 1);
    showMetadata(current);
    discs.forEach((disc, index) => {
      const offset = index - position;
      const behind = Math.max(-offset, 0);
      const ahead = Math.max(offset, 0);
      const x = offset < 0
        ? -(discWidth * .92 * behind) / (1 + behind * .15)
        : discWidth * (.98 * ahead + .03 * ahead * ahead + .5 * Math.max(ahead - 1, 0) ** 2);
      const y = offset < 0
        ? discWidth * .3 * (1 - Math.exp(-1.1 * behind))
        : -discWidth * (.28 * ahead + .04 * ahead * ahead);
      const scale = offset < 0
        ? .42 + .58 * Math.exp(-.43 * behind)
        : Math.min(1.28, 1 + .16 * ahead);
      disc.style.setProperty("--album-x", `${x}px`);
      disc.style.setProperty("--album-y", `${y}px`);
      disc.style.setProperty("--album-z", `${clamp(24 + offset * 14, -8, 41)}deg`);
      disc.style.setProperty("--album-y-rotation", `${clamp(-34 - offset * 12, -49, -7)}deg`);
      disc.style.setProperty("--album-skew", `${clamp(-16 - offset * 6, -24, -2)}deg`);
      disc.style.setProperty("--album-scale", String(scale));
      disc.style.setProperty("--album-flip", index === flippedIndex ? "180deg" : "0deg");
      // 左侧光碟保持不透明，借由弧线、尺寸与遮挡表达距离。
      disc.style.opacity = "1";
      disc.style.zIndex = String(100 + Math.round(offset * 10));
      disc.style.pointerEvents = offset < -2.75 || offset > 1.4 ? "none" : "auto";
    });
    if (previous) previous.disabled = destination <= 0;
    if (next) next.disabled = destination >= discs.length - 1;
  }

  /** 在当前位置重新起步，连续点击导航时不会先跳回上一段起点。 */
  function navigate(index: number) {
    const target = clamp(index, 0, discs.length - 1);
    destination = target;
    flippedIndex = -1;
    animationGeneration += 1;
    cancelAnimationFrame(animationFrame);
    if (reduceMotion.matches) {
      position = target;
      render();
      return;
    }
    const generation = animationGeneration;
    const origin = position;
    const distance = Math.abs(target - origin);
    const duration = 680 + Math.min(distance, 8) * 132;
    const startedAt = performance.now();
    /** 采用平滑减速，经过每张光碟时仍保持可辨认的运动方向。 */
    function frame(now: number) {
      if (generation !== animationGeneration || !dialog?.open) return;
      const progress = clamp((now - startedAt) / duration, 0, 1);
      const eased = 1 - Math.pow(1 - progress, 3.2);
      position = origin + (target - origin) * eased;
      render();
      if (progress < 1) animationFrame = requestAnimationFrame(frame);
      else { position = target; render(); }
    }
    animationFrame = requestAnimationFrame(frame);
  }

  /** 打开时始终从第一张盘出发，再滑到所选作品。 */
  function openGallery(index: number, source: HTMLButtonElement) {
    opener = source;
    position = 0;
    destination = 0;
    shownIndex = -1;
    flippedIndex = -1;
    lastWheelAt = 0;
    dialog?.showModal();
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    render();
    stage?.focus({ preventScroll: true });
    discImages.forEach((image) => { if (image) image.loading = "eager"; });
    if (index !== 0) {
      // 快速跨越多张盘时先解码途经封面，避免动画露出空白盘面。
      const opening = ++animationGeneration;
      const passedImages = discImages.slice(0, Math.min(index + 2, discImages.length));
      Promise.all(passedImages.map((image) => image?.decode().catch(() => undefined))).then(() => {
        if (dialog?.open && opening === animationGeneration) navigate(index);
      });
    }
  }

  openers.forEach((button, index) => button.addEventListener("click", () => openGallery(index, button)));
  const rail = document.querySelector<HTMLElement>("[data-favorite-rail]");
  if (rail && "IntersectionObserver" in window) {
    /** 收藏区将进入视口时开始预载十张盘面，降低点开后的等待。 */
    const preloadObserver = new IntersectionObserver((items) => {
      if (!items.some((item) => item.isIntersecting)) return;
      discImages.forEach((image) => { if (image) image.loading = "eager"; });
      preloadObserver.disconnect();
    }, { rootMargin: "600px" });
    preloadObserver.observe(rail);
  }
  closeButton?.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    animationGeneration += 1;
    cancelAnimationFrame(animationFrame);
    document.body.style.overflow = previousBodyOverflow;
    pointerStart = null;
    stage.classList.remove("is-dragging");
    opener?.focus({ preventScroll: true });
  });
  previous?.addEventListener("click", () => navigate(destination - 1));
  next?.addEventListener("click", () => navigate(destination + 1));
  pages.forEach((button, index) => button.addEventListener("click", () => navigate(index)));

  dialog.addEventListener("wheel", (event) => {
    event.preventDefault();
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (Math.abs(delta) < 5 || performance.now() - lastWheelAt < 520) return;
    lastWheelAt = performance.now();
    navigate(destination + Math.sign(delta));
  }, { passive: false });

  dialog.addEventListener("keydown", (event) => {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      navigate(destination + (event.key === "ArrowRight" ? 1 : -1));
    } else if (event.key === " " || event.code === "Space") {
      event.preventDefault();
      const current = clamp(Math.round(position), 0, discs.length - 1);
      flippedIndex = flippedIndex === current ? -1 : current;
      render();
    } else if (event.key === "Enter" && event.target === stage) {
      event.preventDefault();
      window.open(discs[destination].dataset.url, "_blank", "noopener,noreferrer");
    }
  });

  /** 悬停哪张盘就让哪张盘随指针轻摆，手绘圈与盘面运动保持一致。 */
  stage.addEventListener("pointermove", (event) => {
    if (pointerStart || reduceMotion.matches) return;
    const hovered = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-album-disc]") : null;
    discs.forEach((disc) => {
      if (disc !== hovered) {
        disc.style.setProperty("--tilt-x", "0deg");
        disc.style.setProperty("--tilt-y", "0deg");
      }
    });
    if (!hovered) return;
    const rect = hovered.getBoundingClientRect();
    const x = clamp((event.clientX - (rect.left + rect.width / 2)) / (rect.width / 2), -1, 1);
    const y = clamp((event.clientY - (rect.top + rect.height / 2)) / (rect.height / 2), -1, 1);
    hovered.style.setProperty("--tilt-x", `${-y * 5}deg`);
    hovered.style.setProperty("--tilt-y", `${x * 7}deg`);
  });
  stage.addEventListener("pointerleave", () => {
    discs.forEach((disc) => {
      disc.style.setProperty("--tilt-x", "0deg");
      disc.style.setProperty("--tilt-y", "0deg");
    });
  });

  /** 拖动改变连续位置，松手后吸附最近的光碟。 */
  stage.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    pointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY, position };
    didDrag = false;
  });
  window.addEventListener("pointermove", (event) => {
    if (!dialog.open || !pointerStart || event.pointerId !== pointerStart.id) return;
    const movement = event.clientX - pointerStart.x;
    if (Math.abs(movement) < 7 && !didDrag) return;
    didDrag = true;
    stage.classList.add("is-dragging");
    discs.forEach((disc) => {
      disc.style.setProperty("--tilt-x", "0deg");
      disc.style.setProperty("--tilt-y", "0deg");
    });
    animationGeneration += 1;
    cancelAnimationFrame(animationFrame);
    position = clamp(pointerStart.position - movement / ((discs[0].offsetWidth || 600) * .78), 0, discs.length - 1);
    destination = Math.round(position);
    render();
  });
  window.addEventListener("pointerup", (event) => {
    if (!pointerStart || event.pointerId !== pointerStart.id) return;
    pointerStart = null;
    stage.classList.remove("is-dragging");
    if (didDrag) {
      suppressClickUntil = performance.now() + 350;
      navigate(Math.round(position));
      stage.focus({ preventScroll: true });
    }
  });
  window.addEventListener("pointercancel", () => {
    if (!pointerStart) return;
    pointerStart = null;
    stage.classList.remove("is-dragging");
    navigate(Math.round(position));
  });

  /** 相邻盘先选中，当前盘才打开外部链接；拖动产生的 click 不触发导航。 */
  stage.addEventListener("click", (event) => {
    if (performance.now() < suppressClickUntil) { event.preventDefault(); return; }
    const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-album-disc]") : null;
    if (!target) return;
    const index = Number(target.dataset.albumDisc);
    if (index !== Math.round(position) || Math.abs(position - index) > .12) navigate(index);
    else window.open(target.dataset.url, "_blank", "noopener,noreferrer");
  });
  window.addEventListener("resize", () => { if (dialog.open) render(); });
}
