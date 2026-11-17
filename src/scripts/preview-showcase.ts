interface ShowcaseEntry {
  id: number;
  name: string;
  nameCn: string;
  bangumiScore: number;
  rank: number | null;
  url: string;
  userScore: number;
  comment: string;
  updatedAt: string;
  largePath: string;
  thumbPath: string;
}

interface ShowcasePayload {
  reviews: ShowcaseEntry[];
  watchHistory: ShowcaseEntry[];
}

interface TimelineMonth {
  key: string;
  year: number;
  monthNum: number;
  shortLabel: string;
  entries: ShowcaseEntry[];
}

interface MorphRect {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

interface MorphAnchors {
  plateA: { cx: number; cy: number; size: number };
  plateB: { cx: number; cy: number; size: number };
  cardA: MorphRect;
  cardB: MorphRect;
}

interface RulerPoint {
  x: number;
  y: number;
  baseY: number;
  month: TimelineMonth;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

const escapeHtml = (value: string) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function mixColorRgb(a: [number, number, number], b: [number, number, number], t: number) {
  return `rgb(${Math.round(lerp(a[0], b[0], t))}, ${Math.round(lerp(a[1], b[1], t))}, ${Math.round(lerp(a[2], b[2], t))})`;
}

function fmtDate(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()} / ${String(d.getMonth() + 1).padStart(2, "0")} / ${String(d.getDate()).padStart(2, "0")}`;
}

function fmtMonthDay(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, "0")}月${String(d.getDate()).padStart(2, "0")}日`;
}

function formatProseHtml(raw: string) {
  const clean = String(raw || "").trim();
  if (!clean) return `<p class="pv-sc-prose is-empty">这一部没有写短评，只记录了评分。</p>`;
  const chunks = clean
    .split(/\s*\/\/\s*|\r?\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return chunks
    .map((line) => {
      const m = line.match(/^(ep\.?\s*\d+(?:\s*[-–~]\s*\d+)?)\s*(.*)$/i);
      if (m && m[2]) {
        return `<div class="pv-sc-ep-seg"><span class="pv-sc-ep-tag">${escapeHtml(m[1].toLowerCase())}</span><span>${escapeHtml(m[2])}</span></div>`;
      }
      return `<p>${escapeHtml(line)}</p>`;
    })
    .join("");
}

function buildMonthBuckets(entries: ShowcaseEntry[]): TimelineMonth[] {
  const now = new Date();
  const keys = entries.map((e) => e.updatedAt.slice(0, 7)).filter(Boolean).sort();
  const minYm = keys[0] || "2024-03";
  const currentYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const maxYm = (keys[keys.length - 1] || currentYm) > currentYm ? keys[keys.length - 1] : currentYm;
  const [minY, minM] = minYm.split("-").map(Number);
  const [maxY, maxM] = maxYm.split("-").map(Number);

  const grouped = new Map<string, ShowcaseEntry[]>();
  entries.forEach((item) => {
    const k = item.updatedAt.slice(0, 7);
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k)!.push(item);
  });

  const out: TimelineMonth[] = [];
  for (let y = minY, m = minM; y < maxY || (y === maxY && m <= maxM); ) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push({ key, year: y, monthNum: m, shortLabel: `${m}月`, entries: grouped.get(key) || [] });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

function catmullRomPath(pts: RulerPoint[]) {
  if (!pts.length) return "";
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const cp1y = Math.min(pts[0].baseY, Math.max(8, p1.y + (p2.y - p0.y) / 6));
    const cp2y = Math.min(pts[0].baseY, Math.max(8, p2.y - (p3.y - p1.y) / 6));
    d += ` C ${(p1.x + (p2.x - p0.x) / 6).toFixed(1)} ${cp1y.toFixed(1)}, ${(p2.x - (p3.x - p1.x) / 6).toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

function polaroidPose(slotIdx: number, total: number, spreadBias: number, fanOpen: number) {
  if (total === 1) {
    return { x: spreadBias * 8, y: -4, angle: (-2.5 + spreadBias * 2) * fanOpen, scale: 1.02, z: 20 };
  }
  if (slotIdx === 0) {
    return { x: spreadBias * 10, y: 2, angle: -2 + spreadBias * 3, scale: 1.02, z: 20 };
  }
  const side = slotIdx % 2 === 1 ? 1 : -1;
  const tier = Math.ceil(slotIdx / 2);
  const maxTier = Math.max(1, Math.ceil((total - 1) / 2));
  const u = tier / maxTier;
  const easeU = u ** 0.88;
  const maxX = total <= 3 ? 42 : total <= 5 ? 66 : 78;
  const maxAngle = total <= 3 ? 10.5 : total <= 5 ? 15.5 : 18.5;
  const maxDrop = total <= 3 ? 4 : total <= 5 ? 9 : 13;
  const spreadFactor = (1 + Math.abs(spreadBias) * 0.16) * fanOpen;
  return {
    x: side * easeU * maxX * spreadFactor + spreadBias * easeU * 14,
    y: (2 + u ** 1.35 * maxDrop) * fanOpen - Math.abs(spreadBias) * 2,
    angle: (side * easeU * maxAngle + spreadBias * 2.2) * fanOpen,
    scale: Math.max(0.86, 0.97 - easeU * 0.11),
    z: Math.max(1, 20 - slotIdx),
  };
}

function deckRestingPose(offset: number) {
  if (offset === 0) return { x: 0, y: 0, rot: 0, scale: 1, opacity: 1 };
  if (offset === 1) return { x: -28, y: -8, rot: -5.2, scale: 0.945, opacity: 0.96 };
  if (offset === 2) return { x: -54, y: -15, rot: -10.2, scale: 0.89, opacity: 0.88 };
  if (offset === 3) return { x: -76, y: -20, rot: -14.5, scale: 0.835, opacity: 0.74 };
  return { x: 140, y: -18, rot: 12, scale: 0.92, opacity: 0 };
}

function positionThumb(container: HTMLElement, thumb: HTMLElement | null, activeBtn: HTMLButtonElement | undefined) {
  if (!activeBtn || !thumb) return;
  const cRect = container.getBoundingClientRect();
  const bRect = activeBtn.getBoundingClientRect();
  thumb.style.width = `${bRect.width}px`;
  thumb.style.transform = `translateX(${bRect.left - cRect.left - 4}px)`;
}

export function setupPreviewShowcase() {
  const trackNode = document.querySelector<HTMLElement>("[data-pv-showcase]");
  const dataEl = trackNode?.querySelector<HTMLScriptElement>("[data-pv-showcase-data]");
  if (!trackNode || !dataEl) return;
  const track: HTMLElement = trackNode;

  let data: ShowcasePayload;
  try {
    data = JSON.parse(dataEl.textContent || "{}") as ShowcasePayload;
  } catch {
    return;
  }

  const reviews = data.reviews || [];
  const watchHistory = data.watchHistory || [];
  const reviewById = new Map(reviews.map((r) => [r.id, r]));

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const desktopHandoffQuery = window.matchMedia("(min-width: 961px) and (min-height: 680px)");

  const reviewAnchor = track.querySelector<HTMLElement>("[data-sc-reviews-anchor]")!;
  const memoriesAnchor = track.querySelector<HTMLElement>("[data-sc-memories-anchor]")!;
  const stagePin = track.querySelector<HTMLElement>("[data-sc-stage-pin]")!;
  const revSection = track.querySelector<HTMLElement>("[data-sc-reviews-section]")!;
  const reviewsTop = track.querySelector<HTMLElement>("[data-sc-reviews-top]")!;
  const deckZone = track.querySelector<HTMLElement>("[data-sc-deck-zone]")!;
  const reviewPlate = track.querySelector<HTMLElement>("[data-sc-review-plate]")!;
  const deckOrbit = track.querySelector<HTMLElement>("[data-sc-deck-orbit]")!;
  const deckBar = track.querySelector<HTMLElement>("[data-sc-deck-bar]")!;
  const folioCopy = track.querySelector<HTMLElement>("[data-sc-folio-copy]")!;

  const folioCounter = track.querySelector<HTMLElement>("[data-sc-folio-counter]")!;
  const folioDate = track.querySelector<HTMLTimeElement>("[data-sc-folio-date]")!;
  const folioRankInfo = track.querySelector<HTMLElement>("[data-sc-folio-rank]")!;
  const folioTitle = track.querySelector<HTMLElement>("[data-sc-folio-title]")!;
  const folioNative = track.querySelector<HTMLElement>("[data-sc-folio-native]")!;
  const folioScore = track.querySelector<HTMLElement>("[data-sc-folio-score]")!;
  const scoreBrush = track.querySelector<SVGSVGElement>("[data-sc-score-brush]")!;
  const folioDeltaText = track.querySelector<HTMLElement>("[data-sc-folio-delta]")!;
  const folioRulerFill = track.querySelector<HTMLElement>("[data-sc-ruler-fill]")!;
  const folioRulerBgm = track.querySelector<HTMLElement>("[data-sc-ruler-bgm]")!;
  const folioProse = track.querySelector<HTMLElement>("[data-sc-folio-prose]")!;
  const folioBgmLink = track.querySelector<HTMLAnchorElement>("[data-sc-bgm-link]")!;
  const filtersContainer = track.querySelector<HTMLElement>("[data-sc-filters]")!;
  const filterButtons = Array.from(track.querySelectorAll<HTMLButtonElement>("[data-sc-filters] .pv-sc-filter-btn"));
  const filterThumb = track.querySelector<HTMLElement>("[data-sc-filter-thumb]")!;

  const proxyPlate = track.querySelector<HTMLElement>("[data-sc-proxy-plate]")!;
  const proxyCard = track.querySelector<HTMLElement>("[data-sc-proxy-card]")!;
  const proxyImg = track.querySelector<HTMLImageElement>("[data-sc-proxy-img]")!;
  const proxyTitle = track.querySelector<HTMLElement>("[data-sc-proxy-title]")!;
  const proxyScore = track.querySelector<HTMLElement>("[data-sc-proxy-score]")!;

  const tlSection = track.querySelector<HTMLElement>("[data-sc-timeline-section]")!;
  const timelineTop = track.querySelector<HTMLElement>("[data-sc-timeline-top]")!;
  const polaroidStage = track.querySelector<HTMLElement>("[data-sc-polaroid-stage]")!;
  const polaroidRing = track.querySelector<HTMLElement>("[data-sc-polaroid-ring]")!;
  const polaroidDeck = track.querySelector<HTMLElement>("[data-sc-polaroid-deck]")!;
  const polaroidSleeve = track.querySelector<HTMLElement>("[data-sc-polaroid-sleeve]")!;
  const sleeveYear = track.querySelector<HTMLElement>("[data-sc-sleeve-year]")!;
  const timelineCopy = track.querySelector<HTMLElement>("[data-sc-timeline-copy]")!;
  const odoTens = track.querySelector<HTMLElement>("[data-sc-odo-tens]")!;
  const odoOnes = track.querySelector<HTMLElement>("[data-sc-odo-ones]")!;
  const tlYearLabel = track.querySelector<HTMLElement>("[data-sc-tl-year]")!;
  const tlCountLine = track.querySelector<HTMLElement>("[data-sc-tl-count]")!;
  const contactList = track.querySelector<HTMLUListElement>("[data-sc-contact-list]")!;
  const rulerInstrument = track.querySelector<HTMLElement>("[data-sc-ruler-instrument]")!;
  const rangeGroup = track.querySelector<HTMLElement>("[data-sc-range-group]")!;
  const rangeButtons = Array.from(track.querySelectorAll<HTMLButtonElement>("[data-sc-range-group] .pv-sc-range-btn"));
  const rangeThumb = track.querySelector<HTMLElement>("[data-sc-range-thumb]")!;
  const rulerScroll = track.querySelector<HTMLElement>("[data-sc-ruler-scroll]")!;
  const rulerCanvas = track.querySelector<HTMLElement>("[data-sc-ruler-canvas]")!;
  const rulerSvg = track.querySelector<SVGSVGElement>("[data-sc-ruler-svg]")!;
  const rulerCols = track.querySelector<HTMLElement>("[data-sc-ruler-cols]")!;
  const rulerLoupe = track.querySelector<HTMLElement>("[data-sc-loupe]")!;
  const rulerLoupeLine = track.querySelector<HTMLElement>("[data-sc-loupe-line]")!;
  const rulerCaption = track.querySelector<HTMLElement>("[data-sc-ruler-caption]")!;

  const archiveDrawer = track.querySelector<HTMLElement>("[data-sc-archive-drawer]")!;
  const archiveGrid = track.querySelector<HTMLElement>("[data-sc-archive-grid]")!;
  const archiveSearch = track.querySelector<HTMLInputElement>("[data-sc-archive-search]")!;
  const archiveSort = track.querySelector<HTMLSelectElement>("[data-sc-archive-sort]")!;
  const archiveTierChips = Array.from(track.querySelectorAll<HTMLButtonElement>("[data-sc-archive-chips] .pv-sc-drawer-chip"));

  const hasJournal = Boolean(document.querySelector("[data-pv-journal]"));
  let journalReveal = !hasJournal || reducedMotion.matches ? 1 : Number(revSection.style.getPropertyValue("--pv-review-reveal") || 0);
  if (revSection.dataset.journalReady === "true") journalReveal = 1;

  let filteredReviews = reviews.slice();
  let activeReviewIndex = 0;
  let isCardFlipped = false;
  let isCardFlipping = false;
  let flipEndTimer = 0;
  let tiltTargetX = 0;
  let tiltTargetY = 0;
  let tiltCurrX = 0;
  let tiltCurrY = 0;
  let dragDx = 0;
  let hoverTarget = 0;
  let hoverCurr = 0;
  let isDraggingDeck = false;
  let tiltRaf = 0;
  let deckGatherProgress = 0;
  let entryFanProgress = 1;
  let handoffProgress = 0;

  let archiveTier = "all";
  let lastTriggerEl: HTMLElement | null = null;

  const months = buildMonthBuckets(watchHistory);
  let visibleMonths: TimelineMonth[] = [];
  const defaultMonth = [...months].reverse().find((m) => m.entries.length > 0) || months[months.length - 1];
  let activeMonthKey = defaultMonth ? defaultMonth.key : "";
  let frontOrderOffset = 0;
  let hoveredAnimeId: number | null = null;
  let fanSpreadBias = 0;
  let scrollFanFactor = 1;
  let tlRange = "12";

  let rulerMetrics: RulerPoint[] = [];
  let loupeCurrX = 0;
  let loupeTargetX = 0;
  let loupeVisible = false;
  let rulerRaf = 0;
  let rulerCurveEl: SVGPathElement | null = null;
  let rulerAreaEl: SVGPathElement | null = null;

  let anchors: MorphAnchors | null = null;
  let motionRaf = 0;

  function syncProxyImage() {
    const item = filteredReviews[activeReviewIndex];
    if (!item) return;
    proxyImg.src = item.largePath;
    proxyTitle.textContent = item.nameCn || item.name || "";
    proxyScore.textContent = item.userScore ? `★${item.userScore.toFixed(1)}` : "—";
  }

  function applyCardTransforms(animateFlag: boolean) {
    const cards = Array.from(deckOrbit.querySelectorAll<HTMLElement>(".pv-sc-ticket-card"));
    const dragProgress = Math.min(1, Math.abs(dragDx) / 140);
    const gather = deckGatherProgress;
    const hExpand = hoverCurr * (1 - gather) * (isCardFlipped ? 0 : 1);
    const eP = easeOutCubic(clamp01(journalReveal / 0.72));
    const entryFan = reducedMotion.matches ? 1 : entryFanProgress;
    const rearOpen = entryFan * (1 - gather);

    cards.forEach((card) => {
      const offset = Number(card.dataset.offset);
      const pose = deckRestingPose(offset);
      let x = pose.x;
      let y = pose.y;
      let rot = pose.rot;
      let scale = pose.scale;
      let opacity = pose.opacity;

      if (offset === 0) {
        x += dragDx;
        y -= Math.abs(dragDx) * 0.05;
        rot += dragDx * 0.045;
        scale += 0.044 * hExpand;
        if (journalReveal < 0.995 && !reducedMotion.matches) {
          y += (1 - eP) * 28;
          scale *= 0.95 + 0.05 * eP;
          opacity = Math.min(1, journalReveal / 0.4);
          card.style.setProperty("--tilt-x", `${((1 - eP) * 6).toFixed(2)}deg`);
          card.style.setProperty("--tilt-y", "0deg");
          card.classList.toggle("is-tilting", eP < 0.99);
        } else if (!isDraggingDeck && !isCardFlipped && (tiltCurrX !== 0 || tiltCurrY !== 0)) {
          card.style.setProperty("--tilt-x", `${tiltCurrX.toFixed(2)}deg`);
          card.style.setProperty("--tilt-y", `${tiltCurrY.toFixed(2)}deg`);
        } else {
          card.style.setProperty("--tilt-x", "0deg");
          card.style.setProperty("--tilt-y", "0deg");
        }
      } else if (offset > 0) {
        const nextPose = deckRestingPose(offset - 1);
        x += (nextPose.x - pose.x) * dragProgress - tiltCurrY * offset * 0.14;
        y += (nextPose.y - pose.y) * dragProgress + tiltCurrX * offset * 0.12;
        rot += (nextPose.rot - pose.rot) * dragProgress;
        scale += (nextPose.scale - pose.scale) * dragProgress;
        x -= (3.2 + (offset - 1) * 1.4) * hExpand;
        y -= (2.8 + (offset - 1) * 1.0) * hExpand;
        rot -= offset * 0.45 * hExpand;
        scale += 0.026 * hExpand;
        x *= rearOpen;
        y *= rearOpen;
        rot *= rearOpen;
        scale = lerp(0.95, scale, rearOpen);
        opacity *= rearOpen;
      }

      card.style.transition =
        isDraggingDeck || !animateFlag || gather > 0 || hExpand > 0.002 || journalReveal < 0.995
          ? "none"
          : "transform 460ms var(--sc-ease), opacity 360ms ease";
      card.style.opacity = String(opacity.toFixed(3));
      if (
        offset === 0 &&
        !isDraggingDeck &&
        Math.abs(x) < 0.05 &&
        Math.abs(y) < 0.05 &&
        Math.abs(rot) < 0.02 &&
        Math.abs(scale - 1) < 0.001
      ) {
        card.style.transform = "none";
      } else {
        card.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) rotateZ(${rot.toFixed(2)}deg) scale(${scale.toFixed(3)})`;
      }
    });
  }

  function createTicketCard(item: ShowcaseEntry, idx: number, offset: number) {
    const card = document.createElement("div");
    card.className = "pv-sc-ticket-card";
    if (offset === 0 && isCardFlipped) card.classList.add("is-flipped");
    card.dataset.offset = String(offset);
    const bgm = item.bangumiScore ? item.bangumiScore.toFixed(1) : "暂无";
    const diff = item.bangumiScore ? item.userScore - item.bangumiScore : null;
    const diffStr =
      diff === null ? "—" : diff > 0.05 ? `+${diff.toFixed(1)}` : diff < -0.05 ? `${diff.toFixed(1)}` : "0.0";
    card.innerHTML = `
      <div class="pv-sc-ticket-flipper">
        <div class="pv-sc-ticket-face pv-sc-ticket-face--front">
          <div class="pv-sc-poster-wrap"><img src="${escapeHtml(item.largePath)}" alt="${escapeHtml(item.nameCn || item.name)}" draggable="false" /></div>
          <span class="pv-sc-corner-reticle" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
        </div>
        <div class="pv-sc-ticket-face pv-sc-ticket-face--back">
          <div class="pv-sc-postcard-head">
            <div class="pv-sc-postcard-serial">ARCHIVE NO. ${String(idx + 1).padStart(2, "0")}<br/>SUBJECT #${item.id}</div>
            <div class="pv-sc-postcard-stamp"><div>${item.userScore.toFixed(1)}<span>SCORE</span></div></div>
          </div>
          <div class="pv-sc-postcard-titles"><h4>${escapeHtml(item.nameCn || item.name)}</h4><p>${escapeHtml(item.name)}</p></div>
          <dl class="pv-sc-postcard-specs">
            <div><dt>我的评分</dt><dd>${item.userScore.toFixed(1)} / 10</dd></div>
            <div><dt>Bangumi 均分</dt><dd>${bgm} (${diffStr})</dd></div>
            <div><dt>全站排名</dt><dd>${item.rank ? `#${item.rank}` : "暂无"}</dd></div>
            <div><dt>记录日期</dt><dd>${item.updatedAt ? item.updatedAt.slice(0, 10) : "暂无"}</dd></div>
          </dl>
          <div class="pv-sc-postcard-foot"><span>点击翻回封面</span><a class="pv-sc-postcard-bgm" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">Bangumi ↗</a></div>
        </div>
      </div>`;
    return card;
  }

  function startTiltLoop() {
    if (tiltRaf || reducedMotion.matches) return;
    const tick = () => {
      tiltCurrX += (tiltTargetX - tiltCurrX) * 0.16;
      tiltCurrY += (tiltTargetY - tiltCurrY) * 0.16;
      hoverCurr += (hoverTarget - hoverCurr) * 0.18;
      if (!isDraggingDeck) applyCardTransforms(false);
      const stillMoving =
        Math.abs(tiltTargetX - tiltCurrX) > 0.04 ||
        Math.abs(tiltTargetY - tiltCurrY) > 0.04 ||
        Math.abs(hoverTarget - hoverCurr) > 0.008;
      if (stillMoving) tiltRaf = requestAnimationFrame(tick);
      else {
        tiltCurrX = tiltTargetX;
        tiltCurrY = tiltTargetY;
        hoverCurr = hoverTarget;
        applyCardTransforms(false);
        if (tiltCurrX === 0 && tiltCurrY === 0 && hoverCurr === 0 && journalReveal >= 0.995) {
          deckOrbit.querySelector('.pv-sc-ticket-card[data-offset="0"]')?.classList.remove("is-tilting");
        }
        tiltRaf = 0;
      }
    };
    tiltRaf = requestAnimationFrame(tick);
  }

  function toggleFrontCardFlip() {
    if (journalReveal < 0.995) return;
    const front = deckOrbit.querySelector<HTMLElement>('.pv-sc-ticket-card[data-offset="0"]');
    if (!front) return;
    const flipper = front.querySelector<HTMLElement>(".pv-sc-ticket-flipper");
    if (flipEndTimer) {
      clearTimeout(flipEndTimer);
      flipEndTimer = 0;
    }
    if (tiltRaf) {
      cancelAnimationFrame(tiltRaf);
      tiltRaf = 0;
    }
    isCardFlipped = !isCardFlipped;
    isCardFlipping = true;
    tiltTargetX = 0;
    tiltTargetY = 0;
    tiltCurrX = 0;
    tiltCurrY = 0;
    hoverTarget = 0;
    hoverCurr = 0;
    front.classList.remove("is-tilting", "is-hovered");
    deckZone.classList.remove("is-deck-hovered");
    front.classList.add("is-flipping");
    applyCardTransforms(false);
    if (flipper) void flipper.offsetWidth;
    front.classList.toggle("is-flipped", isCardFlipped);
    if (reducedMotion.matches) {
      isCardFlipping = false;
      front.classList.remove("is-flipping");
      return;
    }
    flipEndTimer = window.setTimeout(() => {
      flipEndTimer = 0;
      isCardFlipping = false;
      front.classList.remove("is-flipping");
    }, 680);
  }

  function stepReview(dir: number) {
    const n = filteredReviews.length;
    if (n <= 1) return;
    const outgoing = deckOrbit.querySelector<HTMLElement>('.pv-sc-ticket-card[data-offset="0"]');
    if (outgoing && !reducedMotion.matches && dir > 0) {
      outgoing.animate(
        [
          { transform: outgoing.style.transform === "none" ? "translate3d(0,0,0)" : outgoing.style.transform, opacity: 1 },
          { transform: "translate3d(-240px, -24px, 0) rotateZ(-16deg) scale(0.94)", opacity: 0 },
        ],
        { duration: 220, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "forwards" },
      );
    }
    if (flipEndTimer) {
      clearTimeout(flipEndTimer);
      flipEndTimer = 0;
    }
    if (tiltRaf) {
      cancelAnimationFrame(tiltRaf);
      tiltRaf = 0;
    }
    activeReviewIndex = (activeReviewIndex + dir + n) % n;
    isCardFlipped = false;
    isCardFlipping = false;
    tiltTargetX = 0;
    tiltTargetY = 0;
    tiltCurrX = 0;
    tiltCurrY = 0;
    hoverTarget = 0;
    hoverCurr = 0;
    dragDx = 0;
    deckZone.classList.remove("is-deck-hovered");
    window.setTimeout(() => {
      renderDeck(true, dir);
      renderFolioCopy(true);
      syncProxyImage();
    }, reducedMotion.matches || dir < 0 ? 0 : 110);
  }

  function jumpToReview(targetIdx: number) {
    if (targetIdx === activeReviewIndex) return;
    if (flipEndTimer) {
      clearTimeout(flipEndTimer);
      flipEndTimer = 0;
    }
    if (tiltRaf) {
      cancelAnimationFrame(tiltRaf);
      tiltRaf = 0;
    }
    const n = filteredReviews.length;
    const chosenDir = (targetIdx - activeReviewIndex + n) % n <= n / 2 ? 1 : -1;
    activeReviewIndex = targetIdx;
    isCardFlipped = false;
    isCardFlipping = false;
    tiltTargetX = 0;
    tiltTargetY = 0;
    tiltCurrX = 0;
    tiltCurrY = 0;
    hoverTarget = 0;
    hoverCurr = 0;
    dragDx = 0;
    deckZone.classList.remove("is-deck-hovered");
    renderDeck(true, chosenDir);
    renderFolioCopy(true);
    syncProxyImage();
  }

  function bindFrontCardInteractions(card: HTMLElement) {
    card.querySelector(".pv-sc-postcard-bgm")?.addEventListener("click", (e) => e.stopPropagation());
    card.addEventListener("pointerenter", () => {
      if (isDraggingDeck || isCardFlipped || isCardFlipping || journalReveal < 0.995) return;
      hoverTarget = 1;
      card.classList.add("is-hovered");
      deckZone.classList.add("is-deck-hovered");
      if (reducedMotion.matches) {
        hoverCurr = 1;
        applyCardTransforms(false);
      } else {
        startTiltLoop();
      }
    });
    card.addEventListener("pointermove", (e) => {
      if (isDraggingDeck || isCardFlipped || isCardFlipping || reducedMotion.matches || journalReveal < 0.995) return;
      hoverTarget = 1;
      card.classList.add("is-tilting", "is-hovered");
      deckZone.classList.add("is-deck-hovered");
      const rect = card.getBoundingClientRect();
      tiltTargetX = (0.5 - (e.clientY - rect.top) / rect.height) * 9;
      tiltTargetY = ((e.clientX - rect.left) / rect.width - 0.5) * 11;
      startTiltLoop();
    });
    card.addEventListener("pointerleave", () => {
      if (isDraggingDeck || isCardFlipping || isCardFlipped) return;
      tiltTargetX = 0;
      tiltTargetY = 0;
      hoverTarget = 0;
      card.classList.remove("is-hovered");
      deckZone.classList.remove("is-deck-hovered");
      if (reducedMotion.matches) {
        hoverCurr = 0;
        applyCardTransforms(false);
      } else {
        startTiltLoop();
      }
    });
    card.addEventListener("pointerdown", (e) => {
      if ((e.target as Element).closest("a, button") || journalReveal < 0.995) return;
      const startX = e.clientX;
      const startY = e.clientY;
      let moved = false;
      let lastX = startX;
      let lastT = performance.now();
      let vx = 0;
      card.setPointerCapture(e.pointerId);
      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!moved && Math.hypot(dx, dy) > 7) {
          moved = true;
          isDraggingDeck = true;
          card.classList.add("is-dragging");
          revSection.classList.add("is-travelling");
        }
        if (!moved) return;
        const now = performance.now();
        vx = (ev.clientX - lastX) / Math.max(8, now - lastT);
        lastX = ev.clientX;
        lastT = now;
        dragDx = dx;
        applyCardTransforms(false);
      };
      const onUp = () => {
        card.removeEventListener("pointermove", onMove);
        card.removeEventListener("pointerup", onUp);
        card.removeEventListener("pointercancel", onUp);
        card.classList.remove("is-dragging");
        revSection.classList.remove("is-travelling");
        isDraggingDeck = false;
        if (!moved) {
          toggleFrontCardFlip();
          return;
        }
        const flingScore = dragDx + vx * 160;
        if (Math.abs(flingScore) > 85 && filteredReviews.length > 1) stepReview(flingScore < 0 ? 1 : -1);
        else {
          dragDx = 0;
          applyCardTransforms(true);
        }
      };
      card.addEventListener("pointermove", onMove);
      card.addEventListener("pointerup", onUp);
      card.addEventListener("pointercancel", onUp);
    });
  }

  function renderDeck(animateFlag = true, enterDir = 0) {
    const n = filteredReviews.length;
    deckOrbit.innerHTML = "";
    if (!n) return;
    const visibleOffsets = Math.min(4, n);
    for (let off = visibleOffsets - 1; off >= 0; off--) {
      const idx = (activeReviewIndex + off) % n;
      const card = createTicketCard(filteredReviews[idx], idx, off);
      if (off === 0) bindFrontCardInteractions(card);
      deckOrbit.appendChild(card);
    }
    if (enterDir !== 0 && !reducedMotion.matches) {
      Array.from(deckOrbit.querySelectorAll<HTMLElement>(".pv-sc-ticket-card")).forEach((card) => {
        const off = Number(card.dataset.offset);
        const fromPose =
          off === 0 && enterDir < 0
            ? { x: -175, y: -14, rot: -10, scale: 0.94, opacity: 0.25 }
            : deckRestingPose(Math.min(3, off + (enterDir > 0 ? 1 : 0)));
        card.style.transition = "none";
        card.style.opacity = String(fromPose.opacity);
        card.style.transform = `translate3d(${fromPose.x}px, ${fromPose.y}px, 0) rotateZ(${fromPose.rot}deg) scale(${fromPose.scale})`;
      });
      void deckOrbit.offsetWidth;
      requestAnimationFrame(() => applyCardTransforms(true));
    } else {
      applyCardTransforms(animateFlag);
    }
  }

  function renderFolioCopy(animateFlag = true) {
    const item = filteredReviews[activeReviewIndex];
    if (!item) return;
    folioCounter.innerHTML = `<strong>${String(activeReviewIndex + 1).padStart(2, "0")}</strong> / ${filteredReviews.length}`;
    folioDate.dateTime = item.updatedAt;
    folioDate.textContent = fmtDate(item.updatedAt);
    folioRankInfo.textContent = item.bangumiScore ? `BGM ${item.bangumiScore.toFixed(1)}${item.rank ? ` · #${item.rank}` : ""}` : "暂无均分";
    folioTitle.textContent = item.nameCn || item.name;
    folioNative.textContent = item.nameCn && item.name !== item.nameCn ? item.name : "";
    folioScore.textContent = item.userScore.toFixed(1);
    folioBgmLink.href = item.url;
    folioRulerFill.style.width = `${Math.max(0, Math.min(100, item.userScore * 10))}%`;
    if (item.bangumiScore) {
      folioRulerBgm.hidden = false;
      folioRulerBgm.style.left = `${item.bangumiScore * 10}%`;
      const delta = item.userScore - item.bangumiScore;
      folioDeltaText.textContent = `${item.bangumiScore.toFixed(1)} (${delta >= 0 ? "+" : ""}${delta.toFixed(1)})`;
    } else {
      folioRulerBgm.hidden = true;
      folioDeltaText.textContent = "暂无";
    }
    folioProse.innerHTML = formatProseHtml(item.comment);
    if (animateFlag && !reducedMotion.matches) {
      folioCopy.classList.remove("is-entering");
      scoreBrush.classList.remove("is-drawing");
      void folioCopy.offsetWidth;
      folioCopy.classList.add("is-entering");
      scoreBrush.classList.add("is-drawing");
    }
  }

  function applyReviewFilter(filterKey: string) {
    filterButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.filter === filterKey)));
    positionThumb(filtersContainer, filterThumb, filterButtons.find((b) => b.dataset.filter === filterKey));
    if (filterKey === "love") filteredReviews = reviews.filter((r) => r.userScore >= 9);
    else if (filterKey === "long") filteredReviews = reviews.filter((r) => (r.comment || "").trim().length >= 60);
    else if (filterKey === "strict") filteredReviews = reviews.filter((r) => r.userScore <= 5);
    else filteredReviews = reviews.slice();

    if (flipEndTimer) {
      clearTimeout(flipEndTimer);
      flipEndTimer = 0;
    }
    if (tiltRaf) {
      cancelAnimationFrame(tiltRaf);
      tiltRaf = 0;
    }
    activeReviewIndex = 0;
    isCardFlipped = false;
    isCardFlipping = false;
    tiltTargetX = 0;
    tiltTargetY = 0;
    tiltCurrX = 0;
    tiltCurrY = 0;
    hoverTarget = 0;
    hoverCurr = 0;
    dragDx = 0;
    deckZone.classList.remove("is-deck-hovered");
    renderDeck(true, 0);
    renderFolioCopy(false);
    syncProxyImage();
  }

  function renderArchiveGrid() {
    const query = archiveSearch.value.trim().toLowerCase();
    const sortBy = archiveSort.value;
    const list = reviews.filter((r) => {
      if (archiveTier === "9-10" && r.userScore < 9) return false;
      if (archiveTier === "7-8" && (r.userScore < 7 || r.userScore >= 9)) return false;
      if (archiveTier === "0-6" && r.userScore >= 7) return false;
      if (archiveTier === "commented" && !(r.comment || "").trim()) return false;
      if (query && !`${r.nameCn} ${r.name} ${r.comment}`.toLowerCase().includes(query)) return false;
      return true;
    });
    if (sortBy === "score-desc") list.sort((a, b) => b.userScore - a.userScore || b.updatedAt.localeCompare(a.updatedAt));
    else if (sortBy === "score-asc") list.sort((a, b) => a.userScore - b.userScore || a.updatedAt.localeCompare(b.updatedAt));
    else if (sortBy === "diff-desc") {
      list.sort(
        (a, b) =>
          (b.bangumiScore ? Math.abs(b.userScore - b.bangumiScore) : -1) -
          (a.bangumiScore ? Math.abs(a.userScore - a.bangumiScore) : -1),
      );
    }
    archiveGrid.innerHTML = "";
    if (!list.length) {
      archiveGrid.innerHTML = `<p style="color:var(--sc-muted);padding:24px 0">没有找到符合条件的记录。</p>`;
      return;
    }
    list.forEach((item, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pv-sc-drawer-ticket";
      btn.style.setProperty("--tilt", `${i % 3 === 0 ? -0.9 : i % 3 === 1 ? 0.8 : -0.4}deg`);
      btn.innerHTML = `<img src="${escapeHtml(item.thumbPath)}" alt="" loading="lazy" /><div class="pv-sc-drawer-body"><div class="pv-sc-drawer-meta"><time>${fmtDate(item.updatedAt)}</time><span class="pv-sc-drawer-score">★ ${item.userScore.toFixed(1)}</span></div><h4>${escapeHtml(item.nameCn || item.name)}</h4><p class="pv-sc-drawer-excerpt">${escapeHtml((item.comment || "").replace(/\s+/g, " ").trim() || "暂无短评。")}</p></div>`;
      btn.addEventListener("click", () => {
        applyReviewFilter("all");
        const targetIdx = filteredReviews.findIndex((r) => r.id === item.id);
        if (targetIdx >= 0) jumpToReview(targetIdx);
        closeArchiveDrawer();
        const targetY = Math.round(window.scrollY + reviewAnchor.getBoundingClientRect().top);
        window.scrollTo({ top: targetY, behavior: reducedMotion.matches ? "auto" : "smooth" });
      });
      archiveGrid.appendChild(btn);
    });
  }

  function openArchiveDrawer() {
    lastTriggerEl = document.activeElement as HTMLElement | null;
    renderArchiveGrid();
    archiveDrawer.hidden = false;
    document.body.style.overflow = "hidden";
    archiveSearch.focus();
  }

  function closeArchiveDrawer() {
    archiveDrawer.hidden = true;
    document.body.style.overflow = "";
    lastTriggerEl?.focus?.();
  }

  function getMonthObj(key: string) {
    return months.find((m) => m.key === key) || months[months.length - 1];
  }

  function jumpToReviewSubject(subjectId: number) {
    const rev = reviewById.get(subjectId);
    if (!rev) return false;
    applyReviewFilter("all");
    const idx = filteredReviews.findIndex((r) => r.id === subjectId);
    if (idx >= 0) jumpToReview(idx);
    const targetY = Math.round(window.scrollY + reviewAnchor.getBoundingClientRect().top);
    window.scrollTo({ top: targetY, behavior: reducedMotion.matches ? "auto" : "smooth" });
    return true;
  }

  function applyPolaroidPositions(animateCards = true) {
    const cards = Array.from(polaroidDeck.querySelectorAll<HTMLElement>(".pv-sc-polaroid-card"));
    const total = cards.length;
    cards.forEach((card) => {
      const slot = Number(card.dataset.slot);
      const id = Number(card.dataset.animeId);
      const pose = polaroidPose(slot, total, fanSpreadBias, scrollFanFactor);
      const isHovered = hoveredAnimeId === id;
      card.style.zIndex = isHovered ? "26" : String(pose.z);
      card.style.transition = animateCards
        ? "transform 420ms var(--sc-ease), box-shadow 240ms ease, border-color 240ms ease"
        : "none";
      card.classList.toggle("is-synced-hover", isHovered);
      card.style.opacity = slot === 0 ? "1" : String(Math.min(1, Math.max(0, (scrollFanFactor - 0.15) / 0.55)).toFixed(3));
      card.style.transform = `translate(-50%, -50%) translate3d(${pose.x.toFixed(1)}px, ${(pose.y + (isHovered ? -14 : 0)).toFixed(1)}px, 0) rotate(${pose.angle.toFixed(2)}deg) scale(${(pose.scale * (isHovered ? 1.055 : 1)).toFixed(3)})`;
    });
    contactList.querySelectorAll<HTMLElement>(".pv-sc-contact-btn").forEach((btn) => {
      btn.classList.toggle("is-synced-hover", Number(btn.dataset.animeId) === hoveredAnimeId);
    });
  }

  function renderPolaroidDeck(direction = 0) {
    const m = getMonthObj(activeMonthKey);
    polaroidDeck.innerHTML = "";
    if (!m || !m.entries.length) {
      const empty = document.createElement("div");
      empty.className = "pv-sc-polaroid-empty";
      empty.innerHTML = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/></svg><strong>留白的一页</strong><span>${m ? m.key.replace("-", ".") : ""} 暂无新增观看记录</span>`;
      polaroidDeck.appendChild(empty);
      return;
    }
    const len = m.entries.length;
    m.entries.map((_, i) => m.entries[(i + frontOrderOffset) % len]).forEach((entry, slot) => {
      const fig = document.createElement("figure");
      fig.className = "pv-sc-polaroid-card";
      fig.dataset.slot = String(slot);
      fig.dataset.animeId = String(entry.id);
      fig.innerHTML = `<div class="pv-sc-polaroid-card-img"><img src="${escapeHtml(entry.largePath)}" alt="${escapeHtml(entry.nameCn || entry.name)}" draggable="false" /></div><figcaption><span class="pv-sc-polaroid-card-title">${escapeHtml(entry.nameCn || entry.name)}</span><span class="pv-sc-polaroid-card-score">${entry.userScore ? `★${entry.userScore.toFixed(1)}` : "—"}</span></figcaption>`;
      fig.addEventListener("pointerenter", () => {
        hoveredAnimeId = entry.id;
        applyPolaroidPositions(true);
      });
      fig.addEventListener("pointerleave", () => {
        if (hoveredAnimeId === entry.id) hoveredAnimeId = null;
        applyPolaroidPositions(true);
      });
      fig.addEventListener("click", (e) => {
        e.stopPropagation();
        if (slot !== 0) {
          frontOrderOffset = (frontOrderOffset + slot) % len;
          renderPolaroidDeck(0);
          return;
        }
        if (!jumpToReviewSubject(entry.id)) window.open(entry.url, "_blank", "noopener,noreferrer");
      });
      polaroidDeck.appendChild(fig);
    });
    applyPolaroidPositions(false);
    if (direction !== 0 && !reducedMotion.matches) {
      Array.from(polaroidDeck.querySelectorAll<HTMLElement>(".pv-sc-polaroid-card")).forEach((card, i) => {
        const dest = card.style.transform;
        card.animate(
          [
            {
              opacity: 0,
              transform: `translate(-50%, -50%) translate3d(${direction * 38}px, 24px, 0) rotate(${direction * 8}deg) scale(0.9)`,
            },
            { opacity: 1, transform: dest },
          ],
          { duration: 420, delay: i * 42, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "backwards" },
        );
      });
    }
  }

  function animateOdometerDigit(slotEl: HTMLElement, newChar: string, direction: number) {
    const oldEl = slotEl.querySelector(".pv-sc-odo-digit");
    if (oldEl && oldEl.textContent === newChar) return;
    const fresh = document.createElement("span");
    fresh.className = "pv-sc-odo-digit";
    fresh.textContent = newChar;
    slotEl.innerHTML = "";
    slotEl.appendChild(fresh);
    if (!reducedMotion.matches && direction && oldEl) {
      fresh.animate(
        [
          { transform: `translateY(${direction > 0 ? "100%" : "-100%"})`, opacity: 0.2 },
          { transform: "translateY(0%)", opacity: 1 },
        ],
        { duration: 340, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
      );
    }
  }

  function renderTimelineDetails(direction = 0) {
    const m = getMonthObj(activeMonthKey);
    if (!m) return;
    const mmStr = String(m.monthNum).padStart(2, "0");
    animateOdometerDigit(odoTens, mmStr[0], direction);
    animateOdometerDigit(odoOnes, mmStr[1], direction);
    tlYearLabel.textContent = String(m.year);
    sleeveYear.textContent = String(m.year);
    if (m.entries.length) {
      tlCountLine.innerHTML = `收录 <strong>${m.entries.length}</strong> 部动画`;
      contactList.hidden = false;
      contactList.innerHTML = "";
      m.entries.forEach((entry) => {
        const li = document.createElement("li");
        li.className = "pv-sc-contact-item";
        const rev = reviewById.get(entry.id);
        li.innerHTML = `<button class="pv-sc-contact-btn" type="button" data-anime-id="${entry.id}"><img src="${escapeHtml(entry.thumbPath)}" alt="" loading="lazy" /><span class="pv-sc-contact-text"><strong>${escapeHtml(entry.nameCn || entry.name)}</strong><span>${fmtMonthDay(entry.updatedAt)} 记录</span></span><span class="pv-sc-contact-score ${entry.userScore ? "" : "is-none"}">${entry.userScore ? `★ ${entry.userScore.toFixed(1)}` : "未评分"}</span><span class="pv-sc-contact-action">${rev ? "短评 ↑" : "BGM ↗"}</span></button>`;
        const btn = li.querySelector("button")!;
        btn.addEventListener("pointerenter", () => {
          hoveredAnimeId = entry.id;
          applyPolaroidPositions(true);
        });
        btn.addEventListener("pointerleave", () => {
          if (hoveredAnimeId === entry.id) hoveredAnimeId = null;
          applyPolaroidPositions(true);
        });
        btn.addEventListener("click", () => {
          if (!jumpToReviewSubject(entry.id)) window.open(entry.url, "_blank", "noopener,noreferrer");
        });
        contactList.appendChild(li);
      });
    } else {
      tlCountLine.innerHTML = "暂无观看记录";
      contactList.hidden = true;
    }
  }

  function renderRuler() {
    visibleMonths = tlRange === "12" ? months.slice(-12) : tlRange === "24" ? months.slice(-24) : months.slice();
    if (!visibleMonths.length) return;
    if (!visibleMonths.some((m) => m.key === activeMonthKey)) activeMonthKey = visibleMonths[visibleMonths.length - 1].key;
    rulerCaption.textContent = `${visibleMonths[0].key.replace("-", ".")} — ${visibleMonths[visibleMonths.length - 1].key.replace("-", ".")}`;
    const minColW = visibleMonths.length > 24 ? 46 : visibleMonths.length > 12 ? 52 : 66;
    const canvasW = Math.max(rulerScroll.clientWidth || 900, visibleMonths.length * minColW);
    rulerCanvas.style.width = `${canvasW}px`;
    const svgH = 112;
    const padTop = 18;
    const baseY = 98;
    const maxCnt = Math.max(...visibleMonths.map((m) => m.entries.length), 1);
    const colW = canvasW / visibleMonths.length;
    const pts: RulerPoint[] = visibleMonths.map((m, i) => ({
      x: (i + 0.5) * colW,
      y: baseY - (m.entries.length / maxCnt) * (baseY - padTop),
      baseY,
      month: m,
    }));
    rulerMetrics = pts;
    const curveD = catmullRomPath(pts);
    const areaD = `${curveD} L ${pts[pts.length - 1].x.toFixed(1)} ${baseY} L ${pts[0].x.toFixed(1)} ${baseY} Z`;
    let yearLines = "";
    pts.forEach((p, i) => {
      if ((i === 0 && p.month.monthNum <= 11) || p.month.monthNum === 1) {
        const x = i * colW + (i === 0 ? 6 : 0);
        yearLines += `<line class="pv-sc-ruler-year-divider" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="6" y2="${baseY}" /><text class="pv-sc-ruler-year-tag" x="${(x + 6).toFixed(1)}" y="16">${p.month.year}</text>`;
      }
    });
    rulerSvg.setAttribute("viewBox", `0 0 ${canvasW} ${svgH}`);
    rulerSvg.innerHTML = `<line class="pv-sc-ruler-grid" x1="0" x2="${canvasW}" y1="${baseY}" y2="${baseY}" /><line class="pv-sc-ruler-grid" x1="0" x2="${canvasW}" y1="${(baseY + padTop) * 0.5}" y2="${(baseY + padTop) * 0.5}" />${yearLines}<path class="pv-sc-ruler-area" data-sc-ruler-area d="${areaD}" /><path class="pv-sc-ruler-curve" data-sc-ruler-curve d="${curveD}" />`;
    rulerCurveEl = rulerSvg.querySelector("[data-sc-ruler-curve]");
    rulerAreaEl = rulerSvg.querySelector("[data-sc-ruler-area]");
    rulerCols.style.gridTemplateColumns = `repeat(${visibleMonths.length}, minmax(0, 1fr))`;
    rulerCols.innerHTML = "";
    pts.forEach((p) => {
      const m = p.month;
      const colBtn = document.createElement("button");
      colBtn.type = "button";
      colBtn.className = "pv-sc-ruler-col";
      colBtn.dataset.monthKey = m.key;
      colBtn.setAttribute("aria-pressed", String(m.key === activeMonthKey));
      colBtn.setAttribute("aria-label", `${m.year}年${m.monthNum}月：${m.entries.length}部动画`);
      colBtn.innerHTML = `<span class="pv-sc-ruler-dot ${m.entries.length === 0 ? "is-zero" : ""}" style="bottom:${(146 - p.y - 4.5).toFixed(1)}px"></span><span class="pv-sc-ruler-col-label">${m.shortLabel}</span>`;
      colBtn.addEventListener("click", () => selectTimelineMonth(m.key));
      rulerCols.appendChild(colBtn);
    });
  }

  function updateRulerMagnet() {
    rulerRaf = 0;
    loupeCurrX += (loupeTargetX - loupeCurrX) * 0.24;
    if (loupeVisible) {
      rulerLoupe.style.left = `${loupeCurrX.toFixed(1)}px`;
      rulerLoupeLine.style.left = `${loupeCurrX.toFixed(1)}px`;
      const colEls = Array.from(rulerCols.children) as HTMLElement[];
      let nearest = rulerMetrics[0];
      let bestDist = Infinity;
      rulerMetrics.forEach((pt, idx) => {
        const d = Math.abs(pt.x - loupeCurrX);
        if (d < bestDist) {
          bestDist = d;
          nearest = pt;
        }
        const influence = Math.max(0, 1 - d / 115);
        const dotEl = colEls[idx]?.querySelector<HTMLElement>(".pv-sc-ruler-dot");
        const labelEl = colEls[idx]?.querySelector<HTMLElement>(".pv-sc-ruler-col-label");
        if (dotEl) {
          dotEl.style.setProperty("--mag-y", `${(-influence * 7).toFixed(1)}px`);
          dotEl.style.setProperty("--mag-scale", (1 + influence * 0.65).toFixed(2));
        }
        if (labelEl) {
          labelEl.style.setProperty("--label-y", `${(-influence * 2.5).toFixed(1)}px`);
        }
      });
      if (nearest) {
        const m = nearest.month;
        rulerLoupe.textContent = `${m.year}.${String(m.monthNum).padStart(2, "0")} · ${m.entries.length}部`;
      }
      if (Math.abs(loupeTargetX - loupeCurrX) > 0.4) rulerRaf = requestAnimationFrame(updateRulerMagnet);
    } else {
      Array.from(rulerCols.children).forEach((col) => {
        const dotEl = col.querySelector<HTMLElement>(".pv-sc-ruler-dot");
        const labelEl = col.querySelector<HTMLElement>(".pv-sc-ruler-col-label");
        dotEl?.style.setProperty("--mag-y", "0px");
        dotEl?.style.setProperty("--mag-scale", "1");
        labelEl?.style.setProperty("--label-y", "0px");
      });
    }
  }

  function selectTimelineMonth(key: string) {
    if (key === activeMonthKey) return;
    const direction = months.findIndex((m) => m.key === key) >= months.findIndex((m) => m.key === activeMonthKey) ? 1 : -1;
    activeMonthKey = key;
    frontOrderOffset = 0;
    hoveredAnimeId = null;
    rulerCols.querySelectorAll(".pv-sc-ruler-col").forEach((col) => {
      col.setAttribute("aria-pressed", String((col as HTMLElement).dataset.monthKey === activeMonthKey));
    });
    renderPolaroidDeck(direction);
    renderTimelineDetails(direction);
    measureMorphAnchors();
  }

  function setTimelineRange(nextRange: string) {
    tlRange = nextRange;
    rangeButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.range === nextRange)));
    positionThumb(rangeGroup, rangeThumb, rangeButtons.find((b) => b.dataset.range === nextRange));
    renderRuler();
    const activeCol = rulerCols.querySelector<HTMLElement>(`[data-month-key="${activeMonthKey}"]`);
    if (activeCol && rulerScroll.scrollWidth > rulerScroll.clientWidth) {
      const targetLeft = activeCol.offsetLeft - rulerScroll.clientWidth * 0.65;
      rulerScroll.scrollTo({
        left: Math.max(0, Math.min(rulerScroll.scrollWidth - rulerScroll.clientWidth, targetLeft)),
        behavior: reducedMotion.matches ? "auto" : "smooth",
      });
    }
    renderPolaroidDeck(0);
    renderTimelineDetails(0);
  }

  function stepMonthRelative(delta: number) {
    if (!visibleMonths.length) return;
    const idx = visibleMonths.findIndex((m) => m.key === activeMonthKey);
    const nextIdx = Math.max(0, Math.min(visibleMonths.length - 1, idx + delta));
    if (nextIdx !== idx) selectTimelineMonth(visibleMonths[nextIdx].key);
  }

  function updateStaticAnchors() {
    if (desktopHandoffQuery.matches && !reducedMotion.matches) {
      memoriesAnchor.style.top = "";
      return;
    }
    const topPx = tlSection.getBoundingClientRect().top - track.getBoundingClientRect().top;
    memoriesAnchor.style.top = `${Math.max(0, Math.round(topPx))}px`;
  }

  function measureMorphAnchors() {
    updateStaticAnchors();
    if (!desktopHandoffQuery.matches || reducedMotion.matches) {
      anchors = null;
      return;
    }
    const pinRect = stagePin.getBoundingClientRect();
    const pA = reviewPlate.getBoundingClientRect();
    const pB = polaroidRing.getBoundingClientRect();
    const cA = deckOrbit.getBoundingClientRect();

    const frontPol =
      polaroidDeck.querySelector<HTMLElement>(".pv-sc-polaroid-card[data-slot='0']") ||
      polaroidDeck.querySelector<HTMLElement>(".pv-sc-polaroid-empty");
    const stageRect = polaroidStage.getBoundingClientRect();
    const baseW = frontPol ? frontPol.offsetWidth : 210;
    const baseH = frontPol ? frontPol.offsetHeight : 300;
    anchors = {
      plateA: { cx: pA.left - pinRect.left + pA.width / 2, cy: pA.top - pinRect.top + pA.height / 2, size: pA.width },
      plateB: { cx: pB.left - pinRect.left + pB.width / 2, cy: pB.top - pinRect.top + pB.height / 2, size: pB.width },
      cardA: { cx: cA.left - pinRect.left + cA.width / 2, cy: cA.top - pinRect.top + cA.height / 2, w: cA.width, h: cA.height },
      cardB: {
        cx: stageRect.left - pinRect.left + stageRect.width * 0.5,
        cy: stageRect.top - pinRect.top + stageRect.height * 0.43 + 1.5,
        w: baseW * 1.02,
        h: baseH * 1.02,
      },
    };
  }

  function applyEntryMotion(r: number) {
    const brushPath = scoreBrush.querySelector<SVGPathElement>("path");
    const activeReview = filteredReviews[activeReviewIndex];
    const targetScorePct = activeReview ? Math.max(0, Math.min(100, activeReview.userScore * 10)) : 0;

    if (reducedMotion.matches || r >= 0.995) {
      entryFanProgress = 1;
      reviewsTop.style.opacity = "";
      reviewsTop.style.transform = "";
      reviewPlate.style.opacity = "";
      reviewPlate.style.transform = "";
      deckBar.style.opacity = "";
      deckBar.style.transform = "";
      folioCopy.style.opacity = "";
      folioCopy.style.transform = "";
      folioRulerFill.style.width = `${targetScorePct}%`;
      if (brushPath) brushPath.style.removeProperty("--brush-offset");
      applyCardTransforms(false);
      return;
    }

    const eP = easeOutCubic(clamp01(r / 0.72));
    const barP = easeOutCubic(clamp01((r - 0.36) / 0.54));
    const fillP = easeOutCubic(clamp01((r - 0.32) / 0.56));
    const brushP = easeOutCubic(clamp01((r - 0.52) / 0.48));
    entryFanProgress = easeOutCubic(clamp01((r - 0.3) / 0.7));

    reviewsTop.style.opacity = String(eP.toFixed(3));
    reviewsTop.style.transform = `translateY(${((1 - eP) * 18).toFixed(1)}px)`;

    reviewPlate.style.opacity = String(Math.min(1, r / 0.42).toFixed(3));
    reviewPlate.style.transform = `translateX(${(-22 + (1 - eP) * 38).toFixed(1)}px) scale(${(0.84 + 0.16 * eP).toFixed(3)})`;

    deckBar.style.opacity = String(barP.toFixed(3));
    deckBar.style.transform = `translateY(${((1 - barP) * 12).toFixed(1)}px)`;

    folioCopy.style.opacity = String(clamp01((r - 0.12) / 0.65).toFixed(3));
    folioCopy.style.transform = `translateY(${((1 - eP) * 24).toFixed(1)}px)`;
    folioRulerFill.style.width = `${(targetScorePct * fillP).toFixed(2)}%`;

    if (brushPath) brushPath.style.setProperty("--brush-offset", (120 * (1 - brushP)).toFixed(1));
    applyCardTransforms(false);
  }

  function updateMotion() {
    motionRaf = 0;
    const isDesktop = desktopHandoffQuery.matches && !reducedMotion.matches;
    revSection.dataset.scHandoff = isDesktop ? "sticky" : "static";

    // Keep stage backdrop transparent until PreviewJournal wave finishes filling #f2f3ed
    const backdropReady = !hasJournal || reducedMotion.matches || journalReveal >= 0.985;
    stagePin.classList.toggle("is-backdrop-ready", backdropReady);

    if (!isDesktop) {
      stagePin.style.removeProperty("--morph-bg");
      deckOrbit.style.opacity = "";
      proxyPlate.style.opacity = "0";
      proxyCard.style.opacity = "0";
      revSection.inert = journalReveal < 1;
      tlSection.style.opacity = "1";
      tlSection.style.pointerEvents = "auto";
      tlSection.inert = false;
      timelineTop.style.transform = "";
      timelineTop.style.opacity = "";
      timelineCopy.style.transform = "";
      timelineCopy.style.opacity = "";
      polaroidRing.style.opacity = "1";
      polaroidDeck.style.opacity = "";
      polaroidSleeve.style.opacity = "1";
      polaroidSleeve.style.transform = "";
      rulerInstrument.style.transform = "";
      rulerInstrument.style.opacity = "";
      if (rulerCurveEl) rulerCurveEl.style.clipPath = "";
      if (rulerAreaEl) rulerAreaEl.style.opacity = "";
      deckGatherProgress = 0;
      scrollFanFactor = 1;
      applyEntryMotion(journalReveal);
      applyPolaroidPositions(false);
      return;
    }

    const rTop = reviewAnchor.getBoundingClientRect().top;
    const mTop = memoriesAnchor.getBoundingClientRect().top;
    const travel = Math.max(1, mTop - rTop);
    const p = clamp01(-rTop / travel);
    handoffProgress = p;

    if (p <= 0.002) {
      stagePin.style.setProperty("--morph-bg", "0");
      proxyPlate.style.opacity = "0";
      proxyCard.style.opacity = "0";
      deckOrbit.style.opacity = "1";
      polaroidRing.style.opacity = "0";
      tlSection.style.opacity = "0";
      tlSection.style.pointerEvents = "none";
      tlSection.inert = true;
      deckGatherProgress = 0;
      revSection.inert = journalReveal < 1;
      applyEntryMotion(journalReveal);
      return;
    }

    // Entered Plan C handoff (p > 0 -> Plan A entry is guaranteed complete)
    if (journalReveal < 1) journalReveal = 1;
    entryFanProgress = 1;
    applyEntryMotion(1);

    stagePin.style.setProperty("--morph-bg", clamp01((p - 0.12) / 0.56).toFixed(4));

    const clearP = easeOutCubic(clamp01(p / 0.36));
    reviewsTop.style.transform = `translateY(${(-clearP * 26).toFixed(1)}px)`;
    reviewsTop.style.opacity = String((1 - clearP).toFixed(3));
    folioCopy.style.transform = `translateY(${(-clearP * 34).toFixed(1)}px)`;
    folioCopy.style.opacity = String((1 - clearP).toFixed(3));
    deckBar.style.opacity = String(Math.max(0, 1 - clearP * 1.4).toFixed(3));
    revSection.inert = p > 0.05;

    const nextGather = clamp01(p / 0.22);
    if (Math.abs(nextGather - deckGatherProgress) > 0.005 || nextGather === 0 || nextGather === 1) {
      deckGatherProgress = nextGather;
      applyCardTransforms(false);
    }

    if (!anchors) measureMorphAnchors();
    const morphT = easeInOutCubic(clamp01((p - 0.1) / 0.58));
    const proxyActive = p > 0.015 && p < 0.8 && Boolean(anchors);

    if (proxyActive && anchors) {
      reviewPlate.style.opacity = "0";
      deckOrbit.style.opacity = p < 0.07 ? String(1 - (p - 0.015) / 0.055) : "0";
      polaroidRing.style.opacity = "0";

      const arcSin = Math.sin(morphT * Math.PI);
      const pSize = lerp(anchors.plateA.size, anchors.plateB.size, morphT) * (1 + arcSin * 0.09);
      const pCx = lerp(anchors.plateA.cx, anchors.plateB.cx, morphT) + arcSin * 36;
      const pCy = lerp(anchors.plateA.cy, anchors.plateB.cy, morphT) - arcSin * 12;
      proxyPlate.style.opacity = "1";
      proxyPlate.style.width = `${pSize.toFixed(1)}px`;
      proxyPlate.style.height = `${pSize.toFixed(1)}px`;
      proxyPlate.style.left = `${(pCx - pSize / 2).toFixed(1)}px`;
      proxyPlate.style.top = `${(pCy - pSize / 2).toFixed(1)}px`;
      proxyPlate.style.background = mixColorRgb([233, 237, 229], [221, 232, 220], morphT);
      proxyPlate.style.borderColor = mixColorRgb([220, 227, 216], [211, 224, 211], morphT);

      const cCx = lerp(anchors.cardA.cx, anchors.cardB.cx, morphT) + arcSin * 62;
      const cCy = lerp(anchors.cardA.cy, anchors.cardB.cy, morphT) - arcSin * 28;
      const cW = lerp(anchors.cardA.w, anchors.cardB.w, morphT);
      const cH = lerp(anchors.cardA.h, anchors.cardB.h, morphT);
      const pad = lerp(10, 8, morphT);
      const capProg = clamp01((morphT - 0.36) / 0.5);
      const rotZ = lerp(0, -2, morphT) - arcSin * 5.2;
      const rotY = -arcSin * 17;
      const handoffFade = p > 0.66 ? 1 - clamp01((p - 0.66) / 0.14) : 1;

      proxyCard.style.opacity = String(handoffFade.toFixed(3));
      proxyCard.style.width = `${cW.toFixed(1)}px`;
      proxyCard.style.height = `${cH.toFixed(1)}px`;
      proxyCard.style.left = `${(cCx - cW / 2).toFixed(1)}px`;
      proxyCard.style.top = `${(cCy - cH / 2).toFixed(1)}px`;
      proxyCard.style.padding = `${pad.toFixed(1)}px ${pad.toFixed(1)}px ${lerp(10, 0, capProg).toFixed(1)}px`;
      proxyCard.style.borderRadius = `${lerp(10, 5, morphT).toFixed(1)}px`;
      proxyCard.style.setProperty("--cap-h", `${(capProg * 33).toFixed(1)}px`);
      proxyCard.style.setProperty("--cap-op", capProg.toFixed(3));
      proxyCard.style.transform = `perspective(1200px) rotateY(${rotY.toFixed(2)}deg) rotateZ(${rotZ.toFixed(2)}deg)`;
    } else {
      proxyPlate.style.opacity = "0";
      proxyCard.style.opacity = "0";
      reviewPlate.style.opacity = p <= 0.015 ? "1" : "0";
      deckOrbit.style.opacity = p <= 0.015 ? "1" : "0";
      polaroidRing.style.opacity = p >= 0.8 ? "1" : "0";
    }

    const rightIn = easeOutCubic(clamp01((p - 0.2) / 0.46));
    const deckIn = clamp01((p - 0.64) / 0.16);
    const sleeveIn = easeOutCubic(clamp01((p - 0.44) / 0.3));

    if (rightIn <= 0) {
      tlSection.style.opacity = "0";
      tlSection.style.pointerEvents = "none";
      tlSection.inert = true;
    } else {
      tlSection.style.opacity = "1";
      tlSection.style.pointerEvents = p > 0.86 ? "auto" : "none";
      tlSection.inert = p <= 0.86;

      polaroidDeck.style.opacity = String(deckIn.toFixed(3));
      polaroidSleeve.style.opacity = String(sleeveIn.toFixed(3));
      polaroidSleeve.style.transform = `translateX(-50%) translateY(${((1 - sleeveIn) * 20).toFixed(1)}px) rotate(-1.5deg)`;

      scrollFanFactor = easeOutCubic(clamp01((p - 0.66) / 0.28));
      applyPolaroidPositions(false);

      timelineTop.style.opacity = String(rightIn.toFixed(3));
      timelineTop.style.transform = `translateY(${((1 - rightIn) * 22).toFixed(1)}px)`;
      timelineCopy.style.opacity = String(rightIn.toFixed(3));
      timelineCopy.style.transform = `translateY(${((1 - rightIn) * 32).toFixed(1)}px)`;

      const rulerIn = easeOutCubic(clamp01((p - 0.26) / 0.48));
      rulerInstrument.style.opacity = String(Math.min(1, rulerIn * 1.4).toFixed(3));
      rulerInstrument.style.transform = `translateY(${((1 - rulerIn) * 18).toFixed(1)}px)`;
      if (rulerCurveEl) rulerCurveEl.style.clipPath = `inset(0 ${((1 - rulerIn) * 100).toFixed(1)}% 0 0)`;
      if (rulerAreaEl) rulerAreaEl.style.opacity = String(rulerIn.toFixed(3));
    }
  }

  function scheduleMotion() {
    if (!motionRaf) motionRaf = requestAnimationFrame(updateMotion);
  }

  // Bind UI & Scroll Events
  filterButtons.forEach((btn) => btn.addEventListener("click", () => applyReviewFilter(btn.dataset.filter || "all")));
  track.querySelector("[data-sc-prev]")?.addEventListener("click", () => stepReview(-1));
  track.querySelector("[data-sc-next]")?.addEventListener("click", () => stepReview(1));
  deckZone.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      stepReview(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      stepReview(-1);
    } else if (e.key === " ") {
      e.preventDefault();
      toggleFrontCardFlip();
    }
  });

  track.querySelector("[data-sc-open-archive]")?.addEventListener("click", openArchiveDrawer);
  track.querySelector("[data-sc-close-archive]")?.addEventListener("click", closeArchiveDrawer);
  archiveDrawer.addEventListener("click", (e) => {
    if (e.target === archiveDrawer) closeArchiveDrawer();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !archiveDrawer.hidden) closeArchiveDrawer();
  });
  archiveTierChips.forEach((chip) => {
    chip.addEventListener("click", () => {
      archiveTier = chip.dataset.tier || "all";
      archiveTierChips.forEach((c) => c.setAttribute("aria-pressed", String(c === chip)));
      renderArchiveGrid();
    });
  });
  archiveSearch.addEventListener("input", renderArchiveGrid);
  archiveSort.addEventListener("change", renderArchiveGrid);

  polaroidStage.addEventListener("pointermove", (e) => {
    if (reducedMotion.matches) return;
    const rect = polaroidStage.getBoundingClientRect();
    fanSpreadBias = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
    applyPolaroidPositions(true);
  });
  polaroidStage.addEventListener("pointerleave", () => {
    fanSpreadBias = 0;
    applyPolaroidPositions(true);
  });
  polaroidStage.addEventListener("pointerdown", (e) => {
    if ((e.target as Element).closest("a, button")) return;
    const startX = e.clientX;
    polaroidStage.classList.add("is-scrubbing");
    const onUp = (ev: PointerEvent) => {
      polaroidStage.removeEventListener("pointerup", onUp);
      polaroidStage.classList.remove("is-scrubbing");
      const dx = ev.clientX - startX;
      if (Math.abs(dx) > 40) stepMonthRelative(dx < 0 ? 1 : -1);
    };
    polaroidStage.addEventListener("pointerup", onUp);
  });
  polaroidStage.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      stepMonthRelative(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      stepMonthRelative(-1);
    }
  });

  rulerCanvas.addEventListener("pointerenter", (e) => {
    if (reducedMotion.matches) return;
    const rect = rulerCanvas.getBoundingClientRect();
    loupeCurrX = loupeTargetX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    loupeVisible = true;
    rulerLoupe.classList.add("is-visible");
    rulerLoupeLine.classList.add("is-visible");
    if (!rulerRaf) rulerRaf = requestAnimationFrame(updateRulerMagnet);
  });
  rulerCanvas.addEventListener("pointermove", (e) => {
    if (reducedMotion.matches) return;
    const rect = rulerCanvas.getBoundingClientRect();
    loupeTargetX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    loupeVisible = true;
    if (!rulerRaf) rulerRaf = requestAnimationFrame(updateRulerMagnet);
  });
  rulerCanvas.addEventListener("pointerleave", () => {
    loupeVisible = false;
    rulerLoupe.classList.remove("is-visible");
    rulerLoupeLine.classList.remove("is-visible");
    if (!rulerRaf) rulerRaf = requestAnimationFrame(updateRulerMagnet);
  });
  rulerCanvas.addEventListener("pointerdown", (e) => {
    if ((e.target as Element).closest(".pv-sc-ruler-col")) return;
    const startX = e.clientX;
    const startScroll = rulerScroll.scrollLeft;
    const onMove = (ev: PointerEvent) => {
      rulerScroll.scrollLeft = startScroll - (ev.clientX - startX);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });
  rangeButtons.forEach((b) =>
    b.addEventListener("click", () => {
      if (b.dataset.range) setTimelineRange(b.dataset.range);
    }),
  );

  // Sync smoothly with PreviewJournal reveal progress
  revSection.addEventListener("pv:review-reveal", (ev) => {
    const detail = (ev as CustomEvent<{ progress: number }>).detail;
    if (!detail) return;
    journalReveal = detail.progress;
    if (handoffProgress <= 0.002) {
      updateMotion();
    } else {
      scheduleMotion();
    }
  });

  window.addEventListener("scroll", scheduleMotion, { passive: true });
  const handleLayoutChange = () => {
    positionThumb(filtersContainer, filterThumb, filterButtons.find((b) => b.getAttribute("aria-pressed") === "true"));
    positionThumb(rangeGroup, rangeThumb, rangeButtons.find((b) => b.getAttribute("aria-pressed") === "true"));
    renderRuler();
    measureMorphAnchors();
    updateMotion();
  };
  window.addEventListener("resize", handleLayoutChange, { passive: true });
  desktopHandoffQuery.addEventListener("change", handleLayoutChange);
  reducedMotion.addEventListener("change", handleLayoutChange);

  // Initialize cleanly
  applyReviewFilter("all");
  setTimelineRange("12");
  renderPolaroidDeck(0);
  renderTimelineDetails(0);
  syncProxyImage();
  measureMorphAnchors();
  updateMotion();
}
