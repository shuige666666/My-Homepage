import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import sharp from "sharp";

const runFile = promisify(execFile);
const curlBin = process.platform === "win32" ? "curl.exe" : "curl";

const PROJECT_ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));
const PUBLIC_DIR = resolve(PROJECT_ROOT, "public");
const MEDIA_DIR = resolve(PUBLIC_DIR, "images/bangumi");
const PUBLIC_MEDIA_PREFIX = "/images/bangumi/";
const CUSTOM_OPT_DIR = resolve(PUBLIC_DIR, "images/long-reviews/optimized");
const CUSTOM_OPT_PREFIX = "/images/long-reviews/optimized/";
const CUSTOM_MAX_WIDTH = 1400;
const CUSTOM_WEBP_QUALITY = 80;
const BANGUMI_JSON_PATH = resolve(PROJECT_ROOT, "src/data/bangumi.json");
const CONFIG_PATH = resolve(PROJECT_ROOT, "src/data/long-reviews.config.json");
const PRIVATE_API_BASE = "https://next.bgm.tv/p1";

/** 解析 Bangumi subject.info（字段间以 ` / ` 分隔，避免误切括号内斜杠）。 */
function parseSubjectInfo(infoText = "") {
  const parts = String(infoText)
    .split(" / ")
    .map((part) => part.trim())
    .filter(Boolean);
  return {
    episodes: parts[0] || "",
    airDate: parts[1] || "",
    director: parts[2] || "",
    originalWork: parts[3] || "",
    characterDesign: parts[4] || "",
    raw: infoText,
  };
}

/** 读取可选长评定制配置（默认全自动；后续可按日志 ID 覆写主图、档案区附图与主题色）。 */
async function readLongReviewsConfig() {
  try {
    const raw = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
    return raw?.overrides && typeof raw.overrides === "object" ? raw.overrides : {};
  } catch {
    return {};
  }
}

/** 优先使用原生 fetch（适配 GitHub Actions / ProxyAgent），本机 TUN 环境下 fetch 失败时自动回落系统 curl。 */
async function fetchPrivateJson(path, headers) {
  const url = `${PRIVATE_API_BASE}${path}`;
  try {
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      throw new Error(`Bangumi Next p1 API ${response.status}: ${path}`);
    }
    return await response.json();
  } catch (fetchErr) {
    try {
      const { stdout } = await runFile(
        curlBin,
        [
          "--fail",
          "--silent",
          "--show-error",
          "--location",
          "--max-time",
          "25",
          "--retry",
          "1",
          "--header",
          "Accept: application/json",
          "--user-agent",
          headers["User-Agent"] || "MyAnimePreferences/1.0",
          url,
        ],
        { windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
      );
      return JSON.parse(stdout);
    } catch {
      throw fetchErr;
    }
  }
}

/** 下载远端图片字节流，同样支持 fetch 失败自动回落系统 curl。 */
async function fetchImageToTemp(sourceUrl, tempBinPath, headers) {
  try {
    const response = await fetch(sourceUrl, {
      headers: { ...headers, Accept: "image/*" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await writeFile(tempBinPath, new Uint8Array(await response.arrayBuffer()));
  } catch (fetchErr) {
    try {
      await runFile(
        curlBin,
        [
          "--fail",
          "--silent",
          "--show-error",
          "--location",
          "--max-time",
          "25",
          "--retry",
          "1",
          "--user-agent",
          headers["User-Agent"] || "MyAnimePreferences/1.0",
          "--output",
          tempBinPath,
          sourceUrl,
        ],
        { windowsHide: true },
      );
    } catch {
      throw fetchErr;
    }
  }
}

/** 下载远端图片并按原比例转为 WebP 存入 public/images/bangumi/，已有缓存则直接复用。 */
async function ensureCachedWebp(sourceUrl, prefix, maxWidth, headers, cachedFiles) {
  const hash = createHash("sha256")
    .update(JSON.stringify([sourceUrl, maxWidth]))
    .digest("hex")
    .slice(0, 14);
  const filename = `${prefix}-${hash}.webp`;
  const targetPath = join(MEDIA_DIR, filename);

  if (cachedFiles.has(filename)) {
    try {
      const meta = await sharp(targetPath).metadata();
      if (meta.width && meta.height) {
        return { src: `${PUBLIC_MEDIA_PREFIX}${filename}`, width: meta.width, height: meta.height };
      }
    } catch {
      /* 缓存损坏则重新下载 */
    }
  }

  const tempBin = `${targetPath}.${process.pid}.bin`;
  const tempOut = `${targetPath}.${process.pid}.tmp`;
  try {
    await fetchImageToTemp(sourceUrl, tempBin, headers);
    const info = await sharp(tempBin)
      .autoOrient()
      .resize({ width: maxWidth, withoutEnlargement: true })
      .webp({ quality: 86 })
      .toFile(tempOut);
    await rename(tempOut, targetPath);
    cachedFiles.add(filename);
    return { src: `${PUBLIC_MEDIA_PREFIX}${filename}`, width: info.width, height: info.height };
  } finally {
    await rm(tempBin, { force: true });
    await rm(tempOut, { force: true });
  }
}

/** 读取本地 public/ 下图片的真实宽高；若为较大的非 WebP 自定义原图，自动转存为 WebP 缓存到 public/images/long-reviews/optimized/。 */
async function measurePublicImage(publicRelPath) {
  const normalized = publicRelPath.startsWith("/") ? publicRelPath : `/${publicRelPath}`;
  const fullPath = resolve(PUBLIC_DIR, normalized.replace(/^\/+/, ""));
  const meta = await sharp(fullPath).metadata();
  if (!meta.width || !meta.height) {
    throw new Error(`无法读取图片尺寸：${normalized}`);
  }
  return { src: normalized, width: meta.width, height: meta.height };
}

/** 将自定义本地原图按最大宽 1600px 无损放大限制转为 WebP（保留原图不动，产物与 depth-gallery/optimized 保持一致习惯）。 */
async function ensureOptimizedCustomWebp(publicRelPath, slug) {
  const normalized = publicRelPath.startsWith("/") ? publicRelPath : `/${publicRelPath}`;
  const fullPath = resolve(PUBLIC_DIR, normalized.replace(/^\/+/, ""));
  const rawBuffer = await readFile(fullPath);
  const meta = await sharp(rawBuffer).metadata();
  if (!meta.width || !meta.height) {
    throw new Error(`无法读取图片尺寸：${normalized}`);
  }

  // 已经在 optimized/ 下或本身已是紧凑 WebP 时直接复用
  if (
    normalized.startsWith(CUSTOM_OPT_PREFIX) ||
    (meta.format === "webp" && meta.width <= CUSTOM_MAX_WIDTH && rawBuffer.byteLength <= 360 * 1024)
  ) {
    return { src: normalized, width: meta.width, height: meta.height };
  }

  await mkdir(CUSTOM_OPT_DIR, { recursive: true });
  const hash = createHash("sha256")
    .update(rawBuffer)
    .update(`|w=${CUSTOM_MAX_WIDTH}|q=${CUSTOM_WEBP_QUALITY}|ss=1`)
    .digest("hex")
    .slice(0, 12);
  const filename = `${slug}-${hash}.webp`;
  const targetPath = join(CUSTOM_OPT_DIR, filename);

  try {
    const cachedMeta = await sharp(targetPath).metadata();
    if (cachedMeta.width && cachedMeta.height) {
      return { src: `${CUSTOM_OPT_PREFIX}${filename}`, width: cachedMeta.width, height: cachedMeta.height };
    }
  } catch {
    /* 尚未生成缓存 */
  }

  const tempOut = `${targetPath}.${process.pid}.tmp`;
  try {
    const info = await sharp(rawBuffer)
      .autoOrient()
      .resize({ width: CUSTOM_MAX_WIDTH, withoutEnlargement: true })
      .webp({ quality: CUSTOM_WEBP_QUALITY, effort: 6, smartSubsample: true })
      .toFile(tempOut);
    await rename(tempOut, targetPath);
    return { src: `${CUSTOM_OPT_PREFIX}${filename}`, width: info.width, height: info.height };
  } finally {
    await rm(tempOut, { force: true });
  }
}

/** 解析可选配置中的自定义图片条目（支持字符串路径或 `{ src, caption, label }`）。 */
async function resolveCustomMedia(item, defaultLabel, slug = "custom") {
  if (!item) return null;
  const spec = typeof item === "string" ? { src: item } : item;
  if (!spec?.src) return null;
  try {
    const measured = await ensureOptimizedCustomWebp(spec.src, slug);
    return {
      ...measured,
      kind: "custom",
      label: spec.label || defaultLabel,
      caption: spec.caption || spec.label || defaultLabel,
    };
  } catch (error) {
    console.warn(`长评自定义配图不可用（${spec.src}）：${error.message}`);
    return null;
  }
}

/**
 * 同步用户公开长评（Bangumi 日志）。
 * 接口属 Bangumi Next 私有 API：如遇临时波动则自动保留上次快照，不阻断主站日常收藏同步。
 */
export async function syncLongReviews({
  username,
  profileNickname,
  entryLookup,
  previousLongReviews = [],
  headers,
}) {
  try {
    await mkdir(MEDIA_DIR, { recursive: true });
    const cachedFiles = new Set(await readdir(MEDIA_DIR));
    const overrides = await readLongReviewsConfig();

    const rows = [];
    for (let offset = 0; ; ) {
      const page = await fetchPrivateJson(
        `/users/${username}/blogs?limit=20&offset=${offset}`,
        headers,
      );
      const list = page.data ?? [];
      rows.push(...list.filter((item) => item.public));
      offset += list.length;
      if (!list.length || offset >= (page.total ?? 0)) break;
    }

    const longReviews = [];

    for (const row of rows) {
      const [detail, rawSubjects, rawPhotos] = await Promise.all([
        fetchPrivateJson(`/blogs/${row.id}`, headers),
        fetchPrivateJson(`/blogs/${row.id}/subjects`, headers),
        fetchPrivateJson(`/blogs/${row.id}/photos`, headers).catch(() => ({ data: [] })),
      ]);
      if (!detail.public) continue;

      const subjects = (rawSubjects ?? [])
        .map((s) => {
          const mainItem = entryLookup.get(s.id);
          const displayName = mainItem?.nameCn || s.nameCN || s.name;
          return {
            id: s.id,
            displayName,
            nameCn: s.nameCN || displayName,
            originalName: s.name || "",
            platform: s.platform?.typeCN || "动画",
            url: `https://bangumi.tv/subject/${s.id}`,
            remotePosterUrl: s.images?.large || s.images?.common || "",
            localPosterPath: mainItem?.poster?.large || "",
            info: parseSubjectInfo(s.info),
            bangumiScore: s.rating?.score ?? mainItem?.bangumiScore ?? null,
            bangumiRank: s.rating?.rank ?? mainItem?.rank ?? null,
            userScore: mainItem?.userScore ?? null,
            userComment: (mainItem?.comment ?? "").trim(),
          };
        })
        .sort((a, b) => (a.platform === "TV" ? 0 : 1) - (b.platform === "TV" ? 0 : 1));

      // 1. 先自动收集日志自身上传的随文附图
      const autoGallery = [];
      const photos = rawPhotos?.data ?? [];
      for (let i = 0; i < photos.length; i += 1) {
        const photo = photos[i];
        if (!photo?.target) continue;
        const fullUrl = `https://lain.bgm.tv/pic/photo/l/${photo.target}`;
        try {
          const cached = await ensureCachedWebp(
            fullUrl,
            `blog-${detail.id}-p${i + 1}`,
            1800,
            headers,
            cachedFiles,
          );
          autoGallery.push({
            ...cached,
            kind: "attachment",
            label: "日志附图",
            caption: "日志附图",
          });
        } catch (error) {
          console.warn(`日志 ${detail.id} 附图下载失败：${error.message}`);
        }
      }

      // 2. 再自动收集关联番剧的 Bangumi 官方海报（优先复用主站已缓存的本地海报）
      for (const s of subjects) {
        let posterMedia = null;
        if (s.localPosterPath) {
          try {
            posterMedia = await measurePublicImage(s.localPosterPath);
          } catch {
            posterMedia = null;
          }
        }
        if (!posterMedia && s.remotePosterUrl) {
          try {
            posterMedia = await ensureCachedWebp(
              s.remotePosterUrl,
              `blog-subject-${s.id}`,
              1200,
              headers,
              cachedFiles,
            );
          } catch (error) {
            console.warn(`长评关联条目 ${s.id} 海报下载失败：${error.message}`);
          }
        }
        if (posterMedia) {
          s.posterPath = posterMedia.src;
          s.posterWidth = posterMedia.width;
          s.posterHeight = posterMedia.height;
          autoGallery.push({
            ...posterMedia,
            kind: "poster",
            subjectId: s.id,
            label: `${s.displayName} 海报`,
            caption: `《${s.displayName}》Bangumi 海报`,
          });
        } else {
          s.posterPath = s.remotePosterUrl || "";
          s.posterWidth = 0;
          s.posterHeight = 0;
        }
        delete s.remotePosterUrl;
        delete s.localPosterPath;
      }

      // 3. 应用可选轻度定制覆写（src/data/long-reviews.config.json）
      const override = overrides[String(detail.id)] ?? null;
      const customHero = await resolveCustomMedia(override?.heroImage, "定制视觉图", `blog-${detail.id}-hero`);
      const primaryVisual =
        customHero ||
        autoGallery.find((g) => g.kind === "attachment") ||
        autoGallery.find((g) => g.kind === "poster") ||
        autoGallery[0] ||
        null;

      let gallery = autoGallery;
      if (Array.isArray(override?.archiveImages) && override.archiveImages.length > 0) {
        const customArchive = (
          await Promise.all(
            override.archiveImages.map((item, idx) =>
              resolveCustomMedia(item, `精选配图 ${idx + 1}`, `blog-${detail.id}-archive-${idx + 1}`),
            ),
          )
        ).filter(Boolean);
        if (customArchive.length > 0) {
          gallery = customArchive;
        }
      }

      const content = String(detail.content ?? "").replace(/\r\n/g, "\n").trim();
      const charCount = Array.from(content.replace(/\s+/g, "")).length;
      const readMinutes = Math.max(1, Math.ceil(charCount / 320));

      const theme =
        override?.theme && override.theme.bg && override.theme.fg && override.theme.accent
          ? {
              bg: String(override.theme.bg),
              fg: String(override.theme.fg),
              accent: String(override.theme.accent),
            }
          : undefined;

      longReviews.push({
        id: detail.id,
        title: String(detail.title ?? "").trim(),
        author: detail.user?.nickname || profileNickname || "烟雨残烬",
        blogUrl: `https://bangumi.tv/blog/${detail.id}`,
        publishedAt: new Date(detail.createdAt * 1000).toISOString(),
        updatedAt: new Date((detail.updatedAt || detail.createdAt) * 1000).toISOString(),
        replies: detail.replies ?? 0,
        charCount,
        readMinutes,
        content,
        subjects,
        primaryVisual,
        gallery,
        ...(theme ? { theme } : {}),
      });
    }

    longReviews.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    console.log(`Bangumi 长评：同步 ${longReviews.length} 篇公开日志。`);
    return longReviews;
  } catch (error) {
    console.warn(`Bangumi 长评同步失败，已沿用上次快照（${previousLongReviews.length} 篇）：${error.message}`);
    return previousLongReviews;
  }
}

/** 支持单独执行 `npm run sync:long-reviews`，仅刷新 bangumi.json 中的 longReviews 与自定义配图。 */
async function runStandalone() {
  const snapshot = JSON.parse(await readFile(BANGUMI_JSON_PATH, "utf8"));
  const entryLookup = new Map();
  for (const item of [
    ...(snapshot.favorites ?? []),
    ...(snapshot.recentReviews ?? []),
    ...(snapshot.watchHistory ?? []),
  ]) {
    if (!item?.id) continue;
    const prev = entryLookup.get(item.id);
    if (!prev || (!prev.poster && item.poster) || (!prev.comment && item.comment)) {
      entryLookup.set(item.id, item);
    }
  }

  const longReviews = await syncLongReviews({
    username: snapshot.profile?.username || "860550",
    profileNickname: snapshot.profile?.nickname || "烟雨残烬",
    entryLookup,
    previousLongReviews: snapshot.longReviews ?? [],
    headers: {
      Accept: "application/json",
      "User-Agent": "MyAnimePreferences/1.0 (personal homepage)",
    },
  });

  snapshot.longReviews = longReviews;
  const tempPath = `${BANGUMI_JSON_PATH}.${process.pid}.tmp`;
  try {
    await writeFile(tempPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    await rename(tempPath, BANGUMI_JSON_PATH);
  } finally {
    await rm(tempPath, { force: true });
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runStandalone().catch((error) => {
    console.error("长评单独同步失败：", error);
    process.exitCode = 1;
  });
}
