import type { AlbumDiscLayout, AlbumDiscRenderer, AlbumDiscViewport } from "./album-disc-renderer";

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
  let travelVelocity = 0;
  let lastMotionAt = 0;
  let draggedPosition = 0;
  const poses = discs.map(() => ({ x: 0, y: 0, vx: 0, vy: 0, targetX: 0, targetY: 0 }));
  const flips = discs.map(() => ({ angle: 0, velocity: 0 }));
  let discRenderer: AlbumDiscRenderer | null = null;
  let physicalLoading: Promise<void> | null = null;
  let physicalFailed = false;
  let opener: HTMLButtonElement | null = null;
  let previousBodyOverflow = "";
  let lastWheelAt = 0;
  let suppressClickUntil = 0;
  let pointerStart: { id: number; x: number; y: number; position: number; discIndex: number | null; yaw: number; pitch: number; lastX: number; lastAt: number; velocity: number } | null = null;
  let didDrag = false;
  let stageMetrics: { width: number; height: number; discWidth: number; discLeft: number; discTop: number; left: number; top: number } | null = null;
  let hitLayout: AlbumDiscLayout[] = [];
  let hitViewport: AlbumDiscViewport | null = null;
  let hoveredIndex = -1;

  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

  /** 弹窗打开和视口变化时才读取布局，拖动中的逐帧绘制不再触发同步回流。 */
  function measureStage() {
    const rect = stage!.getBoundingClientRect();
    stageMetrics = {
      width: stage!.clientWidth, height: stage!.clientHeight,
      discWidth: discs[0].offsetWidth || 600,
      discLeft: discs[0].offsetLeft, discTop: discs[0].offsetTop,
      left: rect.left, top: rect.top,
    };
    return stageMetrics;
  }

  /** 中央盘更接近正面，左侧盘随轨迹逐渐转正。 */
  function baseYaw(offset: number) {
    return offset < 0 ? -10 - 22 * Math.exp(offset * 1.8) : -32;
  }

  /** 将指针射线投到当前三维盘面，只有落在可见圆盘内才算按中。 */
  function pointerOnDisc(event: MouseEvent, index: number) {
    const pose = hitLayout[index];
    const viewport = hitViewport;
    const metrics = stageMetrics;
    const miss = { x: 0, y: 0, distance: Infinity, depth: Infinity, inside: false };
    if (!pose?.visible || !viewport || !metrics) return miss;

    const toRadians = Math.PI / 180;
    const xAngle = -pose.pitch * toRadians;
    const yAngle = pose.yaw * toRadians;
    const zAngle = -pose.zAngle * toRadians;
    const flip = pose.flip * toRadians;
    const sx = Math.sin(xAngle), cx = Math.cos(xAngle);
    const sy = Math.sin(yAngle), cy = Math.cos(yAngle);
    const sz = Math.sin(zAngle), cz = Math.cos(zAngle);
    const sf = Math.sin(flip), cf = Math.cos(flip);
    // 与 WebGL 的 ZYX 姿态及盘面翻转保持一致，避免倾斜盘旁的空白被误判为盘面。
    const ux = cz * cy, uy = sz * cy, uz = -sy;
    const vx = cz * sy * sx - sz * cx, vy = sz * sy * sx + cz * cx, vz = cy * sx;
    const nx = cz * sy * cx + sz * sx, ny = sz * sy * cx - cz * sx, nz = cy * cx;
    const axisXx = ux * cf - nx * sf;
    const axisXy = uy * cf - ny * sf;
    const axisXz = uz * cf - nz * sf;
    const normalX = ux * sf + nx * cf;
    const normalY = uy * sf + ny * cf;
    const normalZ = uz * sf + nz * cf;
    const rayX = event.clientX - metrics.left - viewport.width / 2;
    const rayY = viewport.height / 2 - (event.clientY - metrics.top);
    const cameraZ = 1450;
    const centerX = viewport.centerX + pose.x;
    const centerY = viewport.centerY - pose.y;
    const centerZ = pose.offset * 14;
    const denominator = normalX * rayX + normalY * rayY - normalZ * cameraZ;
    if (Math.abs(denominator) < .001) return miss;
    const depth = (normalX * centerX + normalY * centerY + normalZ * (centerZ - cameraZ)) / denominator;
    if (depth <= 0) return miss;
    const dx = depth * rayX - centerX;
    const dy = depth * rayY - centerY;
    const dz = cameraZ * (1 - depth) - centerZ;
    const radius = viewport.radius * pose.scale;
    const x = (dx * axisXx + dy * axisXy + dz * axisXz) / radius;
    const y = (dx * vx + dy * vy + dz * vz) / radius;
    const distance = Math.hypot(x, y);
    return { x: clamp(x, -1, 1), y: clamp(y, -1, 1), distance, depth, inside: distance <= 1 };
  }

  /** 重叠处选择最靠近镜头的可见盘，其余留白交给队列拖动。 */
  function hoveredDisc(event: MouseEvent) {
    let nearest: HTMLButtonElement | null = null;
    let depth = Infinity;
    for (const [index, disc] of discs.entries()) {
      if (!hitLayout[index]?.visible) continue;
      const pointer = pointerOnDisc(event, index);
      if (pointer.inside && pointer.depth < depth) {
        nearest = disc;
        depth = pointer.depth;
      }
    }
    return nearest;
  }

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
    });
  }

  /** 每张盘沿同一条左下至右上的弧线移动，倾角随轨迹同步变化。 */
  function render() {
    const metrics = stageMetrics ?? measureStage();
    const { discWidth, width: stageWidth, height: stageHeight } = metrics;
    const viewport: AlbumDiscViewport = {
      width: stageWidth, height: stageHeight, radius: discWidth / 2,
      centerX: metrics.discLeft - stageWidth / 2,
      centerY: stageHeight / 2 - metrics.discTop,
    };
    const current = clamp(Math.round(position), 0, discs.length - 1);
    const layout: AlbumDiscLayout[] = [];
    dialog?.classList.toggle("is-travelling", Math.abs(destination - position) > .12 || Math.abs(travelVelocity) > .6);
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
      // 左侧盘逐渐朝向观众；中央与右侧盘保留顺着弧线的竖轴透视。
      const approach = Math.exp(-behind * 1.8);
      const yaw = baseYaw(offset);
      const zAngle = offset < 0 ? 5 + 29 * approach : 34;
      const visible = offset >= -2.75 && offset <= 1.4;
      disc.style.visibility = visible ? "visible" : "hidden";
      disc.style.pointerEvents = visible ? "auto" : "none";
      if (visible) {
        disc.style.setProperty("--album-x", `${x}px`);
        disc.style.setProperty("--album-y", `${y}px`);
        disc.style.setProperty("--album-z", `${zAngle}deg`);
        disc.style.setProperty("--album-y-rotation", `${yaw}deg`);
        disc.style.setProperty("--album-scale", String(scale));
        disc.style.setProperty("--album-flip", index === flippedIndex ? "180deg" : "0deg");
        disc.style.setProperty("--tilt-x", `${poses[index].x}deg`);
        disc.style.setProperty("--tilt-y", `${poses[index].y}deg`);
        disc.style.zIndex = String(100 + Math.round(offset * 10));
      }
      layout.push({ x, y, scale, offset, zAngle, yaw: yaw + poses[index].y, pitch: poses[index].x, flip: flips[index].angle, visible });
    });
    hitLayout = layout;
    hitViewport = viewport;
    discRenderer?.draw(layout, viewport);
    if (previous) previous.disabled = destination <= 0;
    if (next) next.disabled = destination >= discs.length - 1;
  }

  /** 首次打开时按需装载物理盘面；加载或 WebGL 失败时原 CSS 盘仍可操作。 */
  function ensurePhysicalDiscs(): Promise<void> {
    if (discRenderer || physicalFailed) return Promise.resolve();
    if (physicalLoading) return physicalLoading;
    physicalLoading = (async () => {
      const [module] = await Promise.all([
        import("./album-disc-renderer"),
        Promise.all(discImages.slice(0, 2).map((image) => image?.decode().catch(() => undefined))),
      ]);
      if (!dialog?.open) return;
      const physical = new module.AlbumDiscRenderer(stage!, discImages);
      try {
        discRenderer = physical;
        physical.settle();
        render();
        dialog.classList.add("has-webgl");
      } catch (error) {
        discRenderer = null;
        physical.dispose();
        throw error;
      }
    })().catch((error) => {
      physicalFailed = true;
      console.warn("光碟物理材质不可用，已保留 CSS 盘面。", error);
    }).finally(() => { physicalLoading = null; });
    return physicalLoading;
  }

  /** 用同一条弹簧跟随拖动位置和导航目标，指针停下后盘面仍会柔和落位。 */
  function startMotion() {
    if (animationFrame || reduceMotion.matches) return;
    discRenderer?.beginMotion();
    // 首帧的 rAF 时间戳可能早于 WebGL 初始化结束时的当前时间，不能拿它减较晚的启动时间。
    lastMotionAt = 0;
    animationFrame = requestAnimationFrame(frame);
  }

  /** 位移与盘面转角分别带阻尼，松手后保留少量惯性而不突然换成另一种缓动。 */
  function frame(now: number) {
    animationFrame = 0;
    if (!dialog?.open) return;
    const elapsed = lastMotionAt === 0 ? 0 : Math.max(0, now - lastMotionAt);
    const dt = Math.min(elapsed / 1000, .04);
    lastMotionAt = now;
    discRenderer?.observeFrameTime(elapsed);
    const dragging = Boolean(pointerStart && didDrag && pointerStart.discIndex === null);
    const target = dragging ? draggedPosition : destination;
    travelVelocity += (target - position) * (dragging ? 140 : 76) * dt;
    travelVelocity *= Math.exp(-(dragging ? 17 : 12) * dt);
    position = clamp(position + travelVelocity * dt, 0, discs.length - 1);
    if ((position === 0 && travelVelocity < 0) || (position === discs.length - 1 && travelVelocity > 0)) travelVelocity = 0;
    let moving = Math.abs(target - position) > .001 || Math.abs(travelVelocity) > .012;

    poses.forEach((pose, index) => {
      const held = pointerStart?.discIndex === index && didDrag;
      const stiffness = held ? 240 : 95;
      const damping = held ? 20 : 14.5;
      pose.vx = (pose.vx + (pose.targetX - pose.x) * stiffness * dt) * Math.exp(-damping * dt);
      pose.vy = (pose.vy + (pose.targetY - pose.y) * stiffness * dt) * Math.exp(-damping * dt);
      pose.x += pose.vx * dt;
      pose.y += pose.vy * dt;
      // 背面确实可见，限制的是整圈旋转量，而不是侧立前的角度。
      const limitedY = clamp(pose.y, -180, 180);
      if (limitedY !== pose.y) { pose.y = limitedY; pose.vy = 0; }
      moving ||= Math.abs(pose.targetX - pose.x) > .02 || Math.abs(pose.targetY - pose.y) > .02 || Math.abs(pose.vx) > .05 || Math.abs(pose.vy) > .05;
    });
    flips.forEach((flip, index) => {
      const targetAngle = index === flippedIndex ? 180 : 0;
      flip.velocity = (flip.velocity + (targetAngle - flip.angle) * 86 * dt) * Math.exp(-14 * dt);
      flip.angle += flip.velocity * dt;
      moving ||= Math.abs(targetAngle - flip.angle) > .05 || Math.abs(flip.velocity) > .1;
    });
    if (moving) {
      render();
      animationFrame = requestAnimationFrame(frame);
    } else {
      position = target;
      travelVelocity = 0;
      discRenderer?.settle();
      render();
    }
  }

  /** 从当前视觉位置改变目标，连续点击和拖动都不会重新起步。 */
  function navigate(index: number) {
    destination = clamp(index, 0, discs.length - 1);
    // 跳转到未预载的光碟时，只唤起目标与邻盘的封面请求。
    discImages.slice(Math.max(0, destination - 1), destination + 2).forEach((image) => {
      if (image) image.loading = "eager";
    });
    flippedIndex = -1;
    animationGeneration += 1;
    if (reduceMotion.matches) {
      position = destination;
      flips.forEach((flip) => { flip.angle = flip.velocity = 0; });
      render();
    } else startMotion();
  }

  /** 打开较后的作品时成对解码途经封面，避免十张高清图同时争抢主线程。 */
  async function prepareOpeningRoute(lastIndex: number, opening: number, physicalReady: Promise<void>) {
    const route = discImages.slice(0, Math.min(lastIndex + 2, discImages.length));
    route.forEach((image) => { if (image) image.loading = "eager"; });
    for (let first = 0; first < route.length; first += 2) {
      await Promise.all(route.slice(first, first + 2).map((image) => image?.decode().catch(() => undefined)));
      if (!dialog?.open || opening !== animationGeneration) return;
    }
    // 首次进入时 CSS 盘与 WebGL 盘不能在滑动途中交接，否则首张盘会看似乱转。
    await physicalReady;
    if (!dialog?.open || opening !== animationGeneration) return;
    await discRenderer?.prepareOpeningArtwork();
    if (!dialog?.open || opening !== animationGeneration) return;
    navigate(lastIndex);
  }

  /** 打开时始终从第一张盘出发，再滑到所选作品。 */
  function openGallery(index: number, source: HTMLButtonElement) {
    cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    opener = source;
    position = 0;
    destination = 0;
    travelVelocity = 0;
    dialog?.classList.remove("is-travelling");
    shownIndex = -1;
    flippedIndex = -1;
    lastWheelAt = 0;
    hoveredIndex = -1;
    poses.forEach((pose, poseIndex) => {
      pose.x = pose.y = pose.vx = pose.vy = pose.targetX = pose.targetY = 0;
      discs[poseIndex].classList.remove("is-hovered", "is-grabbed");
      discs[poseIndex].style.setProperty("--tilt-x", "0deg");
      discs[poseIndex].style.setProperty("--tilt-y", "0deg");
    });
    flips.forEach((flip) => { flip.angle = flip.velocity = 0; });
    dialog?.showModal();
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    measureStage();
    render();
    stage?.focus({ preventScroll: true });
    discImages.slice(0, 2).forEach((image) => { if (image) image.loading = "eager"; });
    const physicalReady = ensurePhysicalDiscs();
    if (index !== 0) {
      const opening = ++animationGeneration;
      void prepareOpeningRoute(index, opening, physicalReady);
    }
  }

  openers.forEach((button, index) => button.addEventListener("click", () => openGallery(index, button)));
  const rail = document.querySelector<HTMLElement>("[data-favorite-rail]");
  if (rail && "IntersectionObserver" in window) {
    /** 收藏区将进入视口时只预载开场附近的封面，避免滚动时同时解码十张图。 */
    const preloadObserver = new IntersectionObserver((items) => {
      if (!items.some((item) => item.isIntersecting)) return;
      discImages.slice(0, 3).forEach((image) => { if (image) image.loading = "eager"; });
      preloadObserver.disconnect();
    }, { rootMargin: "600px" });
    preloadObserver.observe(rail);
  }
  closeButton?.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    animationGeneration += 1;
    cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    document.body.style.overflow = previousBodyOverflow;
    if (pointerStart && stage.hasPointerCapture(pointerStart.id)) stage.releasePointerCapture(pointerStart.id);
    pointerStart = null;
    hoveredIndex = -1;
    stage.classList.remove("is-dragging");
    discs.forEach((disc) => disc.classList.remove("is-hovered", "is-grabbed"));
    // 关闭后释放第二套 WebGL 上下文和封面纹理，让主页画廊独占显存。
    discRenderer?.dispose();
    discRenderer = null;
    dialog.classList.remove("has-webgl");
    opener?.focus({ preventScroll: true });
  });
  previous?.addEventListener("click", () => navigate(destination - 1));
  next?.addEventListener("click", () => navigate(destination + 1));
  pages.forEach((button, index) => button.addEventListener("click", () => navigate(index)));

  dialog.addEventListener("wheel", (event) => {
    event.preventDefault();
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (Math.abs(delta) < 5 || performance.now() - lastWheelAt < 260) return;
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
      if (reduceMotion.matches) flips.forEach((flip, index) => { flip.angle = index === flippedIndex ? 180 : 0; });
      render();
      startMotion();
    } else if (event.key === "Enter" && event.target === stage) {
      event.preventDefault();
      window.open(discs[destination].dataset.url, "_blank", "noopener,noreferrer");
    }
  });

  /** 所有可见盘都能轻摆；按住盘面可连续旋转并露出真实背面。 */
  function aimDisc(event: PointerEvent, hovered: HTMLButtonElement | null) {
    const index = hovered && !reduceMotion.matches ? discs.indexOf(hovered) : -1;
    if (hoveredIndex !== index) {
      // 指针每次移动只清理上一张悬停盘，避免对全部十张盘重复写样式。
      if (hoveredIndex >= 0) {
        const previous = discs[hoveredIndex];
        poses[hoveredIndex].targetX = poses[hoveredIndex].targetY = 0;
        previous.classList.remove("is-hovered");
        previous.style.setProperty("--glare-opacity", ".2");
      }
      hoveredIndex = index;
    }
    if (index < 0) { startMotion(); return; }
    hovered = discs[index];
    hovered.classList.add("is-hovered");
    const { x, y } = pointerOnDisc(event, index);
    if (pointerStart && didDrag) {
      const movement = event.clientX - pointerStart.x;
      // 参考站每像素约转四分之一度；保留背面的完整角程，而不是侧立时跳回正面。
      const intendedYaw = pointerStart.yaw + clamp(movement * .245, -180, 180);
      poses[index].targetX = clamp(pointerStart.pitch + (pointerStart.y - event.clientY) * .18, -60, 60);
      poses[index].targetY = intendedYaw - baseYaw(index - position);
    } else {
      poses[index].targetX = -y * 7;
      poses[index].targetY = x * 12;
    }
    hovered.style.setProperty("--glare-x", `${50 + x * 36}%`);
    hovered.style.setProperty("--glare-y", `${50 + y * 36}%`);
    hovered.style.setProperty("--glare-opacity", ".48");
    startMotion();
  }

  stage.addEventListener("pointermove", (event) => {
    if (pointerStart) return;
    aimDisc(event, hoveredDisc(event));
  });
  stage.addEventListener("pointerleave", (event) => {
    if (pointerStart) return;
    aimDisc(event, null);
  });

  /** 拖动改变连续位置，松手后吸附最近的光碟。 */
  stage.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const pressedDisc = hoveredDisc(event);
    const activeIndex = clamp(Math.round(position), 0, discs.length - 1);
    // 参考站只让正中的光碟原地旋转；拖动邻盘仍推动整条盘列。
    const discIndex = pressedDisc === discs[activeIndex] && Math.abs(position - activeIndex) < .6 ? activeIndex : null;
    pointerStart = {
      id: event.pointerId, x: event.clientX, y: event.clientY, position, discIndex,
      yaw: discIndex === null ? 0 : baseYaw(discIndex - position) + poses[discIndex].y,
      pitch: discIndex === null ? 0 : poses[discIndex].x,
      lastX: event.clientX, lastAt: performance.now(), velocity: 0,
    };
    if (discIndex !== null) pressedDisc?.classList.add("is-grabbed");
    didDrag = false;
  });
  window.addEventListener("pointermove", (event) => {
    if (!dialog.open || !pointerStart || event.pointerId !== pointerStart.id) return;
    const movement = event.clientX - pointerStart.x;
    if (Math.abs(movement) < 7 && !didDrag) return;
    const now = performance.now();
    const elapsed = Math.max(now - pointerStart.lastAt, 8);
    pointerStart.velocity += ((event.clientX - pointerStart.lastX) / elapsed - pointerStart.velocity) * .32;
    pointerStart.lastX = event.clientX;
    pointerStart.lastAt = now;
    if (!didDrag) {
      animationGeneration += 1;
      // 确认是拖拽后再捕获指针，单击光碟仍能正常打开链接。
      stage.setPointerCapture(event.pointerId);
    }
    didDrag = true;
    stage.classList.add("is-dragging");
    if (pointerStart.discIndex === null) {
      // 在空白区域拖动时跟随光碟队列，盘面本身则只做三维旋转。
      const span = event.pointerType === "touch" ? 1.8 : 5.7;
      draggedPosition = clamp(pointerStart.position - movement / Math.max(stage.clientWidth, 1) * span, 0, discs.length - 1);
      destination = Math.round(draggedPosition);
    }
    aimDisc(event, pointerStart.discIndex === null ? null : discs[pointerStart.discIndex]);
    startMotion();
  });
  window.addEventListener("pointerup", (event) => {
    if (!pointerStart || event.pointerId !== pointerStart.id) return;
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
    const draggedDisc = pointerStart.discIndex !== null;
    const dragVelocity = pointerStart.velocity;
    if (pointerStart.discIndex !== null) discs[pointerStart.discIndex].classList.remove("is-grabbed");
    pointerStart = null;
    stage.classList.remove("is-dragging");
    if (didDrag) {
      suppressClickUntil = performance.now() + 350;
      if (!draggedDisc) {
        const flick = clamp(-dragVelocity * 1000 / Math.max(stage.clientWidth, 1) * 5.7 * .08, -.45, .45);
        navigate(Math.round(draggedPosition + flick));
      }
      stage.focus({ preventScroll: true });
    }
    aimDisc(event, hoveredDisc(event));
  });
  window.addEventListener("pointercancel", () => {
    if (!pointerStart) return;
    if (stage.hasPointerCapture(pointerStart.id)) stage.releasePointerCapture(pointerStart.id);
    const draggedDisc = pointerStart.discIndex !== null;
    if (pointerStart.discIndex !== null) discs[pointerStart.discIndex].classList.remove("is-grabbed");
    pointerStart = null;
    stage.classList.remove("is-dragging");
    if (didDrag && !draggedDisc) navigate(Math.round(draggedPosition));
    // 系统取消拖拽后仍让盘面平滑回正，避免停留在最后一帧侧立姿态。
    poses.forEach((pose) => { pose.targetX = pose.targetY = 0; });
    startMotion();
  });
  stage.addEventListener("dragstart", (event) => event.preventDefault());

  /** 相邻盘先选中，当前盘才打开外部链接；拖动产生的 click 不触发导航。 */
  stage.addEventListener("click", (event) => {
    if (performance.now() < suppressClickUntil) { event.preventDefault(); return; }
    // 鼠标点击也用真实盘面命中，避免透明按钮的矩形区域吞掉留白点击。
    const target = event.detail === 0 && event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>("[data-album-disc]")
      : hoveredDisc(event);
    if (!target) return;
    const index = Number(target.dataset.albumDisc);
    if (index !== Math.round(position) || Math.abs(position - index) > .12) navigate(index);
    else window.open(target.dataset.url, "_blank", "noopener,noreferrer");
  });
  window.addEventListener("resize", () => { if (dialog.open) { measureStage(); render(); } });
  window.addEventListener("pagehide", () => {
    discRenderer?.dispose();
    discRenderer = null;
    dialog.classList.remove("has-webgl");
  });
}
