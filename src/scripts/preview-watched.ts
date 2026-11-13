/** 最近看过使用原生横向滚动，按钮和键盘按可见海报数量翻动。 */
export function setupPreviewWatched() {
  const rail = document.querySelector<HTMLElement>("[data-pv-watched-rail]");
  if (!rail) return;
  const cards = Array.from(rail.querySelectorAll<HTMLElement>(".pv-watched-card"));
  const previous = document.querySelector<HTMLButtonElement>("[data-pv-watched-prev]");
  const next = document.querySelector<HTMLButtonElement>("[data-pv-watched-next]");
  const count = document.querySelector<HTMLElement>("[data-pv-watched-count]");
  const progress = document.querySelector<HTMLElement>("[data-pv-watched-progress]");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let frame = 0;

  /** 从实际可见位置更新范围和边界，拖动滚动条、触摸和按钮共用同一状态。 */
  function sync() {
    frame = 0;
    const viewport = rail!.getBoundingClientRect();
    const visible = cards.map((card, index) => ({ index, rect: card.getBoundingClientRect() }))
      .filter(({ rect }) => rect.left < viewport.right - rect.width * .25 && rect.right > viewport.left + rect.width * .25);
    if (count && visible.length) {
      const first = String(visible[0].index + 1).padStart(2, "0");
      const last = String(visible.at(-1)!.index + 1).padStart(2, "0");
      count.textContent = `${first === last ? first : `${first}–${last}`} / ${String(cards.length).padStart(2, "0")}`;
    }
    const maxScroll = rail!.scrollWidth - rail!.clientWidth;
    if (previous) previous.disabled = rail!.scrollLeft <= 2;
    if (next) next.disabled = rail!.scrollLeft >= maxScroll - 2;
    if (progress) {
      const fraction = rail!.clientWidth / rail!.scrollWidth;
      progress.style.width = `${fraction * 100}%`;
      progress.style.transform = `translateX(${rail!.scrollLeft / rail!.clientWidth * 100}%)`;
    }
  }

  /** 保留纵向滚轮浏览整页，只在明确的左右操作时切换海报。 */
  function move(direction: number) {
    const stride = cards.length > 1 ? cards[1].offsetLeft - cards[0].offsetLeft : rail!.clientWidth;
    const pageSize = Math.max(1, Math.round(rail!.clientWidth / stride));
    const index = Math.round(rail!.scrollLeft / stride) + direction * pageSize;
    rail!.scrollTo({ left: index * stride, behavior: reducedMotion.matches ? "instant" : "smooth" });
  }

  /** 合并触摸或平滑滚动的密集事件，一帧只读取一次布局。 */
  function scheduleSync() {
    if (!frame) frame = requestAnimationFrame(sync);
  }

  previous?.addEventListener("click", () => move(-1));
  next?.addEventListener("click", () => move(1));
  rail.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    move(event.key === "ArrowLeft" ? -1 : 1);
  });
  rail.addEventListener("scroll", scheduleSync, { passive: true });
  new ResizeObserver(scheduleSync).observe(rail);
  sync();
}
