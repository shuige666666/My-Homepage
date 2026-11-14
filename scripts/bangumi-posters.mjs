import { createHash } from "node:crypto";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const DIRECTORY = fileURLToPath(new URL("../public/images/bangumi/", import.meta.url));
const PUBLIC_PATH = "/images/bangumi/";
const DOWNLOAD_CONCURRENCY = 4;
const LARGE = { width: 900, height: 1250, quality: 82 };
const THUMBNAIL = { width: 360, height: 500, quality: 76 };

/** 用源地址和转码设置定位封面，只有封面或尺寸设置变化才生成新文件。 */
function getPosterPaths(source) {
  const key = createHash("sha256")
    .update(JSON.stringify([source, LARGE, THUMBNAIL]))
    .digest("hex").slice(0, 16);
  return {
    large: `${PUBLIC_PATH}${key}.webp`,
    thumbnail: `${PUBLIC_PATH}${key}-thumb.webp`,
  };
}

/** 等 WebP 写完再替换目标文件，避免中断后把残缺文件当成缓存。 */
async function writeWebp(buffer, path, { width, height, quality }) {
  const target = join(DIRECTORY, basename(path));
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    await sharp(buffer)
      .autoOrient()
      .resize({ width, height, fit: "inside", withoutEnlargement: true })
      .webp({ quality })
      .toFile(temporary);
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** 下载一张 Bangumi 海报，生成保留原比例的大图和缩略图。 */
async function downloadPoster(source, poster, headers) {
  const response = await fetch(source, {
    headers: { ...headers, Accept: "image/*" },
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const buffer = new Uint8Array(await response.arrayBuffer());
  await writeWebp(buffer, poster.large, LARGE);
  await writeWebp(buffer, poster.thumbnail, THUMBNAIL);
}

/** 下载页面会用到的新海报，并把可用的本地路径附到对应条目上。 */
export async function syncPosters(entries, previousEntries, headers) {
  await mkdir(DIRECTORY, { recursive: true });
  const files = new Set(await readdir(DIRECTORY));
  const isCached = (poster) => poster &&
    files.has(basename(poster.large)) &&
    files.has(basename(poster.thumbnail));

  const sources = [...new Set(entries.map((entry) => entry.image))]
    .filter((source) => source?.startsWith("https://lain.bgm.tv/"));
  const previousById = new Map(previousEntries.map((entry) => [entry.id, entry.poster]));
  const available = new Map();
  let downloaded = 0;
  let reused = 0;

  // 首次补齐历史海报时分批请求，已有一对 WebP 的封面直接复用。
  for (let offset = 0; offset < sources.length; offset += DOWNLOAD_CONCURRENCY) {
    const batch = sources.slice(offset, offset + DOWNLOAD_CONCURRENCY);
    await Promise.all(batch.map(async (source) => {
      const poster = getPosterPaths(source);
      if (isCached(poster)) {
        reused++;
      } else {
        try {
          await downloadPoster(source, poster, headers);
          downloaded++;
        } catch (error) {
          console.warn(`Bangumi 海报同步失败：${source}（${error.message}）`);
          return;
        }
      }
      available.set(source, poster);
    }));
  }

  // 单张下载失败时沿用之前的完整副本。首次缺图时页面会回退到 Bangumi 地址。
  for (const entry of entries) {
    const previous = previousById.get(entry.id);
    entry.poster = available.get(entry.image) ?? (isCached(previous) ? previous : undefined);
  }
  console.log(`Bangumi 海报：新增或更新 ${downloaded} 张，复用 ${reused} 张，暂缺 ${sources.length - available.size} 张。`);
}
