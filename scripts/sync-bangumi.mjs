import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ProxyAgent, setGlobalDispatcher } from "undici";

const USERNAME = "860550";
const API_BASE = "https://api.bgm.tv/v0";
const PAGE_SIZE = 50;
const OUTPUT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../src/data/bangumi.json",
);
const FAVORITES_CONFIG_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../src/data/favorites.config.json",
);
const headers = {
  Accept: "application/json",
  "User-Agent": "MyAnimePreferences/1.0 (personal homepage)",
};

const proxyUrl = process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY;
if (proxyUrl) {
  setGlobalDispatcher(new ProxyAgent(proxyUrl));
  console.log(`使用代理同步 Bangumi 数据：${proxyUrl}`);
}

/**
 * 请求 Bangumi 公共接口，并在非成功响应时抛出包含上下文的异常。
 */
async function request(path) {
  const response = await fetch(`${API_BASE}${path}`, { headers });
  if (!response.ok) {
    throw new Error(`Bangumi API ${response.status}: ${path}`);
  }
  return response.json();
}

/**
 * 分页读取指定收藏状态；避免接口分页上限导致统计和列表缺项。
 */
async function fetchCollections(type) {
  const entries = [];
  let offset = 0;

  while (true) {
    const params = new URLSearchParams({
      subject_type: "2",
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    if (type) params.set("type", String(type));

    const page = await request(`/users/${USERNAME}/collections?${params}`);
    entries.push(...page.data);
    offset += page.data.length;
    if (!page.data.length || offset >= page.total) break;
  }

  return entries;
}

/**
 * 将 Bangumi 收藏记录压缩为页面实际需要的稳定字段。
 */
function normalizeCollection(entry) {
  const subject = entry.subject ?? {};
  return {
    id: subject.id,
    name: subject.name ?? "",
    nameCn: subject.name_cn ?? "",
    image: subject.images?.large ?? subject.images?.common ?? "",
    bangumiScore: subject.score ?? 0,
    rank: subject.rank || null,
    url: `https://bangumi.tv/subject/${subject.id}`,
    userScore: entry.rate ?? 0,
    comment: entry.comment ?? "",
    updatedAt: entry.updated_at ?? "",
  };
}

/**
 * 将单个条目详情整理成页面需要的字段；用于补全手动精选但不在收藏列表中的作品。
 */
function normalizeSubject(subject, source = {}) {
  return {
    id: subject.id,
    name: subject.name ?? "",
    nameCn: subject.name_cn ?? "",
    image: subject.images?.large ?? subject.images?.common ?? "",
    bangumiScore: subject.score ?? 0,
    rank: subject.rank || null,
    url: `https://bangumi.tv/subject/${subject.id}`,
    userScore: source.userScore ?? 0,
    comment: source.comment ?? "",
    updatedAt: source.updatedAt ?? "",
  };
}

/**
 * 读取最喜欢动漫配置；配置缺失时继续使用个人评分前十。
 */
async function readFavoritesConfig() {
  try {
    const content = await readFile(FAVORITES_CONFIG_PATH, "utf8");
    return JSON.parse(content);
  } catch {
    return { mode: "auto", subjects: [] };
  }
}

/**
 * 根据配置生成最喜欢动漫；手动模式严格遵循配置中的条目顺序。
 */
async function selectFavorites(entries, config) {
  if (config.mode !== "manual") {
    return entries
      .filter((entry) => entry.userScore > 0)
      .sort(
        (a, b) =>
          b.userScore - a.userScore ||
          b.bangumiScore - a.bangumiScore ||
          b.updatedAt.localeCompare(a.updatedAt),
      )
      .slice(0, 10);
  }

  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  const favorites = [];

  for (const { id, note, score } of config.subjects.slice(0, 10)) {
    const displayScore = typeof score === "number" ? score : undefined;
    const entry = entriesById.get(id);
    if (entry) {
      favorites.push({
        ...entry,
        userScore: displayScore ?? entry.userScore,
        note: note?.trim() || undefined,
      });
      continue;
    }

    // 手动精选优先尊重配置；即使该条目没有出现在收藏分页中，也尝试直接拉取条目详情。
    try {
      const subject = await request(`/subjects/${id}`);
      favorites.push({
        ...normalizeSubject(subject, { userScore: displayScore }),
        note: note?.trim() || undefined,
      });
    } catch (error) {
      console.warn(`手动精选条目 ${id} 获取失败，已跳过。`);
      console.warn(error);
    }
  }

  return favorites;
}

/**
 * 拉取并整理页面所需数据；只有全部完成后才会替换旧文件。
 */
async function sync() {
  const [profile, all, watched, watching, wish, favoritesConfig] = await Promise.all([
    request(`/users/${USERNAME}`),
    fetchCollections(),
    fetchCollections(2),
    fetchCollections(3),
    fetchCollections(1),
    readFavoritesConfig(),
  ]);

  const normalizedAll = all.map(normalizeCollection);
  const normalizedWatched = watched
    .map(normalizeCollection)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const favorites = await selectFavorites(normalizedAll, favoritesConfig);

  // 保留全部有个人评分的记录；首页卡片只展示前几条，弹窗负责按时间浏览完整评价。
  const recentReviews = normalizedAll
    .filter((entry) => entry.userScore > 0)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const result = {
    syncedAt: new Date().toISOString(),
    profile: {
      username: profile.username ?? USERNAME,
      nickname: profile.nickname || profile.username || USERNAME,
      bangumiUrl: `https://bangumi.tv/user/${USERNAME}`,
    },
    stats: {
      watched: watched.length,
      watching: watching.length,
      wish: wish.length,
    },
    favorites,
    recentWatched: normalizedWatched.slice(0, 10),
    recentReviews,
  };

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  const tempPath = `${OUTPUT_PATH}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  await rename(tempPath, OUTPUT_PATH);
  console.log(
    `Bangumi 数据同步完成：${favorites.length} 部偏好作品，${watched.length} 部看过。`,
  );
}

sync().catch((error) => {
  console.error("Bangumi 数据同步失败，旧数据未被覆盖。");
  console.error(error);
  process.exitCode = 1;
});
