# 项目架构

本文记录当前仓库已经实现的项目结构、数据流和部署链路。它以实际代码为准，不记录尚未实现的服务端接口、数据库或内容集合方案。

最后核对：2026-09-05

## 1. 架构概览

这是一个使用 Astro、TypeScript 和原生 CSS 构建的静态动漫偏好单页。页面在构建阶段读取仓库中的 Bangumi 数据快照，生成静态 HTML、CSS 和浏览器端脚本；访客打开页面时不会直接请求 Bangumi API。

整体链路如下：

```text
Bangumi 公共 API
      │
      ▼
scripts/sync-bangumi.mjs
  读取 favorites.config.json
  整理收藏、统计、评价和观看记录
      │
      ▼
src/data/bangumi.json
      │  构建时静态导入
      ▼
src/pages/index.astro
  组合页面布局和展示组件
      │
      ▼
npm run build
  astro check && astro build
      │
      ▼
dist/
      │
      ▼
Cloudflare 静态资源部署
```

项目没有服务端渲染、数据库、运行时 Bangumi API 路由，也没有 React 或 Svelte 应用层。交互部分由 Astro 组件中的浏览器端脚本和 Three.js 画廊脚本负责。

## 2. 页面组成

首页入口是 `src/pages/index.astro`。它在构建时导入 `src/data/bangumi.json`，将数据转换为 `BangumiPageData` 类型，并把页面数据传给展示组件。

```text
BaseLayout
└─ index.astro
   ├─ DepthGallery
   └─ .page-shell
      ├─ SiteHeader
      ├─ main
      │  ├─ ProfileHero
      │  ├─ FavoriteRail
      │  └─ RecentSections
      │     └─ WatchTimeline
      └─ footer
```

主要组件职责如下：

| 文件 | 职责 |
| --- | --- |
| `src/pages/index.astro` | 首页入口；读取静态数据，组合页面组件，计算数据更新时间，并注册页面滚动出现效果。 |
| `src/layouts/BaseLayout.astro` | 提供 HTML 文档骨架、页面标题、描述和全局样式入口。 |
| `src/components/SiteHeader.astro` | 渲染品牌标题和 Bangumi 外部链接。 |
| `src/components/ProfileHero.astro` | 展示用户资料、头像、简介、Bangumi 主页和观看统计。 |
| `src/components/FavoriteRail.astro` | 展示最喜欢的动漫横向卡片轨道；支持按钮和鼠标滚轮浏览。 |
| `src/components/RecentSections.astro` | 展示最近观看、评分与短评；包含评分详情弹窗和前后评价切换。 |
| `src/components/WatchTimeline.astro` | 根据观看记录生成月份统计折线图；支持近一年、近两年和全部记录切换。 |
| `src/components/SectionHeading.astro` | 提供各内容区块共用的标题结构。 |
| `src/components/DepthGallery.astro` | 提供首页开场六幕画廊的静态标记、图片配置和画布入口。 |

Astro 负责在构建阶段生成页面结构，组件中的 `<script>` 只在浏览器加载后注册局部交互，因此页面不需要客户端框架运行时。

## 3. 数据架构

### 3.1 数据文件和类型

| 文件 | 内容和边界 |
| --- | --- |
| `src/types/bangumi.ts` | 定义 `AnimeSubject`、`AnimeEntry` 和 `BangumiPageData`，作为页面数据的 TypeScript 结构约束。 |
| `src/data/bangumi.json` | 已同步的数据快照，提交到 Git，供 Astro 构建时读取。 |
| `src/data/favorites.config.json` | 最喜欢动漫的选择配置；当前使用 `manual` 模式，最多处理前 10 条。 |
| `src/data/site.ts` | 页面标题、简介、头像路径、用户编号、外部链接和短句显示开关等静态站点配置。 |

`BangumiPageData` 当前包含以下页面数据：

```text
syncedAt       数据同步时间
profile        用户名、昵称和 Bangumi 主页
stats          看过、在看、想看数量
favorites      首页最喜欢的动漫
recentWatched  最近看过的动漫
watchHistory   全部看过记录，用于时间轴
recentReviews  按更新时间排序的有评分记录
```

### 3.2 Bangumi 同步流程

`scripts/sync-bangumi.mjs` 是唯一的外部数据同步入口，使用 Node.js 原生 `fetch` 和 `undici`：

1. 请求用户资料、全部收藏以及“看过”“在看”“想看”分类数据。
2. 按每页 50 条进行分页，避免接口分页上限导致统计或列表缺项。
3. 将 Bangumi 返回的条目压缩为页面需要的稳定字段，例如名称、图片、评分、排名、评论和更新时间。
4. 根据 `favorites.config.json` 选择最喜欢的动漫。手动配置中不在收藏分页里的条目，会额外请求条目详情进行补全。
5. 生成 `stats`、`favorites`、`recentWatched`、`watchHistory` 和 `recentReviews`。
6. 先写入 `src/data/bangumi.json.tmp`，完成后再重命名覆盖正式文件；同步失败时保留旧数据。

本地网络需要代理时，脚本读取 `HTTPS_PROXY` 或 `HTTP_PROXY` 环境变量，并通过 `ProxyAgent` 发出请求。页面运行阶段不执行这段同步逻辑。

## 4. 浏览器端交互

页面主体是静态 HTML，浏览器端只负责增强交互：

- `src/pages/index.astro` 使用 `IntersectionObserver` 为 `.reveal` 区块添加进入视口的动画类，并支持 `prefers-reduced-motion`。
- `FavoriteRail.astro` 通过横向滚动实现卡片轨道浏览，支持左右按钮和鼠标滚轮转换。
- `WatchTimeline.astro` 在已生成的多个统计面板之间切换，并将图表滚动到最新月份。
- `RecentSections.astro` 使用原生 `<dialog>` 展示完整评分与短评，支持打开、关闭和前后切换。
- `DepthGallery.astro` 将六幕配置序列化到 `data-gallery` 属性，交给 `src/scripts/depth-gallery.ts` 使用。

### 深度画廊

`src/scripts/depth-gallery.ts` 使用 Three.js 创建 WebGL 场景，负责：

- 加载 `public/images/depth-gallery/optimized/` 中的六张优化图片；
- 创建交替分布的图片平面和连续轨迹；
- 根据滚动位置更新当前幕、进度、色块和主页交接状态；
- 根据鼠标位置更新视差；
- 使用着色器生成动态背景、柔光和颗粒效果；
- 在 WebGL 不可用、纹理加载失败或用户偏好减少动态效果时回退到静态图片滚动。

画廊的布局、固定舞台、主页淡入和移动端适配位于 `src/styles/depth-gallery.css`。画廊内容配置目前直接写在 `DepthGallery.astro` 的 `galleryItems` 中。

## 5. 样式与静态资源

```text
src/styles/global.css        全局颜色变量、页面布局、内容卡片、弹窗和响应式规则
src/styles/depth-gallery.css 开场画廊的固定舞台、过渡、背景和移动端规则
public/images/profile/       头像等公开图片资源
public/images/depth-gallery/ 画廊原图和 optimized/ 优化图片
```

`public/` 下的文件会以静态资源形式直接复制到构建结果，组件通过 `/images/...` 路径引用。数据文件位于 `src/data/`，由 Astro 在构建时打包进生成的页面。

## 6. 本地开发和构建

项目使用 `package-lock.json`，推荐 Node.js 24。

```text
npm install       安装依赖
npm run dev       启动 Astro 开发服务器，端口为 3000
npm run build     先执行 astro check，再生成 dist/
npm run preview   预览构建结果
npm run sync:bangumi  从 Bangumi 同步并更新本地数据快照
```

开发端口在 `astro.config.mjs` 中配置。它只影响本机开发服务器，不影响静态构建产物和 Cloudflare 远程部署。

## 7. GitHub Actions 与 Cloudflare 部署

### 7.1 自动数据同步

`.github/workflows/sync-bangumi.yml` 有两种触发方式：

- 定时触发：`20 18 * * *`，即北京时间每天 02:20；
- `workflow_dispatch`：在 GitHub Actions 页面手动触发。

工作流运行在 `ubuntu-latest`，使用 Node.js 24，并执行：

```text
checkout
→ npm ci
→ npm run sync:bangumi
→ npm run build
→ 仅暂存 src/data/bangumi.json
→ 数据有变化时提交并推送
```

连续的自动同步会尝试 amend 上一条 `github-actions[bot]` 的 `chore: refresh Bangumi data` 提交，避免数据刷新持续增加提交数量；其他情况则创建新的自动提交。

### 7.2 静态部署

`wrangler.jsonc` 将 `./dist` 配置为 Cloudflare 静态资源目录，并设置项目名 `my-homepage`。当前仓库没有服务端 Worker 业务代码，部署内容是 Astro 生成的静态站点。

如果使用 Cloudflare 的 Git 集成，构建侧应使用：

```text
Build command: npm run build
Build output directory: dist
Node version: 24
```

如果从本地使用 Wrangler 部署，则使用：

```text
npm run build
npx wrangler deploy
```

因此，GitHub Actions 更新 `src/data/bangumi.json` 并推送后，连接到该分支的 Cloudflare 项目可以重新构建并发布最新静态页面。Cloudflare 远程构建不使用本机的 3000 端口。

## 8. 当前目录职责

```text
.
├─ .github/workflows/sync-bangumi.yml  GitHub Actions 数据同步
├─ public/                              可直接访问的静态资源
├─ scripts/sync-bangumi.mjs             Bangumi 数据同步和整理
├─ src/
│  ├─ components/                       页面展示组件和局部交互
│  ├─ data/                             页面配置和 Bangumi 数据快照
│  ├─ layouts/                          Astro 页面布局
│  ├─ pages/index.astro                 首页入口
│  ├─ scripts/depth-gallery.ts          Three.js 开场画廊运行时
│  ├─ styles/                            全局和画廊样式
│  ├─ types/bangumi.ts                  数据类型
│  └─ env.d.ts                          Astro 类型声明入口
├─ astro.config.mjs                     Astro 配置和本地开发端口
├─ wrangler.jsonc                       Cloudflare 静态资源部署配置
├─ package.json                          npm 脚本和依赖声明
├─ package-lock.json                     npm 依赖锁定文件
└─ tsconfig.json                         TypeScript 严格模式和 @/* 路径别名
```

## 9. 当前明确不采用的方案

以下目录或能力目前不存在，不应作为当前架构的一部分：

- `src/content/` 内容集合和 Markdown 动漫详情页；
- `src/services/` 服务层或运行时 Bangumi 客户端；
- `src/pages/api/` Astro API 路由；
- 数据库、登录系统和服务端渲染；
- React、Svelte 或其他客户端框架运行时。

`开发记录文档.md` 中的“推荐项目结构”属于早期设计记录；当它与本文件或当前源码不一致时，以源码和本文件记录的当前实现为准。`README.md` 负责操作说明、内容配置和视觉参数调整，不替代本架构文档。

## 10. 维护规则

发生以下变化时，应同步更新本文档：

- 新增页面入口、组件层级或数据字段；
- 改变 Bangumi 同步方式或数据文件位置；
- 引入服务端 API、数据库、SSR 或客户端框架；
- 修改 GitHub Actions、Cloudflare 构建命令或部署输出目录。

