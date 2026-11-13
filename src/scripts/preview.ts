import { setupPreviewMotion } from "./preview-motion";
import { setupPreviewJournal } from "./preview-watched";
import { setupPreviewSnap } from "./preview-snap";

/** 宽屏下同步图表坐标和月份点击区，避免固定高度让折线挤在画布中央。 */
function setupPreviewTimelineScale() {
  document.querySelectorAll<HTMLElement>(".pv-memories .timeline-chart-canvas").forEach((canvas) => {
    const svg = canvas.querySelector<SVGSVGElement>("svg")!;
    const buttons = Array.from(canvas.querySelectorAll<HTMLButtonElement>("[data-timeline-month]"));
    const circles = Array.from(svg.querySelectorAll<SVGCircleElement>("[data-point-month]"));
    const line = svg.querySelector<SVGPolylineElement>("polyline")!;
    const area = svg.querySelector<SVGPolygonElement>("polygon")!;
    const baseHeight = svg.viewBox.baseVal.height;
    const baseline = area.points.getItem(0).y;
    const marker = svg.querySelector<SVGGElement>("[data-timeline-marker]")!;
    const guide = svg.querySelector<SVGLineElement>("[data-timeline-guide]")!;
    const observer = new ResizeObserver(() => {
      const width = canvas.clientWidth;
      if (!width) return;
      svg.setAttribute("viewBox", `0 0 ${width} ${baseHeight}`);
      svg.setAttribute("preserveAspectRatio", "none");
      canvas.dataset.chartWidth = String(width);
      const points = buttons.map((button, index) => {
        const x = 24 + (index + .5) * (width - 48) / buttons.length;
        const y = Number(button.dataset.pointY);
        button.dataset.pointX = String(x);
        circles[index].setAttribute("cx", String(x));
        if (button.getAttribute("aria-pressed") === "true") {
          marker.style.transform = `translate(${x}px, ${y}px)`;
          guide.style.transform = `translateX(${x}px)`;
        }
        return `${x},${y}`;
      }).join(" ");
      line.setAttribute("points", points);
      area.setAttribute("points", `24,${baseline} ${points} ${width - 24},${baseline}`);
      svg.querySelectorAll(".timeline-grid-line").forEach((grid) => grid.setAttribute("x2", String(width - 24)));
      // 窗口收窄或切换范围后保留当前月份，避免手机只显示年初却选中了年末。
      const selected = buttons.find((button) => button.getAttribute("aria-pressed") === "true");
      const scroller = canvas.parentElement!;
      const selectedX = Number(selected?.dataset.pointX);
      if (selected && (selectedX < scroller.scrollLeft + 24 || selectedX > scroller.scrollLeft + scroller.clientWidth - 24)) {
        scroller.scrollLeft = selectedX - scroller.clientWidth * .7;
      }
    });
    observer.observe(canvas);
  });
}

setupPreviewSnap();
setupPreviewMotion();
setupPreviewJournal();
setupPreviewTimelineScale();
