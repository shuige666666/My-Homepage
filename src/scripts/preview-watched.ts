/** 调整「最近看过」的海报扇面，间距和倾角可以分别修改。 */
const FAN_LAYOUT = {
  spacingRatio: 0.34, // 相邻卡片中心间距，占最宽海报宽度的比例。
  edgeAngleDegrees: 7, // 完全展开时，最外侧卡片的倾角（度）。
} as const;

const ENTRY_END = 0.045;
export const FAN_END = 0.64;
const GATHER_END = 0.76;
const FILL_END = 0.85;
const EXPAND_END = 0.935;
const REVEAL_END = 0.993;
const RECOIL_DURATION = 560;

const unit = (value: number) => Math.min(1, Math.max(0, value));
const ease = (value: number) => value * value * (3 - 2 * value);

/** 固定视口内滚动一组海报，轮轴、卡片展开和章节交接共用文档滚动位置。 */
export function setupPreviewJournal() {
  const section = document.querySelector<HTMLElement>("[data-pv-journal]");
  const pin = section?.querySelector<HTMLElement>("[data-pv-journal-pin]");
  const wheel = section?.querySelector<HTMLElement>("[data-pv-journal-wheel]");
  const slots = Array.from(
    section?.querySelectorAll<HTMLElement>("[data-pv-journal-slot]") ?? [],
  );
  const reviews = document.querySelector<HTMLElement>("[data-pv-reviews]");
  if (!section || !pin || !wheel || !slots.length || !reviews) return;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const cards = slots.map((slot) => ({
    link: slot.querySelector<HTMLAnchorElement>("a")!,
    image: slot.querySelector<HTMLImageElement>("img")!,
    name: slot.querySelector("strong")!.textContent!,
    date: slot.querySelector("time")!,
    entrance: null as Animation | null,
  }));
  const title = section.querySelector<HTMLAnchorElement>(
    "[data-pv-journal-title]",
  )!;
  const date = section.querySelector<HTMLTimeElement>(
    "[data-pv-journal-date]",
  )!;
  const wave = section.querySelector<SVGPathElement>("[data-pv-journal-wave]")!;
  const last = cards.length - 1;
  const gaps = Math.max(1, last);
  const edgeAngle = (FAN_LAYOUT.edgeAngleDegrees * Math.PI) / 180;
  let activeIndex = -1;
  let frame = 0;
  let stageHeight = 0;
  let wheelRadius = 0;
  let slotStep = 0;
  let posterHeight = 0;
  let posterCenter = 0;
  let cardWidths: number[] = [];
  let coverScale = 1;
  let gatheredCenter = 0;
  let displayProgress = 0;
  let previousProgress = 0;
  let previousFrame = 0;
  let revealedThrough = -1;
  let recoilAt = -Infinity;
  let recoilDirection = 0;
  let keyboardTarget: number | null = null;

  /** 标题和日期跟随当前海报，卡面只保留原始图像。 */
  function select(index: number) {
    if (index === activeIndex) return;
    activeIndex = index;
    title.href = cards[index].link.href;
    title.textContent = cards[index].name;
    date.dateTime = cards[index].date.dateTime;
    date.textContent = cards[index].date.textContent;
  }

  /** 卡距随视口收紧，所有海报打开后仍完整落在舞台内。 */
  function measure() {
    const stageWidth = pin!.clientWidth;
    stageHeight = pin!.clientHeight;
    cardWidths = cards.map(({ link }) => link.offsetWidth);
    posterHeight = wheel!.offsetHeight;
    const maxWidth = Math.max(...cardWidths);
    // 先给倾斜卡片的边角留出空间，窄屏再按可用宽度收紧间距。
    const rotatedWidth =
      maxWidth + posterHeight * Math.sin(Math.abs(edgeAngle));
    const spacing = Math.max(
      0,
      Math.min(
        maxWidth * FAN_LAYOUT.spacingRatio,
        (stageWidth * 0.92 - rotatedWidth) / gaps,
      ),
    );
    wheelRadius = Math.max(stageWidth * 1.6, (spacing * gaps) / (0.092 * 2));
    slotStep = spacing / wheelRadius;
    gatheredCenter = wheel!.offsetTop - Math.min(28, stageHeight * 0.035);
    posterCenter = wheel!.offsetTop;
    coverScale =
      1.055 *
      Math.max(
        stageWidth / (cardWidths[last] || 1),
        (2 * Math.max(gatheredCenter, stageHeight - gatheredCenter)) /
          (posterHeight || 1),
      );
    schedule();
  }

  /** 新卡从前一张的右下缘升起，横向过冲两次后落在轮轴的卡位上。 */
  function springIn(index: number, delay: number) {
    const card = cards[index];
    const spacing = wheelRadius * slotStep;
    const motion = card.link.animate(
      [
        {
          offset: 0,
          translate: `${index ? -0.35 * spacing : 0}px 42%`,
          rotate: "-3deg",
          scale: ".94",
          opacity: 0.16,
          easing: "cubic-bezier(.18,.72,.28,1)",
        },
        {
          offset: 0.36,
          translate: `${0.21 * spacing}px -3.5%`,
          rotate: "1.8deg",
          scale: "1.012",
          opacity: 1,
          easing: "ease-in-out",
        },
        {
          offset: 0.61,
          translate: `${-0.085 * spacing}px 1.2%`,
          rotate: "-.85deg",
          scale: "1",
          opacity: 1,
          easing: "ease-in-out",
        },
        {
          offset: 0.82,
          translate: `${0.025 * spacing}px 0`,
          rotate: ".23deg",
          scale: "1",
          opacity: 1,
          easing: "ease-out",
        },
        { offset: 1, translate: "0 0", rotate: "0deg", scale: "1", opacity: 1 },
      ],
      { duration: 640, delay, fill: "both" },
    );
    card.entrance = motion;
    motion.onfinish = () => {
      card.entrance = null;
      motion.cancel();
    };
  }

  /** 用一条连续曲线绘制上升的液面；暂停滚动时波峰仍会缓慢横移。 */
  function paintWave(fill: number, now: number) {
    if (fill <= 0 || fill >= 1) {
      wave.setAttribute("d", fill >= 1 ? "M0 0H100V100H0Z" : "");
      return;
    }
    const level = 104 - 111 * fill;
    const amplitude = 1.8 + 3.6 * Math.sin(Math.PI * fill);
    const phase = fill * Math.PI * 1.65 - now / 465;
    const y = (x: number) => level + amplitude * Math.sin(x * 0.081 + phase);
    const slope = (x: number) =>
      amplitude * 0.081 * Math.cos(x * 0.081 + phase);
    let path = `M0 ${y(0).toFixed(2)}`;
    for (let x = 0; x < 100; x += 25) {
      const end = x + 25;
      const step = 25 / 3;
      path += `C${x + step} ${(y(x) + slope(x) * step).toFixed(2)} ${end - step} ${(y(end) - slope(end) * step).toFixed(2)} ${end} ${y(end).toFixed(2)}`;
    }
    wave.setAttribute("d", `${path}V100H0Z`);
  }

  /** 短评层有独立的停留区，淡入期间位置固定且暂不接收焦点。 */
  function revealReviews(opacity: number) {
    reviews!.style.setProperty("--pv-review-reveal", String(opacity));
    reviews!.classList.toggle("is-revealed", opacity > 0);
    reviews!.inert = opacity < 1;
  }

  /** 卡组以可见外轮廓居中，收束时保持不透明并按前后顺序归到末张下面。 */
  function render(now = performance.now()) {
    frame = 0;
    if (reducedMotion.matches || !stageHeight) return;
    const rect = section!.getBoundingClientRect();
    const travel = section!.offsetHeight - stageHeight;
    if (rect.top > stageHeight || rect.bottom < 0 || travel <= 0) {
      previousFrame = 0;
      revealReviews(rect.bottom < 0 ? 1 : 0);
      return;
    }

    // 平滑离散的滚轮步长，直接跳转时则同步到目的地；短评离开顶端前必定完全显示。
    const target = unit(-rect.top / travel);
    const elapsed = Math.min(now - previousFrame, 32);
    const jumped = !previousFrame || Math.abs(target - previousProgress) > 0.28;
    previousProgress = target;
    // 从短评停留段回滚时，先从真正的时间线尾端开始，再反向展开海报。
    if (jumped || target === 1 || rect.top > 0) displayProgress = target;
    else
      displayProgress +=
        (target - displayProgress) * (1 - Math.exp(-elapsed / 88));
    if (Math.abs(target - displayProgress) < 0.00025) displayProgress = target;
    previousFrame = now;
    const progress = displayProgress;
    const entry = ease(
      unit((stageHeight * 0.7 - rect.top) / (stageHeight * 0.68)),
    );
    const position =
      unit((progress - ENTRY_END) / (FAN_END - ENTRY_END)) * last;
    const gather = ease(unit((progress - FAN_END) / (GATHER_END - FAN_END)));
    const fill = ease(unit((progress - GATHER_END) / (FILL_END - GATHER_END)));
    const expand = ease(unit((progress - FILL_END) / (EXPAND_END - FILL_END)));
    const handoff = ease(
      unit((progress - EXPAND_END) / (REVEAL_END - EXPAND_END)),
    );

    // 逐张越过卡位才触发弹出。反向收回稍晚一点，滚轮在临界位置抖动时不会反复触发。
    const previouslyRevealed = revealedThrough;
    const nextSlot = Math.min(last, Math.floor(position + 0.82));
    const retainedSlot = Math.floor(position + 0.96);
    revealedThrough =
      entry < 0.62
        ? -1
        : progress >= FAN_END
          ? last
          : Math.max(nextSlot, Math.min(revealedThrough, retainedSlot));
    select(Math.max(0, revealedThrough));
    const changed = revealedThrough - previouslyRevealed;
    const spring =
      changed > 0 && progress <= FAN_END && (!jumped || revealedThrough === 0);
    if (jumped || progress >= GATHER_END) recoilAt = -Infinity;
    else if (changed && revealedThrough >= 1 && progress <= FAN_END) {
      recoilAt = now;
      recoilDirection = Math.sign(changed);
    }
    const recoil = unit((now - recoilAt) / RECOIL_DURATION);
    const swing =
      recoilDirection *
      0.13 *
      Math.sin(2.65 * Math.PI * recoil) *
      (1 - recoil) ** 2;

    // 新卡先在扇面边缘升起，卡组两侧同时让位，收束时末张卡固定落在中线。
    const occupied = Math.min(position, Math.max(0, revealedThrough));
    const arcStep = slotStep * (1 - gather) * (1 + swing);
    const angleStep = ((2 * edgeAngle) / gaps) * (1 - gather);
    const lift = (1 - entry) * 46 + (gatheredCenter - posterCenter) * gather;
    const finalWidth = cardWidths[last] || 1;
    let left = Infinity;
    let right = -Infinity;
    const poses = slots.map((_, index) => {
      const offset = Math.min(index, occupied) - occupied / 2;
      const arc = offset * arcStep;
      const angle = offset * angleStep;
      const x = Math.sin(arc) * wheelRadius;
      const y = (1 - Math.cos(arc)) * wheelRadius + lift;
      const tucked = Math.min(
        0.995,
        (finalWidth - 1) / (cardWidths[index] || 1),
      );
      const scale =
        index === last
          ? 1 + (coverScale - 1) * expand
          : 1 + (tucked - 1) * gather;
      if (index <= revealedThrough) {
        const halfWidth =
          ((Math.cos(angle) * cardWidths[index] +
            Math.abs(Math.sin(angle)) * posterHeight) *
            scale) /
          2;
        left = Math.min(left, x - halfWidth);
        right = Math.max(right, x + halfWidth);
      }
      return { x, y, angle, scale };
    });
    const center = revealedThrough < 0 ? 0 : (left + right) / 2;

    slots.forEach((slot, index) => {
      const revealed = index <= revealedThrough;
      const { x, y, angle, scale } = poses[index];
      slot.style.setProperty("--pv-card-x", `${x - center}px`);
      slot.style.setProperty("--pv-card-y", `${y}px`);
      slot.style.setProperty(
        "--pv-card-angle",
        (angle * 180) / Math.PI + "deg",
      );
      slot.style.setProperty("--pv-card-scale", String(scale));
      slot.style.setProperty(
        "--pv-card-shadow",
        String(index === last ? 1 - expand : 1 - gather),
      );
      slot.classList.toggle("is-revealed", revealed);
      const card = cards[index];
      if (revealed && spring && index > previouslyRevealed)
        springIn(index, (index - previouslyRevealed - 1) * 55);
      else if ((!revealed || gather === 1) && card.entrance) {
        card.entrance.cancel();
        card.entrance = null;
      }
      const interactive = revealed && progress <= FAN_END;
      slot.inert = !interactive;
      card.link.tabIndex = interactive ? 0 : -1;
    });

    // 液面和缩放都在最后一张卡片上完成，卡面铺满之后才叠入短评正文。
    paintWave(fill, now);
    revealReviews(handoff);
    pin!.style.setProperty("--pv-journal-entry", String(entry));
    pin!.style.setProperty(
      "--pv-journal-header",
      String(1 - ease(unit((progress - FILL_END) / 0.04))),
    );
    title.tabIndex = progress > FAN_END ? -1 : 0;
    wheel!.tabIndex = progress > FAN_END ? -1 : 0;
    if (displayProgress !== target || recoil < 1 || (fill > 0 && fill < 1))
      schedule();
  }

  function schedule() {
    if (!frame && !reducedMotion.matches) frame = requestAnimationFrame(render);
  }

  /** 方向键走同一滚动时间线，连续按键可以越过上一张尚未停稳的卡片。 */
  section.addEventListener("keydown", (event) => {
    if (
      reducedMotion.matches ||
      (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
    )
      return;
    const travel = section.offsetHeight - pin.clientHeight;
    if (travel <= 0 || last === 0) return;
    event.preventDefault();
    const next = Math.min(
      last,
      Math.max(
        0,
        (keyboardTarget ?? activeIndex) + (event.key === "ArrowRight" ? 1 : -1),
      ),
    );
    keyboardTarget = next;
    const progress = ENTRY_END + ((FAN_END - ENTRY_END) * next) / last;
    window.scrollTo({
      top:
        window.scrollY +
        section.getBoundingClientRect().top +
        progress * travel,
      behavior: "smooth",
    });
  });

  const resetKeyboard = () => {
    keyboardTarget = null;
  };
  window.addEventListener("wheel", resetKeyboard, { passive: true });
  window.addEventListener("touchstart", resetKeyboard, { passive: true });
  window.addEventListener("scrollend", resetKeyboard);
  window.addEventListener("scroll", schedule, { passive: true });
  const resize = new ResizeObserver(measure);
  resize.observe(pin);
  resize.observe(wheel);
  cards.forEach(({ link }) => resize.observe(link));

  // 封面加载后以原图比例确定卡宽，下一张在进入舞台前提前加载。
  cards.forEach(({ image }, index) => {
    const fitPoster = () => {
      if (image.naturalHeight)
        slots[index].style.setProperty(
          "--pv-poster-ratio",
          String(image.naturalWidth / image.naturalHeight),
        );
    };
    if (image.complete) fitPoster();
    else image.addEventListener("load", fitPoster, { once: true });
  });
  const preload = new IntersectionObserver(
    ([entry]) => {
      if (!entry.isIntersecting) return;
      cards.forEach(({ image }) => {
        image.loading = "eager";
      });
      preload.disconnect();
    },
    { rootMargin: "850px 0px" },
  );
  preload.observe(section);

  /** 关闭动画后还原普通海报列表，完整保留全部链接的键盘操作。 */
  function syncPreference() {
    section!.classList.toggle("is-animated", !reducedMotion.matches);
    if (reducedMotion.matches) {
      cancelAnimationFrame(frame);
      frame = 0;
      previousFrame = 0;
      revealedThrough = -1;
      recoilAt = -Infinity;
      wheel!.tabIndex = 0;
      reviews!.inert = false;
      reviews!.classList.remove("is-revealed");
      reviews!.style.removeProperty("--pv-review-reveal");
      slots.forEach((slot, index) => {
        cards[index].entrance?.cancel();
        cards[index].entrance = null;
        slot.inert = false;
        cards[index].link.tabIndex = 0;
      });
    } else {
      measure();
      render();
    }
  }

  reducedMotion.addEventListener("change", syncPreference);
  syncPreference();
}
