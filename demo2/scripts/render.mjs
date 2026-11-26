import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEMO_ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));
const SNAPSHOT_PATH = resolve(DEMO_ROOT, "data/essays.json");
const ENTRIES_DIR = resolve(DEMO_ROOT, "entries");

const CN_DATE = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" });
const EN_DATE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "2-digit",
  year: "numeric",
  timeZone: "Asia/Shanghai",
});

/** 跨篇色彩轮换表（新增日志自动按序号循环适配，无需人工配置）。 */
const THEME_CYCLE = [
  { bg: "74, 31, 42", fg: "244, 206, 216", accent: "#B83644" },
  { bg: "27, 57, 44", fg: "213, 235, 217", accent: "#2F6F4E" },
  { bg: "27, 49, 68", fg: "212, 230, 244", accent: "#2E627C" },
  { bg: "56, 45, 36", fg: "240, 228, 212", accent: "#9B5634" },
];

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[ch]);
}

function formatDates(iso) {
  const d = new Date(iso);
  const cn = CN_DATE.format(d);
  const [year, month, day] = cn.split("-");
  return {
    iso: cn,
    year,
    dot: `${year}.${month}.${day}`,
    en: EN_DATE.format(d),
  };
}

function splitParagraphs(content) {
  return String(content || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** 选取开篇节选段落（约 420–560 字，按自然段截止），让右侧栏有自然充实的阅读滚动行程。 */
function buildExcerptParagraphs(paragraphs) {
  const picked = [];
  let total = 0;
  for (let i = 0; i < paragraphs.length; i += 1) {
    const p = paragraphs[i];
    if (picked.length > 0 && (total + p.length > 600 || picked.length >= 7)) break;
    picked.push(p);
    total += p.length;
    if (total >= 420) break;
  }
  return {
    items: picked,
    truncated: picked.length < paragraphs.length,
  };
}

/** 优先日志附图，没有附图则自动回落至 Bangumi 番剧海报。 */
function pickPrimaryVisual(essay) {
  return (
    essay.gallery.find((g) => g.kind === "attachment") ||
    essay.gallery.find((g) => g.kind === "poster") ||
    essay.gallery[0] ||
    null
  );
}

function googleFontsHead() {
  return `  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400&family=JetBrains+Mono:wght@400;500&family=Noto+Sans+SC:wght@400;500;600&family=Noto+Serif+SC:wght@400;500;600&display=swap">`;
}

function renderIndexPage(snapshot) {
  const { profile, essays, syncedAt } = snapshot;
  const syncDate = formatDates(syncedAt).dot;
  const years = [...new Set(essays.map((e) => formatDates(e.publishedAt).year))];

  const marqueeHtml = essays
    .map((essay, idx) => {
      const work = essay.subjects[0]?.displayName || essay.title;
      const year = formatDates(essay.publishedAt).year;
      return `<button type="button" class="sc-marquee-item${idx === 0 ? " is-active" : ""}" data-marquee-item="edition-${essay.id}"><span>${esc(work)}</span><sup>(${year})</sup></button>`;
    })
    .join("\n        ");

  const editionsHtml = essays
    .map((essay, idx) => {
      const no = String(idx + 1).padStart(2, "0");
      const dates = formatDates(essay.publishedAt);
      const paragraphs = splitParagraphs(essay.content);
      const theme = THEME_CYCLE[idx % THEME_CYCLE.length];
      const primarySubject = essay.subjects[0];
      const workName = primarySubject?.displayName || "动画长评";
      const origName = primarySubject?.originalName || "";
      const heroAsset = pickPrimaryVisual(essay);
      const articleHref = `entries/${essay.id}.html`;
      const scoreText = primarySubject?.userScore ? `${primarySubject.userScore.toFixed(1)} / 10` : "已收录";

      const shortQuotes = essay.subjects.filter((s) => s.userComment);
      const echoHtml = shortQuotes.length
        ? `<div class="ed-echo-grid${shortQuotes.length === 1 ? " is-single" : ""}">
            ${shortQuotes
              .map(
                (s) => `<article class="ed-echo-card">
                  <span class="ed-echo-mark" aria-hidden="true">“</span>
                  <div class="ed-echo-source">SHORT REVIEW · 《${esc(s.displayName)}》</div>
                  <p class="ed-echo-body">${esc(s.userComment).replace(/\n/g, "<br>")}</p>
                  <div class="ed-echo-foot">BANGUMI 短评 · ${s.userScore ? `${s.userScore.toFixed(1)} / 10` : "—"}</div>
                </article>`,
              )
              .join("\n            ")}
          </div>`
        : "";

      const firstGallery = essay.gallery[0];
      const firstNeedsContain =
        firstGallery && (firstGallery.kind === "poster" || firstGallery.width / firstGallery.height <= 1.05);
      const excerpt = buildExcerptParagraphs(paragraphs);
      const creditLines = primarySubject?.info?.raw
        ? [
            primarySubject.info.episodes && `话数：${primarySubject.info.episodes}`,
            primarySubject.info.airDate && `首播：${primarySubject.info.airDate}`,
            primarySubject.info.director && `监督：${primarySubject.info.director}`,
            primarySubject.info.originalWork && `原作：${primarySubject.info.originalWork}`,
            primarySubject.info.characterDesign && `人设：${primarySubject.info.characterDesign}`,
          ].filter(Boolean)
        : [];

      return `<section
        id="edition-${essay.id}"
        class="essay-edition"
        data-theme-section
        data-theme-bg="${theme.bg}"
        data-theme-fg="${theme.fg}"
        data-essay-no="${no}"
        data-essay-date="${dates.dot}"
        data-essay-work="${esc(workName)}"
        data-essay-score="${primarySubject?.userScore ? primarySubject.userScore.toFixed(1) : ""}"
        data-essay-href="${articleHref}"
        aria-labelledby="title-${essay.id}"
      >
        <div class="ed-split">
          <div class="ed-stage-col">
            <div class="ed-stage-plate" data-parallax-plate>
              ${
                heroAsset
                  ? `<img
                      class="ed-stage-backdrop"
                      data-parallax-backdrop
                      src="assets/${esc(heroAsset.file)}"
                      alt="${esc(heroAsset.caption || workName)}"
                      width="${heroAsset.width}"
                      height="${heroAsset.height}"
                      ${idx === 0 ? 'fetchpriority="high"' : 'loading="lazy"'}
                    >`
                  : ""
              }
              ${
                heroAsset
                  ? `<button
                      type="button"
                      class="ed-stage-zoom"
                      data-zoom-src="assets/${esc(heroAsset.file)}"
                      data-zoom-caption="${esc(heroAsset.caption || workName)}"
                      aria-label="放大查看《${esc(workName)}》配图"
                    >
                      <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                        <circle cx="11" cy="11" r="7" />
                        <path d="m20 20-3.5-3.5M11 8v6M8 11h6" />
                      </svg>
                    </button>`
                  : ""
              }
            </div>
          </div>

          <div class="ed-rail-col">
            <div class="ed-block">
              <p class="ed-kicker">[ ESSAY ${no} · ${dates.dot} ]</p>
              <h2 class="ed-title" id="title-${essay.id}"><a href="${articleHref}">${esc(essay.title)}</a></h2>
            </div>

            <div class="ed-block">
              <p class="ed-kicker">[ EXCERPT ]</p>
              <div class="ed-excerpt-group">
                ${excerpt.items.map((p, pIdx) => `<p class="ed-excerpt">${esc(p)}${excerpt.truncated && pIdx === excerpt.items.length - 1 ? " ……" : ""}</p>`).join("\n                ")}
              </div>

              <div class="ed-ledger" aria-label="长评信息与阅读入口">
                <a class="ed-ledger-row" href="${articleHref}">
                  <span class="ed-ledger-label">阅读完整长评</span>
                  <span class="ed-ledger-val">${essay.charCount.toLocaleString("zh-CN")} 字 · 约 ${essay.readMinutes} 分钟 ↗</span>
                </a>
                <div class="ed-ledger-row">
                  <span class="ed-ledger-label">我的评分</span>
                  <span class="ed-ledger-val">${esc(scoreText)}${primarySubject?.bangumiScore ? ` · BGM ${primarySubject.bangumiScore.toFixed(1)}` : ""}</span>
                </div>
                ${essay.subjects
                  .map(
                    (s) => `<a class="ed-ledger-row" href="${esc(s.url)}" target="_blank" rel="noreferrer">
                      <span class="ed-ledger-label">关联条目 — ${esc(s.displayName)}</span>
                      <span class="ed-ledger-val">${esc(s.platform)}${s.bangumiRank ? ` · #${s.bangumiRank}` : ""} ↗</span>
                    </a>`,
                  )
                  .join("\n                ")}
                <a class="ed-ledger-row" href="${esc(essay.blogUrl)}" target="_blank" rel="noreferrer">
                  <span class="ed-ledger-label">Bangumi 原文</span>
                  <span class="ed-ledger-val">blog/${essay.id}${essay.replies ? ` · ${essay.replies} 回复` : ""} ↗</span>
                </a>
              </div>

              <div class="ed-pills">
                <a class="ed-pill ed-pill--solid" href="${articleHref}">+ 阅读全文 +</a>
                <a class="ed-pill" href="#colophon-${essay.id}">↖ 作品档案 ↗</a>
              </div>
            </div>

            ${
              creditLines.length
                ? `<div class="ed-block">
                    <p class="ed-kicker">[ SUBJECT INFO ]</p>
                    <ul class="ed-rail-info">
                      ${creditLines.map((line) => `<li>${esc(line)}</li>`).join("\n                      ")}
                    </ul>
                  </div>`
                : ""
            }

            <div class="ed-block">
              <p class="ed-kicker">[ RECORD ]</p>
              <ul class="ed-rail-info">
                <li>发表时间：${dates.dot}（${dates.en}）</li>
                <li>正文篇幅：${essay.charCount.toLocaleString("zh-CN")} 字 · 约 ${essay.readMinutes} 分钟</li>
                ${primarySubject?.userScore ? `<li>我的评分：${primarySubject.userScore.toFixed(1)} / 10</li>` : ""}
                ${
                  primarySubject?.bangumiScore
                    ? `<li>Bangumi：${primarySubject.bangumiScore.toFixed(2)} 分${primarySubject.bangumiRank ? `（#${primarySubject.bangumiRank}）` : ""}</li>`
                    : ""
                }
              </ul>
            </div>
          </div>
        </div>

        <div class="ed-expansion" id="colophon-${essay.id}">
          ${echoHtml}

          <div class="ed-colophon">
            <div>
              <p class="ed-kicker">[ ARCHIVE · 作品档案 ]</p>
              <div class="ed-specs">
                <div class="ed-spec-group">
                  <div class="ed-spec-key">[ SUBJECTS ]</div>
                  <ul class="ed-spec-list">
                    ${essay.subjects
                      .map(
                        (s) =>
                          `<li><a href="${esc(s.url)}" target="_blank" rel="noreferrer">${esc(s.displayName)}</a>${s.originalName ? `（${esc(s.originalName)}）` : ""}</li>`,
                      )
                      .join("\n                    ")}
                  </ul>
                </div>

                ${
                  primarySubject?.info?.raw
                    ? `<div class="ed-spec-group">
                        <div class="ed-spec-key">[ CREDITS ]</div>
                        <ul class="ed-spec-list">
                          ${[
                            primarySubject.info.episodes && `话数：${primarySubject.info.episodes}`,
                            primarySubject.info.airDate && `首播：${primarySubject.info.airDate}`,
                            primarySubject.info.director && `监督：${primarySubject.info.director}`,
                            primarySubject.info.originalWork && `原作：${primarySubject.info.originalWork}`,
                            primarySubject.info.characterDesign && `人设：${primarySubject.info.characterDesign}`,
                          ]
                            .filter(Boolean)
                            .map((line) => `<li>${esc(line)}</li>`)
                            .join("\n                          ")}
                        </ul>
                      </div>`
                    : ""
                }

                <div class="ed-spec-group">
                  <div class="ed-spec-key">[ METRICS ]</div>
                  <ul class="ed-spec-list">
                    <li>发表时间：${dates.dot}（${dates.en}）</li>
                    <li>篇幅：${essay.charCount.toLocaleString("zh-CN")} 字 · 约 ${essay.readMinutes} 分钟</li>
                    ${
                      primarySubject?.bangumiScore
                        ? `<li>Bangumi：${primarySubject.bangumiScore.toFixed(2)} 分${primarySubject.bangumiRank ? `（#${primarySubject.bangumiRank}）` : ""}</li>`
                        : ""
                    }
                    ${
                      primarySubject?.userScore
                        ? `<li>我的评分：${primarySubject.userScore.toFixed(1)} / 10</li>`
                        : ""
                    }
                  </ul>
                </div>

                <div class="ed-spec-group">
                  <div class="ed-spec-key">[ LINKS ]</div>
                  <ul class="ed-spec-list">
                    <li><a href="${articleHref}">阅读完整长评 →</a></li>
                    <li><a href="${esc(essay.blogUrl)}" target="_blank" rel="noreferrer">Bangumi 原日志 ↗</a></li>
                  </ul>
                </div>
              </div>
            </div>

            ${
              firstGallery
                ? `<div class="ed-gallery" data-colophon-gallery>
                    <div class="ed-gallery-frame">
                      <img
                        class="ed-gallery-main${firstNeedsContain ? " is-contain" : ""}"
                        data-gallery-main
                        src="assets/${esc(firstGallery.file)}"
                        alt="${esc(firstGallery.caption || workName)}"
                        loading="lazy"
                      >
                    </div>
                    <div class="ed-gallery-caption">
                      <span data-gallery-caption>${esc(firstGallery.caption || firstGallery.label)}</span>
                      <span data-gallery-index>01 / ${String(essay.gallery.length).padStart(2, "0")}</span>
                    </div>
                    ${
                      essay.gallery.length > 1
                        ? `<div class="ed-thumbs" role="group" aria-label="切换《${esc(workName)}》关联图片">
                            ${essay.gallery
                              .slice(0, 5)
                              .map((img, gIdx) => {
                                const code = String(gIdx + 1).padStart(2, "0");
                                const needsContain = img.kind === "poster" || img.width / img.height <= 1.05;
                                return `<button
                                  type="button"
                                  class="ed-thumb-btn"
                                  data-thumb-btn
                                  data-src="assets/${esc(img.file)}"
                                  data-alt="${esc(img.caption || img.label)}"
                                  data-caption="${esc(img.caption || img.label)}"
                                  data-index="${code} / ${String(essay.gallery.length).padStart(2, "0")}"
                                  data-kind="${esc(img.kind)}"
                                  data-fit="${needsContain ? "contain" : "cover"}"
                                  aria-pressed="${gIdx === 0 ? "true" : "false"}"
                                >
                                  <span class="ed-thumb-box"><img src="assets/${esc(img.file)}" alt="" loading="lazy"></span>
                                  <span class="ed-thumb-idx">${code}</span>
                                </button>`;
                              })
                              .join("\n                            ")}
                          </div>`
                        : ""
                    }
                  </div>`
                : ""
            }
          </div>
        </div>
      </section>`;
    })
    .join("\n\n");

  const firstEssay = essays[0];
  const firstHero = firstEssay ? pickPrimaryVisual(firstEssay) : null;
  const shelfRowsHtml = essays
    .map((essay, idx) => {
      const no = String(idx + 1).padStart(2, "0");
      const dates = formatDates(essay.publishedAt);
      const primary = essay.subjects[0];
      const workName = primary?.displayName || "动画长评";
      const preview = pickPrimaryVisual(essay);
      return `<li
        class="sc-shelf-row${idx === 0 ? " is-previewed" : ""}"
        data-shelf-row
        data-year="${dates.year}"
        data-preview-src="${preview ? `assets/${esc(preview.file)}` : ""}"
        data-preview-title="${esc(workName)}"
        data-preview-meta="${dates.dot} · ${essay.charCount} 字"
      >
        <span class="sc-shelf-num">${no}</span>
        <span class="sc-shelf-date">${dates.dot}</span>
        <div class="sc-shelf-titles">
          <a href="entries/${essay.id}.html"><strong>${esc(essay.title)}</strong></a>
          <span>${esc(workName)}${primary?.userScore ? ` · 评分 ${primary.userScore.toFixed(1)}` : ""} · 约 ${essay.readMinutes} 分钟</span>
        </div>
        <div class="sc-shelf-actions">
          <button type="button" class="sc-shelf-read" data-shelf-jump="edition-${essay.id}">定位</button>
          <a class="sc-shelf-read" href="entries/${essay.id}.html">阅读全文 →</a>
        </div>
      </li>`;
    })
    .join("\n        ");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${esc(profile.nickname)}的 Bangumi 动画长评。">
  <title>长评志 · 我的动漫偏好</title>
  <link rel="icon" href="assets/avatar.webp">
${googleFontsHead()}
  <link rel="stylesheet" href="styles/tokens.css">
  <link rel="stylesheet" href="styles/showcase.css">
  <script src="scripts/showcase.js" defer></script>
</head>
<body class="sc-body">
  <a class="skip-link" href="#main">跳至主要内容</a>

  <header class="sc-chrome">
    <div class="sc-topbar">
      <a class="sc-brand" href="#main">
        <span class="sc-brand-cn">我的动漫偏好</span>
        <span class="sc-brand-sep">/</span>
        <span class="sc-brand-en">ANIME ESSAYS</span>
      </a>
      <div class="sc-topbar-actions">
        <button type="button" class="sc-mono-btn" data-shelf-open>[ ${String(essays.length).padStart(2, "0")} 篇长评 ]</button>
        <a class="sc-mono-btn" href="${esc(profile.blogListUrl)}" target="_blank" rel="noreferrer">BANGUMI ↗</a>
      </div>
    </div>
    <div class="sc-subbar">
      <div class="sc-subbar-left">
        <span class="sc-live-status" data-live-status>[ 01 / ${String(essays.length).padStart(2, "0")} ]</span>
      </div>
      <div class="sc-subbar-right">
        <button type="button" class="sc-esc-trigger" data-shelf-open>← [ESC] 全部目录</button>
        <svg class="sc-progress-ring" viewBox="0 0 22 22" aria-hidden="true">
          <circle class="sc-ring-track" cx="11" cy="11" r="9"></circle>
          <circle class="sc-ring-fill" data-ring-fill cx="11" cy="11" r="9"></circle>
        </svg>
      </div>
    </div>
  </header>

  <nav class="sc-marquee-rail" data-marquee-rail aria-label="长评快速跳转">
    <div class="sc-marquee-track" data-marquee-track>
        ${marqueeHtml}
    </div>
  </nav>

  <main id="main" class="sc-main">
    ${editionsHtml}

    <footer
      class="sc-footer"
      data-theme-section
      data-theme-bg="245, 246, 241"
      data-theme-fg="37, 62, 73"
    >
      <div class="sc-footer-inner">
        <p class="sc-footer-kicker">[ 我的动漫偏好 · 长评志 ]</p>
        <p class="sc-manifesto">${esc(profile.motto)}</p>

        <div class="sc-footer-grid">
          <div class="sc-footer-profile">
            <img src="assets/avatar.webp" alt="${esc(profile.nickname)}头像" width="44" height="44">
            <div>
              <strong>${esc(profile.nickname)}</strong>
              <span>Bangumi 日志 · 共 ${essays.length} 篇</span>
            </div>
          </div>

          <div class="sc-footer-links">
            ${essays
              .map((e, i) => `<a href="entries/${e.id}.html">${String(i + 1).padStart(2, "0")} ${esc(e.subjects[0]?.displayName || e.title)}</a>`)
              .join("\n            ")}
            <a href="${esc(profile.blogListUrl)}" target="_blank" rel="noreferrer">Bangumi 日志 ↗</a>
          </div>

          <div class="sc-footer-meta">
            SYNCED ${syncDate}<br>
            <a href="#main">BACK TO TOP ↑</a>
          </div>
        </div>
      </div>
    </footer>
  </main>

  ${
    firstEssay
      ? `<a class="sc-dock-pill" data-dock-pill href="entries/${firstEssay.id}.html"><span>▸</span><span>NO.01 ${esc(firstEssay.subjects[0]?.displayName || "")}</span></a>`
      : ""
  }

  <aside class="sc-shelf" data-shelf aria-hidden="true" aria-label="全部长评目录索引">
    <div class="sc-shelf-head">
      <span>[ ESSAY SHELF · 全部目录 ]</span>
      <div class="sc-shelf-filters" role="group" aria-label="按年份筛选">
        <button type="button" class="sc-shelf-filter" data-shelf-filter="all" aria-pressed="true">全部 (${essays.length})</button>
        ${years.map((y) => `<button type="button" class="sc-shelf-filter" data-shelf-filter="${y}" aria-pressed="false">${y}</button>`).join("")}
      </div>
      <button type="button" class="sc-mono-btn" data-shelf-close>[ESC] 关闭 ✕</button>
    </div>

    <div class="sc-shelf-body">
      <ol class="sc-shelf-list">
        ${shelfRowsHtml}
      </ol>
      <div class="sc-shelf-preview" aria-hidden="true">
        <div class="sc-shelf-preview-frame">
          ${firstHero ? `<img data-shelf-preview-img src="assets/${esc(firstHero.file)}" alt="">` : ""}
        </div>
        <div class="sc-shelf-preview-cap">
          <span data-shelf-preview-title>${esc(firstEssay?.subjects[0]?.displayName || "")}</span>
          <span data-shelf-preview-meta>${firstEssay ? `${formatDates(firstEssay.publishedAt).dot} · ${firstEssay.charCount} 字` : ""}</span>
        </div>
      </div>
    </div>

    <div class="sc-shelf-foot">
      <span>按 ESC 打开或关闭目录</span>
      <span>${esc(profile.nickname)} · BANGUMI / ${esc(profile.username)}</span>
    </div>
  </aside>

  <dialog class="sc-lightbox" data-lightbox aria-label="图片预览">
    <button type="button" class="sc-lightbox-close" data-lightbox-close>ESC / 关闭 ✕</button>
    <div class="sc-lightbox-inner">
      <img data-lightbox-img src="" alt="">
      <div class="sc-lightbox-cap" data-lightbox-cap></div>
    </div>
  </dialog>
</body>
</html>
`;
}

function renderArticlePage(essay, index, snapshot) {
  const { profile, essays } = snapshot;
  const no = String(index + 1).padStart(2, "0");
  const dates = formatDates(essay.publishedAt);
  const paragraphs = splitParagraphs(essay.content);
  const theme = THEME_CYCLE[index % THEME_CYCLE.length];
  const primarySubject = essay.subjects[0];
  const workName = primarySubject?.displayName || "动画长评";

  const attachments = essay.gallery.filter((g) => g.kind === "attachment");
  const posters = essay.gallery.filter((g) => g.kind === "poster");
  const topHero = attachments[0] || null;
  const extraAttachments = attachments.slice(1);
  const sidePoster = !topHero ? posters[0] || null : null;

  // 严格原样渲染作者正文，不拆节、不加小标题、不插摘句
  const proseHtml = paragraphs.map((line) => `          <p>${esc(line)}</p>`).join("\n");

  const extraPhotosHtml = extraAttachments.length
    ? `<div class="ps-extra-photos">
          ${extraAttachments
            .map(
              (photo, pIdx) => `<figure>
                <div class="ps-photo-box" data-ps-zoom="../assets/${esc(photo.file)}" data-ps-caption="日志附图 ${pIdx + 2}">
                  <img src="../assets/${esc(photo.file)}" alt="日志附图 ${pIdx + 2}" loading="lazy">
                </div>
                <figcaption class="ps-caption"><span>日志附图 ${pIdx + 2}</span></figcaption>
              </figure>`,
            )
            .join("\n          ")}
        </div>`
    : "";

  const otherEssays = essays.filter((e) => e.id !== essay.id);

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${esc((paragraphs[0] || essay.title).slice(0, 110))}">
  <title>${esc(essay.title)} · 长评志</title>
  <link rel="icon" href="../assets/avatar.webp">
${googleFontsHead()}
  <link rel="stylesheet" href="../styles/tokens.css">
  <link rel="stylesheet" href="../styles/article.css">
  <script src="../scripts/article.js" defer></script>
</head>
<body class="ps-body" style="--ps-accent: ${theme.accent}">
  <a class="skip-link" href="#article-main">跳至正文</a>

  <div class="ps-progress" aria-hidden="true">
    <div class="ps-progress-bar" data-read-progress></div>
  </div>

  <header class="ps-header">
    <div class="ps-header-inner">
      <a class="ps-back" href="../index.html#edition-${essay.id}">← 返回长评志</a>
      <a class="ps-brand" href="../index.html">
        <span class="ps-brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
        <span>我的动漫偏好 · 长评志</span>
      </a>
      <div class="ps-tools">
        <a class="ps-tool-link" href="${esc(essay.blogUrl)}" target="_blank" rel="noreferrer">Bangumi 原文 ↗</a>
      </div>
    </div>
  </header>

  ${
    topHero
      ? `<div class="ps-hero-wrap">
          <figure class="ps-hero-figure">
            <div class="ps-hero-frame" data-ps-zoom="../assets/${esc(topHero.file)}" data-ps-caption="${esc(topHero.caption || workName)}">
              <img
                data-hero-parallax
                src="../assets/${esc(topHero.file)}"
                alt="${esc(topHero.caption || workName)}"
                width="${topHero.width}"
                height="${topHero.height}"
                fetchpriority="high"
              >
            </div>
            <figcaption class="ps-caption">
              <span>${esc(topHero.caption)}</span>
              <span class="ps-caption-idx">点击查看大图</span>
            </figcaption>
          </figure>
        </div>`
      : ""
  }

  <main id="article-main" class="ps-container">
    <div class="ps-spread">
      <aside class="ps-rail" aria-label="文章信息与关联作品">
        ${
          sidePoster
            ? `<figure class="ps-rail-poster">
                <div class="ps-rail-poster-frame" data-ps-zoom="../assets/${esc(sidePoster.file)}" data-ps-caption="${esc(sidePoster.caption || workName)}">
                  <img
                    src="../assets/${esc(sidePoster.file)}"
                    alt="${esc(sidePoster.caption || workName)}"
                    width="${sidePoster.width}"
                    height="${sidePoster.height}"
                    fetchpriority="high"
                  >
                </div>
                <figcaption class="ps-caption"><span>${esc(sidePoster.caption)}</span></figcaption>
              </figure>`
            : ""
        }

        <div>
          <p class="ps-kicker">动画长评 No.${no} · 《${esc(workName)}》</p>
          <h1 class="ps-title">${esc(essay.title)}</h1>

          <div class="ps-meta">
            <div class="ps-meta-date">Published on ${dates.en}</div>
            <div>${dates.dot} · ${essay.charCount.toLocaleString("zh-CN")} 字 · 约 ${essay.readMinutes} 分钟</div>
            <div class="ps-meta-byline">
              <img src="../assets/avatar.webp" alt="" width="24" height="24">
              <span>${esc(essay.author)}</span>
            </div>
          </div>
        </div>

        <div class="ps-rail-subjects" aria-label="关联动画条目">
          <p class="ps-rail-label">关联作品 · SUBJECTS</p>
          ${essay.subjects
            .map(
              (s) => `<a class="ps-subject-mini" href="${esc(s.url)}" target="_blank" rel="noreferrer">
                ${s.posterFile ? `<img src="../assets/${esc(s.posterFile)}" alt="${esc(s.displayName)}">` : ""}
                <div>
                  <strong>${esc(s.displayName)}</strong>
                  <small>${s.userScore ? `我的评分 ${s.userScore.toFixed(1)}` : s.platform}${s.bangumiScore ? ` · BGM ${s.bangumiScore.toFixed(1)}` : ""}</small>
                </div>
              </a>`,
            )
            .join("\n          ")}
        </div>
      </aside>

      <article class="ps-prose-col">
        <div class="ps-prose">
${proseHtml}
        </div>
        ${extraPhotosHtml}

        <section class="ps-dossier" aria-labelledby="dossier-title">
          <div class="ps-dossier-head">
            <h2 id="dossier-title">[ SUBJECTS · 关联作品 ]</h2>
          </div>

          <div class="ps-dossier-list">
            ${essay.subjects
              .map(
                (s) => `<div class="ps-dossier-card">
                  ${s.posterFile ? `<a href="${esc(s.url)}" target="_blank" rel="noreferrer"><img src="../assets/${esc(s.posterFile)}" alt="${esc(s.displayName)}" loading="lazy"></a>` : ""}
                  <div>
                    <h3 class="ps-dossier-title"><a href="${esc(s.url)}" target="_blank" rel="noreferrer">${esc(s.displayName)} ↗</a></h3>
                    ${s.originalName ? `<p class="ps-dossier-orig">${esc(s.originalName)}</p>` : ""}
                    <div class="ps-dossier-scores">
                      ${s.userScore ? `<span>我的评分 <strong>${s.userScore.toFixed(1)} / 10</strong></span>` : ""}
                      ${s.bangumiScore ? `<span>Bangumi ${s.bangumiScore.toFixed(2)}${s.bangumiRank ? ` (#${s.bangumiRank})` : ""}</span>` : ""}
                      <span>${esc(s.platform)}</span>
                    </div>
                    ${s.info?.raw ? `<div class="ps-dossier-specs">${esc(s.info.raw)}</div>` : ""}
                    ${
                      s.userComment
                        ? `<div class="ps-dossier-comment"><b>我的 Bangumi 短评</b>${esc(s.userComment).replace(/\n/g, "<br>")}</div>`
                        : ""
                    }
                  </div>
                </div>`,
              )
              .join("\n            ")}
          </div>

          <div class="ps-end-actions">
            <a class="ps-end-link" href="../index.html#edition-${essay.id}">← 返回长评志</a>
            <a class="ps-end-link" href="${esc(essay.blogUrl)}" target="_blank" rel="noreferrer">Bangumi 原文（${essay.replies} 回复）↗</a>
          </div>
        </section>
      </article>
    </div>
  </main>

  ${
    otherEssays.length
      ? `<section class="ps-related" aria-labelledby="related-heading">
          <div class="ps-related-inner">
            <div class="ps-related-head">
              <h2 class="ps-related-heading" id="related-heading">
                <span>OTHER ESSAYS</span>
                <i>|</i>
                <span>其余长评</span>
              </h2>
            </div>

            <div class="ps-related-grid">
              ${otherEssays
                .map((other) => {
                  const otherIdx = essays.findIndex((x) => x.id === other.id);
                  const otherNo = String(otherIdx + 1).padStart(2, "0");
                  const otherDates = formatDates(other.publishedAt);
                  const otherWork = other.subjects[0]?.displayName || "动画长评";
                  const otherVisual = pickPrimaryVisual(other);
                  return `<a class="ps-card" href="${other.id}.html">
                    <div class="ps-card-media">
                      ${otherVisual ? `<img src="../assets/${esc(otherVisual.file)}" alt="${esc(otherWork)}" loading="lazy">` : ""}
                      <span class="ps-card-pill">No.${otherNo}</span>
                    </div>
                    <p class="ps-card-kicker">${esc(otherWork)}</p>
                    <h3 class="ps-card-title">${esc(other.title)}</h3>
                    <p class="ps-card-date">${otherDates.en} · ${other.charCount} 字</p>
                  </a>`;
                })
                .join("\n              ")}
            </div>

            <div class="ps-related-more">
              <a class="ps-read-more-btn" href="../index.html">VIEW ALL ESSAYS →</a>
            </div>
          </div>
        </section>`
      : ""
  }

  <footer class="ps-footer">
    <span>我的动漫偏好 / 长评志 · ${esc(profile.nickname)}</span>
    <span><a href="../index.html">长评志首页</a> · <a href="${esc(profile.blogListUrl)}" target="_blank" rel="noreferrer">Bangumi 日志 ↗</a></span>
  </footer>

  <dialog class="ps-lightbox" data-ps-lightbox aria-label="图片放大预览">
    <button type="button" class="ps-lightbox-close" data-ps-lightbox-close>ESC / 关闭 ✕</button>
    <div class="ps-lightbox-inner">
      <img data-ps-lightbox-img src="" alt="">
      <div class="ps-lightbox-cap" data-ps-lightbox-cap></div>
    </div>
  </dialog>
</body>
</html>
`;
}

export async function renderDemo2() {
  const snapshot = JSON.parse(await readFile(SNAPSHOT_PATH, "utf8"));
  await mkdir(ENTRIES_DIR, { recursive: true });

  await writeFile(resolve(DEMO_ROOT, "index.html"), renderIndexPage(snapshot), "utf8");
  await Promise.all(
    snapshot.essays.map((essay, idx) =>
      writeFile(resolve(ENTRIES_DIR, `${essay.id}.html`), renderArticlePage(essay, idx, snapshot), "utf8"),
    ),
  );
  console.log(`demo2 渲染完成：已生成 index.html 与 ${snapshot.essays.length} 篇长评阅读页。`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  renderDemo2().catch((error) => {
    console.error("demo2 渲染失败：", error);
    process.exitCode = 1;
  });
}
