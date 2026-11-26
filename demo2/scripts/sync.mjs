import { copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const runFile = promisify(execFile);
const curlBin = process.platform === "win32" ? "curl.exe" : "curl";

const DEMO_ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));
const PROJECT_ROOT = resolve(DEMO_ROOT, "..");
const DATA_DIR = resolve(DEMO_ROOT, "data");
const ASSETS_DIR = resolve(DEMO_ROOT, "assets");
const SNAPSHOT_PATH = resolve(DATA_DIR, "essays.json");

const USERNAME = "860550";
const API_BASE = "https://next.bgm.tv/p1";
const USER_AGENT = "MyAnimePreferences/2.0 (demo2 editorial essays)";

/** 通过系统 curl 拉取 JSON，沿用本机代理与证书配置。 */
async function fetchJson(path) {
  const { stdout } = await runFile(
    curlBin,
    [
      "--fail",
      "--silent",
      "--show-error",
      "--location",
      "--max-time",
      "30",
      "--retry",
      "2",
      "--header",
      "Accept: application/json",
      "--user-agent",
      USER_AGENT,
      `${API_BASE}${path}`,
    ],
    { windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
  );
  return JSON.parse(stdout);
}

/** 下载 Bangumi 图片到本地临时文件。 */
async function downloadBinary(url, destination) {
  await runFile(
    curlBin,
    [
      "--fail",
      "--silent",
      "--show-error",
      "--location",
      "--max-time",
      "30",
      "--retry",
      "2",
      "--user-agent",
      USER_AGENT,
      "--output",
      destination,
      url,
    ],
    { windowsHide: true },
  );
}

/** 将图片无裁剪转为 WebP，保留原始比例并记录真实宽高。 */
async function optimizeToWebp(inputPath, outName, maxWidth = 1600) {
  const outputPath = resolve(ASSETS_DIR, outName);
  const info = await sharp(inputPath)
    .rotate()
    .resize({ width: maxWidth, withoutEnlargement: true })
    .webp({ quality: 86 })
    .toFile(outputPath);
  return { file: outName, width: info.width, height: info.height };
}

/** 读取主站快照，仅用于补充作者个人评分、短评与已有本地 Bangumi 海报缓存。 */
async function loadMainSiteLookup() {
  const map = new Map();
  let profile = { username: USERNAME, nickname: "烟雨残烬", bangumiUrl: `https://bangumi.tv/user/${USERNAME}` };
  try {
    const raw = JSON.parse(await readFile(resolve(PROJECT_ROOT, "src/data/bangumi.json"), "utf8"));
    if (raw.profile) profile = raw.profile;
    const buckets = [
      ...(raw.favorites ?? []),
      ...(raw.recentReviews ?? []),
      ...(raw.watchHistory ?? []),
    ];
    for (const item of buckets) {
      if (!item?.id) continue;
      const existing = map.get(item.id);
      if (!existing || (!existing.comment && item.comment) || (!existing.userScore && item.userScore)) {
        map.set(item.id, item);
      }
    }
  } catch (error) {
    console.warn("未读取到主站 src/data/bangumi.json，将完全依赖 Bangumi 接口。", error.message);
  }
  return { profile, subjectLookup: map };
}

/** 解析 Bangumi subject.info（字段间以 ` / ` 分隔，避免误切括号内的斜杠如 `連載/KADOKAWA刊`）。 */
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

/** 同步头像与清理不再使用的旧视觉图缓存。 */
async function prepareAssetsDir() {
  await mkdir(ASSETS_DIR, { recursive: true });
  const existing = await readdir(ASSETS_DIR);
  await Promise.all(
    existing
      .filter((name) => /^subject-\d+-art\.webp$/.test(name))
      .map((name) => rm(resolve(ASSETS_DIR, name), { force: true })),
  );

  const avatarSrc = resolve(PROJECT_ROOT, "public/images/profile/avatar.webp");
  try {
    await copyFile(avatarSrc, resolve(ASSETS_DIR, "avatar.webp"));
  } catch {
    /* 头像可选 */
  }
}

/**
 * 纯自动图片收集规则（全部来自 Bangumi）：
 * 1. 日志自身上传的附图（GET /p1/blogs/{id}/photos）排最前，有附图即作为主图；
 * 2. 随后自动收集关联条目的 Bangumi 官方海报（优先复用主站已下载的同源海报，否则直接从 Bangumi 拉取）。
 */
async function collectBangumiMedia(blogId, photos, subjects, subjectLookup) {
  const gallery = [];

  for (let i = 0; i < photos.length; i += 1) {
    const photo = photos[i];
    if (!photo?.target) continue;
    const fullUrl = `https://lain.bgm.tv/pic/photo/l/${photo.target}`;
    const tempFile = resolve(ASSETS_DIR, `tmp-blog-${blogId}-${i}-${randomUUID()}.bin`);
    try {
      await downloadBinary(fullUrl, tempFile);
      const outName = `blog-${blogId}-photo-${i + 1}.webp`;
      const meta = await optimizeToWebp(tempFile, outName, 1800);
      gallery.push({
        ...meta,
        kind: "attachment",
        label: "日志附图",
        caption: "日志附图",
        sourceUrl: fullUrl,
      });
    } catch (error) {
      console.warn(`日志 ${blogId} 附图下载失败：`, error.message);
    } finally {
      await rm(tempFile, { force: true });
    }
  }

  for (const subject of subjects) {
    const outName = `subject-${subject.id}-poster.webp`;
    const mainItem = subjectLookup.get(subject.id);
    const localPosterRel = mainItem?.poster?.large?.replace(/^\/+/, "");
    let meta = null;

    // 优先使用主站已从 Bangumi 缓存的同源海报，避免重复外网下载；没有则直接从 Bangumi 接口地址拉取。
    if (localPosterRel) {
      try {
        const src = resolve(PROJECT_ROOT, "public", localPosterRel);
        meta = await optimizeToWebp(src, outName, 1200);
      } catch {
        meta = null;
      }
    }

    if (!meta && subject.remotePosterUrl) {
      const tempFile = resolve(ASSETS_DIR, `tmp-poster-${subject.id}-${randomUUID()}.bin`);
      try {
        await downloadBinary(subject.remotePosterUrl, tempFile);
        meta = await optimizeToWebp(tempFile, outName, 1200);
      } catch (error) {
        console.warn(`条目 ${subject.id} Bangumi 海报下载失败：`, error.message);
      } finally {
        await rm(tempFile, { force: true });
      }
    }

    if (meta) {
      gallery.push({
        ...meta,
        kind: "poster",
        subjectId: subject.id,
        label: `${subject.displayName} 海报`,
        caption: `《${subject.displayName}》Bangumi 海报`,
      });
    }
  }

  return gallery;
}

async function syncAll() {
  await mkdir(DATA_DIR, { recursive: true });
  await prepareAssetsDir();

  const { profile, subjectLookup } = await loadMainSiteLookup();

  const rows = [];
  for (let offset = 0; ; ) {
    const page = await fetchJson(`/users/${USERNAME}/blogs?limit=20&offset=${offset}`);
    const list = page.data ?? [];
    rows.push(...list.filter((item) => item.public));
    offset += list.length;
    if (!list.length || offset >= (page.total ?? 0)) break;
  }

  const essays = [];
  for (const row of rows) {
    const [detail, rawSubjects, rawPhotos] = await Promise.all([
      fetchJson(`/blogs/${row.id}`),
      fetchJson(`/blogs/${row.id}/subjects`),
      fetchJson(`/blogs/${row.id}/photos`).catch(() => ({ data: [] })),
    ]);
    if (!detail.public) continue;

    const subjects = (rawSubjects ?? [])
      .map((s) => {
        const mainItem = subjectLookup.get(s.id);
        const displayName = mainItem?.nameCn || s.nameCN || s.name;
        return {
          id: s.id,
          displayName,
          nameCn: s.nameCN || displayName,
          originalName: s.name || "",
          platform: s.platform?.typeCN || "动画",
          url: `https://bangumi.tv/subject/${s.id}`,
          remotePosterUrl: s.images?.large || s.images?.common || "",
          info: parseSubjectInfo(s.info),
          bangumiScore: s.rating?.score ?? mainItem?.bangumiScore ?? null,
          bangumiRank: s.rating?.rank ?? mainItem?.rank ?? null,
          ratingTotal: s.rating?.total ?? null,
          userScore: mainItem?.userScore ?? null,
          userComment: (mainItem?.comment ?? "").trim(),
          userUpdatedAt: mainItem?.updatedAt ?? "",
        };
      })
      .sort((a, b) => {
        const aIsTv = a.platform === "TV" ? 0 : 1;
        const bIsTv = b.platform === "TV" ? 0 : 1;
        return aIsTv - bIsTv;
      });

    const gallery = await collectBangumiMedia(detail.id, rawPhotos?.data ?? [], subjects, subjectLookup);

    for (const s of subjects) {
      const posterAsset = gallery.find((g) => g.kind === "poster" && g.subjectId === s.id);
      s.posterFile = posterAsset?.file || "";
      s.posterWidth = posterAsset?.width || 0;
      s.posterHeight = posterAsset?.height || 0;
      delete s.remotePosterUrl;
    }

    const content = String(detail.content ?? "").replace(/\r\n/g, "\n").trim();
    const charCount = Array.from(content.replace(/\s+/g, "")).length;
    const readMinutes = Math.max(1, Math.ceil(charCount / 320));

    essays.push({
      id: detail.id,
      title: String(detail.title ?? "").trim(),
      author: detail.user?.nickname || profile.nickname || "烟雨残烬",
      blogUrl: `https://bangumi.tv/blog/${detail.id}`,
      publishedAt: new Date(detail.createdAt * 1000).toISOString(),
      updatedAt: new Date((detail.updatedAt || detail.createdAt) * 1000).toISOString(),
      replies: detail.replies ?? 0,
      charCount,
      readMinutes,
      content,
      subjects,
      gallery,
    });
  }

  essays.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

  const snapshot = {
    username: USERNAME,
    syncedAt: new Date().toISOString(),
    profile: {
      username: profile.username ?? USERNAME,
      nickname: profile.nickname ?? "烟雨残烬",
      bangumiUrl: profile.bangumiUrl ?? `https://bangumi.tv/user/${USERNAME}`,
      blogListUrl: `https://bangumi.tv/user/${USERNAME}/blog`,
      motto: "永远相信美好的事情即将发生",
    },
    essays,
  };

  const tempSnapshot = resolve(DATA_DIR, `essays-${randomUUID()}.tmp`);
  try {
    await writeFile(tempSnapshot, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    await rename(tempSnapshot, SNAPSHOT_PATH);
  } finally {
    await rm(tempSnapshot, { force: true });
  }

  console.log(`demo2 同步完成：共收录 ${essays.length} 篇长评（图片全部来自 Bangumi 附图与番剧海报）。`);
}

syncAll().catch((error) => {
  console.error("demo2 长评同步失败：", error);
  process.exitCode = 1;
});
