/** 调整「最近看过」的海报扇面，间距和倾角可以分别修改。 */
const FAN_LAYOUT = {
  spacingRatio: 0.34, // 相邻卡片中心间距，占最宽海报宽度的比例。
  edgeAngleDegrees: 7, // 完全展开时，最外侧卡片的倾角（度）。
} as const;

const ENTRY_END = 0.045;
export const FAN_END = 0.62;
const GATHER_END = 0.74;
const FLY_END = 0.93;
const RECOIL_DURATION = 560;

/** 与「评分与短评」左侧四层叠卡完全一致的落地姿态，用于空间接力无缝落位。 */
const RELAY_DECK_OFFSETS = [
  { dx: 0, dy: 0, angle: 0, scaleMul: 1, op: 1 },
  { dx: -28, dy: -8, angle: (-5.2 * Math.PI) / 180, scaleMul: 0.945, op: 0.96 },
  { dx: -54, dy: -15, angle: (-10.2 * Math.PI) / 180, scaleMul: 0.89, op: 0.88 },
  { dx: -76, dy: -20, angle: (-14.5 * Math.PI) / 180, scaleMul: 0.835, op: 0.74 },
] as const;

const unit = (value: number) => Math.min(1, Math.max(0, value));
const ease = (value: number) => value * value * (3 - 2 * value);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const pad2 = (n: number) => String(n).padStart(2, "0");

/** 固定视口内滚动一组海报，轮轴、卡片展开与空间接力转场共用文档滚动位置。 */
export function setupPreviewJournal() {
  const section = document.querySelector<HTMLElement>("[data-pv-journal]");
  const pin = section?.querySelector<HTMLElement>("[data-pv-journal-pin]");
  const wheel = section?.querySelector<HTMLElement>("[data-pv-journal-wheel]");
  const slots = Array.from(
    section?.querySelectorAll<HTMLElement>("[data-pv-journal-slot]") ?? [],
  );
  const reviews = document.querySelector<HTMLElement>("[data-pv-reviews]");
  if (!section || !pin || !wheel || !slots.length || !reviews) return;

  const showcaseTrack = document.querySelector<HTMLElement>("[data-pv-showcase]");
  const showcasePin = showcaseTrack?.querySelector<HTMLElement>("[data-sc-stage-pin]");
  const reviewOrbit = showcaseTrack?.querySelector<HTMLElement>("[data-sc-deck-orbit]");

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const desktopRelayQuery = window.matchMedia("(min-width: 961px) and (min-height: 680px)");

  const cards = slots.map((slot) => ({
    link: slot.querySelector<HTMLAnchorElement>("a")!,
    image: slot.querySelector<HTMLImageElement>(".pv-journal__poster img")!,
    name: slot.querySelector(".pv-journal__caption strong")!.textContent ?? "",
    native: slot.querySelector("[data-pv-journal-native-src]")?.textContent ?? "",
    date: slot.querySelector<HTMLTimeElement>(".pv-journal__caption time")!,
    entrance: null as Animation | null,
  }));

  const indexEl = section.querySelector<HTMLElement>("[data-pv-journal-index]");
  const titleLink = section.querySelector<HTMLAnchorElement>("[data-pv-journal-title]")!;
  const titleText = section.querySelector<HTMLElement>("[data-pv-journal-title-text]");
  const nativeEl = section.querySelector<HTMLElement>("[data-pv-journal-native]");
  const dateEl = section.querySelector<HTMLTimeElement>("[data-pv-journal-date]")!;
  const relayCover = section.querySelector<HTMLImageElement>("[data-pv-journal-relay-cover]");
  const dotBtns = Array.from(section.querySelectorAll<HTMLButtonElement>("[data-pv-journal-dot]"));

  const last = cards.length - 1;
  const gaps = Math.max(1, last);
  const edgeAngle = (FAN_LAYOUT.edgeAngleDegrees * Math.PI) / 180;

  let activeIndex = -1;
  let hoveredIndex = -1;
  let frame = 0;
  let stageWidth = 0;
  let stageHeight = 0;
  let wheelRadius = 0;
  let slotStep = 0;
  let posterHeight = 0;
  let posterCenter = 0;
  let gatheredCenter = 0;
  let cardWidths: number[] = [];
  let targetDeck = { cx: 0, cy: 0, w: 280, h: 396 };
  let hasTargetDeck = false;

  let displayProgress = 0;
  let previousProgress = 0;
  let previousFrame = 0;
  let revealedThrough = -1;
  let recoilAt = -Infinity;
  let recoilDirection = 0;
  let keyboardTarget: number | null = null;
  let jumpFrame = 0;

  /** 底部铭牌、左上计数与进度点实时跟随滚动进度或悬停卡片。 */
  function syncDisplay() {
    const idx = hoveredIndex >= 0 ? hoveredIndex : Math.max(0, activeIndex);
    const card = cards[idx];
    if (!card) return;
    if (indexEl) indexEl.textContent = pad2(idx + 1);
    titleLink.href = card.link.href;
    if (titleText) titleText.textContent = card.name;
    else titleLink.textContent = card.name;
    if (nativeEl) nativeEl.textContent = card.native;
    dateEl.dateTime = card.date.dateTime;
    dateEl.textContent = card.date.textContent;
    dotBtns.forEach((btn, i) => {
      btn.classList.toggle("is-revealed", i <= revealedThrough);
      btn.classList.toggle("is-active", i === idx);
    });
  }

  /** 同步下方「评分与短评」当前置顶作品封面，确保切卡回滚后依然严丝合缝。 */
  function syncRelayCover() {
    if (!relayCover || !reviewOrbit) return;
    const frontImg = reviewOrbit.querySelector<HTMLImageElement>(
      '.pv-sc-ticket-card[data-offset="0"] .pv-sc-poster-wrap img',
    );
    const src = frontImg?.getAttribute("src");
    if (src && relayCover.getAttribute("src") !== src) {
      relayCover.setAttribute("src", src);
    }
  }

  /** 测量舞台尺寸、扇面步长，以及下方短评左叠相对视口的精确锚点。 */
  function measure() {
    stageWidth = pin!.clientWidth;
    stageHeight = pin!.clientHeight;
    cardWidths = cards.map(({ link }) => link.offsetWidth || 240);
    posterHeight = wheel!.offsetHeight || 360;
    const maxWidth = Math.max(...cardWidths);
    const rotatedWidth = maxWidth + posterHeight * Math.sin(Math.abs(edgeAngle));
    const spacing = Math.max(
      0,
      Math.min(
        maxWidth * FAN_LAYOUT.spacingRatio,
        (stageWidth * 0.9 - rotatedWidth) / gaps,
      ),
    );
    wheelRadius = Math.max(stageWidth * 1.65, (spacing * gaps) / (0.092 * 2));
    slotStep = spacing / wheelRadius;

    const wheelRect = wheel!.getBoundingClientRect();
    const pinRect = pin!.getBoundingClientRect();
    posterCenter = wheelRect.top - pinRect.top + wheelRect.height / 2;
    gatheredCenter = posterCenter - Math.min(20, stageHeight * 0.025);

    if (showcasePin && reviewOrbit && desktopRelayQuery.matches) {
      const scPinRect = showcasePin.getBoundingClientRect();
      const orbitRect = reviewOrbit.getBoundingClientRect();
      if (orbitRect.width > 20 && orbitRect.height > 20) {
        targetDeck = {
          cx: orbitRect.left - scPinRect.left + orbitRect.width / 2,
          cy: orbitRect.top - scPinRect.top + orbitRect.height / 2,
          w: orbitRect.width,
          h: orbitRect.height,
        };
        hasTargetDeck = true;
      }
    } else {
      hasTargetDeck = false;
    }

    schedule();
  }

  /** 新卡从前一张的右下缘升起，横向与缩放双次弹性过冲后落在轮轴卡位上。 */
  function springIn(index: number, delay: number) {
    const card = cards[index];
    const spacing = wheelRadius * slotStep;
    const motion = card.link.animate(
      [
        {
          offset: 0,
          translate: `${index ? -0.35 * spacing : 0}px 42%`,
          rotate: "-3.2deg",
          scale: ".935",
          opacity: 0.16,
          easing: "cubic-bezier(.18,.72,.28,1)",
        },
        {
          offset: 0.36,
          translate: `${0.21 * spacing}px -3.8%`,
          rotate: "1.9deg",
          scale: "1.016",
          opacity: 1,
          easing: "ease-in-out",
        },
        {
          offset: 0.61,
          translate: `${-0.085 * spacing}px 1.3%`,
          rotate: "-.88deg",
          scale: "0.995",
          opacity: 1,
          easing: "ease-in-out",
        },
        {
          offset: 0.82,
          translate: `${0.025 * spacing}px -0.3%`,
          rotate: ".25deg",
          scale: "1.003",
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

  let lastRevealKey = "";
  /** 同步短评章节显现进度、纸色渐变与接力交接，保证正反滚动都丝滑一致。 */
  function revealReviews(
    progress: number,
    deckSwap: number,
    exitBg: number,
    relay: boolean,
  ) {
    const p = unit(progress);
    const swap = unit(deckSwap);
    const bg = unit(exitBg);
    const key = `${p.toFixed(4)}|${swap.toFixed(4)}|${bg.toFixed(4)}|${relay ? 1 : 0}`;
    if (key === lastRevealKey) return;
    lastRevealKey = key;

    const sectionOpacity = relay ? (p > 0 ? unit(p / 0.14) : 0) : p;
    reviews!.style.setProperty("--pv-review-reveal", sectionOpacity.toFixed(4));
    reviews!.classList.toggle("is-revealed", p > 0);
    const ready = relay ? p >= 0.99 && swap >= 0.99 : p >= 1;
    reviews!.dataset.journalReady = ready ? "true" : "false";
    reviews!.dispatchEvent(
      new CustomEvent("pv:review-reveal", {
        detail: { progress: p, deckSwap: swap, exitBg: bg, relay },
      }),
    );
  }

  /** 卡组以可见外轮廓居中，扇面期 8 张等大 0px 纸边，接力落位时再平滑长出 10px 奶油纸框。 */
  function render(now = performance.now()) {
    frame = 0;
    if (reducedMotion.matches || !stageHeight) return;
    const rect = section!.getBoundingClientRect();
    const travel = section!.offsetHeight - stageHeight;

    if (rect.top > stageHeight || rect.bottom < 0 || travel <= 0) {
      previousFrame = 0;
      pin!.classList.remove("is-relay-pass");
      wheel!.style.opacity = rect.bottom < 0 ? "0" : "";
      if (rect.bottom < 0) {
        revealReviews(1, 1, 1, false);
      } else {
        revealReviews(0, 0, 0, false);
      }
      return;
    }

    const target = unit(-rect.top / travel);
    const elapsed = Math.min(now - previousFrame, 32);
    const jumped = !previousFrame || Math.abs(target - previousProgress) > 0.28;
    previousProgress = target;
    if (jumped || target === 1 || rect.top > 0) displayProgress = target;
    else displayProgress += (target - displayProgress) * (1 - Math.exp(-elapsed / 88));
    if (Math.abs(target - displayProgress) < 0.00025) displayProgress = target;
    previousFrame = now;

    const progress = displayProgress;
    const entry = ease(unit((stageHeight * 0.7 - rect.top) / (stageHeight * 0.68)));
    const position = unit((progress - ENTRY_END) / (FAN_END - ENTRY_END)) * last;
    const gather = ease(unit((progress - FAN_END) / (GATHER_END - FAN_END)));

    const previouslyRevealed = revealedThrough;
    const nextSlot = Math.min(last, Math.floor(position + 0.82));
    const retainedSlot = Math.floor(position + 0.96);
    revealedThrough =
      entry < 0.62
        ? -1
        : progress >= FAN_END
          ? last
          : Math.max(nextSlot, Math.min(revealedThrough, retainedSlot));

    const nextActive = Math.max(0, revealedThrough);
    if (nextActive !== activeIndex || progress > FAN_END) {
      if (progress > FAN_END) hoveredIndex = -1;
      if (nextActive !== activeIndex || activeIndex < 0) {
        activeIndex = nextActive;
        syncDisplay();
      } else if (hoveredIndex === -1) {
        syncDisplay();
      }
    }

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

    const occupied = Math.min(position, Math.max(0, revealedThrough));
    const arcStep = slotStep * (1 - gather) * (1 + swing);
    const angleStep = ((2 * edgeAngle) / gaps) * (1 - gather) * (1 + swing * 0.45);
    const lift = (1 - entry) * 46 + (gatheredCenter - posterCenter) * gather;
    const finalWidth = cardWidths[last] || 1;

    const isDesktopRelay = desktopRelayQuery.matches && hasTargetDeck;
    const trackRect = showcaseTrack?.getBoundingClientRect();
    const showcaseCoversViewport = Boolean(
      isDesktopRelay &&
        trackRect &&
        trackRect.top <= 0.5 &&
        trackRect.bottom >= stageHeight - 0.5,
    );

    const chromeOpacity = 1 - ease(unit((progress - GATHER_END) / 0.08));
    const exitBgMix = ease(unit((progress - GATHER_END) / 0.15));
    let relayFrame = 0;
    let wheelOpacity = 1;

    const extra = slots.map(() => ({
      dx: 0,
      dy: 0,
      dAngle: 0,
      scaleTo: null as number | null,
      scaleMix: 0,
      opacity: 1,
      flipDeg: 0,
      relaySwap: 0,
    }));

    if (isDesktopRelay) {
      const fly = ease(unit((progress - GATHER_END) / (FLY_END - GATHER_END)));
      const settleReveal = ease(unit((progress - 0.84) / 0.12));
      // 先让底部的评分叠卡完整显现（0.91→0.935），再把整个轮盘组作为单一合成层淡出（0.935→0.975），避免单卡降透明度导致后方叠卡透出。
      const deckIn = ease(unit((progress - 0.91) / 0.025));
      const wheelFade = ease(unit((progress - 0.935) / 0.04));
      wheelOpacity = 1 - wheelFade;
      // 扇面与收束及飞行前半程保持 0px 无白边，仅在临近落位衔接短评卡叠时才平滑“长出”10px 奶油纸边。
      relayFrame = ease(unit((fly - 0.56) / 0.42));

      if (fly > 0) {
        syncRelayCover();
        const targetShiftX = targetDeck.cx - stageWidth / 2;
        const targetShiftY = targetDeck.cy - gatheredCenter;
        const targetScale = targetDeck.h / (posterHeight || 1);

        slots.forEach((_, index) => {
          const depthFromTop = last - index;
          if (depthFromTop < RELAY_DECK_OFFSETS.length) {
            const pose = RELAY_DECK_OFFSETS[depthFromTop];
            extra[index].dx = lerp(0, targetShiftX + pose.dx, fly);
            extra[index].dy = lerp(0, targetShiftY + pose.dy, fly);
            extra[index].dAngle = lerp(0, pose.angle, fly);
            extra[index].scaleTo = targetScale * pose.scaleMul;
            extra[index].scaleMix = fly;
            extra[index].opacity = lerp(1, pose.op, fly);
            if (depthFromTop === 0) {
              extra[index].relaySwap = ease(unit((fly - 0.46) / 0.46));
              extra[index].flipDeg = -Math.sin(Math.PI * fly) * 12;
            }
          } else {
            extra[index].dx = lerp(0, targetShiftX, fly);
            extra[index].dy = lerp(0, targetShiftY, fly);
            extra[index].scaleTo = targetScale * 0.84;
            extra[index].scaleMix = fly;
            extra[index].opacity = 1 - ease(unit((progress - GATHER_END) / 0.07));
          }
        });
      }

      const passThrough = showcaseCoversViewport && progress >= GATHER_END;
      pin!.classList.toggle("is-relay-pass", passThrough);
      revealReviews(settleReveal, deckIn, exitBgMix, true);
    } else {
      // 窄屏/移动视口：卡片收叠后柔和轻退，交由粘性短评平滑淡入。
      pin!.classList.remove("is-relay-pass");
      const recede = ease(unit((progress - GATHER_END) / 0.14));
      const reveal = ease(unit((progress - 0.83) / 0.15));
      if (recede > 0) {
        slots.forEach((_, index) => {
          extra[index].dy = lerp(0, -24, recede);
          extra[index].scaleTo = 0.91;
          extra[index].scaleMix = recede;
          extra[index].opacity = 1 - recede;
        });
      }
      revealReviews(reveal, reveal, exitBgMix, false);
    }

    let left = Infinity;
    let right = -Infinity;
    const poses = slots.map((_, index) => {
      const offset = Math.min(index, occupied) - occupied / 2;
      const arc = offset * arcStep;
      const angle = offset * angleStep;
      const x = Math.sin(arc) * wheelRadius;
      const y = (1 - Math.cos(arc)) * wheelRadius + lift;
      const tucked = Math.min(0.995, (finalWidth - 1) / (cardWidths[index] || 1));
      const baseScale = index === last ? 1 : 1 + (tucked - 1) * gather;
      const ex = extra[index];
      const scale =
        ex.scaleTo !== null ? lerp(baseScale, ex.scaleTo, ex.scaleMix) : baseScale;
      if (index <= revealedThrough) {
        const halfWidth =
          ((Math.cos(angle) * cardWidths[index] +
            Math.abs(Math.sin(angle)) * posterHeight) *
            baseScale) /
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
      const ex = extra[index];
      slot.style.setProperty("--pv-card-x", `${(x - center + ex.dx).toFixed(2)}px`);
      slot.style.setProperty("--pv-card-y", `${(y + ex.dy).toFixed(2)}px`);
      slot.style.setProperty(
        "--pv-card-angle",
        `${(((angle + ex.dAngle) * 180) / Math.PI).toFixed(3)}deg`,
      );
      slot.style.setProperty("--pv-card-scale", scale.toFixed(4));
      slot.style.setProperty("--pv-slot-opacity", ex.opacity.toFixed(4));
      slot.style.setProperty(
        "--pv-card-shadow",
        String(index === last ? 1 : 1 - gather * 0.7),
      );
      slot.style.setProperty("--pv-journal-flip", `${ex.flipDeg.toFixed(2)}deg`);
      slot.style.setProperty("--pv-relay-swap", ex.relaySwap.toFixed(4));
      slot.style.setProperty("--pv-relay-frame", relayFrame.toFixed(4));

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

    pin!.style.setProperty("--pv-journal-entry", entry.toFixed(4));
    pin!.style.setProperty("--pv-journal-header", chromeOpacity.toFixed(4));
    pin!.style.setProperty("--pv-journal-exit-bg", exitBgMix.toFixed(4));
    wheel!.style.opacity = wheelOpacity < 1 ? wheelOpacity.toFixed(4) : "";
    titleLink.tabIndex = progress > FAN_END ? -1 : 0;
    wheel!.tabIndex = progress > FAN_END ? -1 : 0;
    dotBtns.forEach((btn) => {
      btn.tabIndex = progress > FAN_END ? -1 : 0;
    });

    if (displayProgress !== target || recoil < 1) schedule();
  }

  function schedule() {
    if (!frame && !reducedMotion.matches) frame = requestAnimationFrame(render);
  }

  function cancelJump() {
    if (jumpFrame) {
      cancelAnimationFrame(jumpFrame);
      jumpFrame = 0;
    }
  }

  function scrollToSlot(targetIndex: number) {
    const travel = section!.offsetHeight - pin!.clientHeight;
    if (travel <= 0 || last === 0) return;
    cancelJump();
    const progress = ENTRY_END + ((FAN_END - ENTRY_END) * targetIndex) / last;
    const dest = Math.max(
      0,
      Math.round(window.scrollY + section!.getBoundingClientRect().top + progress * travel),
    );
    const start = window.scrollY;
    const dist = dest - start;
    if (Math.abs(dist) < 2) {
      window.scrollTo({ top: dest, behavior: "instant" });
      schedule();
      return;
    }
    const startedAt = performance.now();
    const duration = 520;
    const tick = (now: number) => {
      const t = unit((now - startedAt) / duration);
      const eased = 1 - (1 - t) ** 3;
      window.scrollTo({ top: start + dist * eased, behavior: "instant" });
      schedule();
      if (t < 1) jumpFrame = requestAnimationFrame(tick);
      else jumpFrame = 0;
    };
    jumpFrame = requestAnimationFrame(tick);
  }

  // 悬停或聚焦任意已展开卡时，铭牌与计数即时预览该作品。
  cards.forEach(({ link }, index) => {
    const enter = () => {
      if (!slots[index].inert && !reducedMotion.matches) {
        hoveredIndex = index;
        syncDisplay();
      }
    };
    const leave = () => {
      if (hoveredIndex === index) {
        hoveredIndex = -1;
        syncDisplay();
      }
    };
    link.addEventListener("pointerenter", enter);
    link.addEventListener("pointerleave", leave);
    link.addEventListener("focus", enter);
    link.addEventListener("blur", leave);
  });

  dotBtns.forEach((btn, idx) => {
    btn.addEventListener("click", () => {
      keyboardTarget = idx;
      scrollToSlot(idx);
    });
  });

  section.addEventListener("keydown", (event) => {
    if (
      reducedMotion.matches ||
      (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
    )
      return;
    event.preventDefault();
    const next = Math.min(
      last,
      Math.max(
        0,
        (keyboardTarget ?? activeIndex) + (event.key === "ArrowRight" ? 1 : -1),
      ),
    );
    keyboardTarget = next;
    scrollToSlot(next);
  });

  const resetInteraction = () => {
    keyboardTarget = null;
    cancelJump();
  };
  window.addEventListener("wheel", resetInteraction, { passive: true });
  window.addEventListener("touchstart", resetInteraction, { passive: true });
  window.addEventListener("scrollend", () => {
    keyboardTarget = null;
  });
  window.addEventListener("scroll", schedule, { passive: true });

  const resize = new ResizeObserver(measure);
  resize.observe(pin);
  resize.observe(wheel);
  if (reviewOrbit) resize.observe(reviewOrbit);
  cards.forEach(({ link }) => resize.observe(link));

  cards.forEach(({ image }, index) => {
    const fitPoster = () => {
      if (image.naturalHeight) {
        slots[index].style.setProperty(
          "--pv-poster-ratio",
          String(image.naturalWidth / image.naturalHeight),
        );
        measure();
      }
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
      if (relayCover) relayCover.loading = "eager";
      preload.disconnect();
    },
    { rootMargin: "850px 0px" },
  );
  preload.observe(section);

  function syncPreference() {
    section!.classList.toggle("is-animated", !reducedMotion.matches);
    if (reducedMotion.matches) {
      cancelAnimationFrame(frame);
      cancelJump();
      frame = 0;
      previousFrame = 0;
      revealedThrough = -1;
      hoveredIndex = -1;
      recoilAt = -Infinity;
      wheel!.tabIndex = 0;
      wheel!.style.opacity = "";
      pin!.classList.remove("is-relay-pass");
      revealReviews(1, 1, 1, false);
      slots.forEach((slot, index) => {
        cards[index].entrance?.cancel();
        cards[index].entrance = null;
        slot.inert = false;
        cards[index].link.tabIndex = 0;
      });
    } else {
      measure();
      syncDisplay();
      render();
    }
  }

  reducedMotion.addEventListener("change", syncPreference);
  desktopRelayQuery.addEventListener("change", measure);
  syncPreference();
}
