# demo2 · 动画长评志（Stripe Press × PINTSCOPE）

独立于 `demo/` 与主站 Astro 构建流程的自包含静态样稿，直接双击 [index.html](./index.html) 即可离线浏览。

## 数据与图片自动获取规则

- 日志与关联条目全部来自 Bangumi Next 私有接口 `https://next.bgm.tv/p1`（`/users/860550/blogs`、`/blogs/{id}`、`/blogs/{id}/subjects`、`/blogs/{id}/photos`），并从 `src/data/bangumi.json` 自动关联你的个人评分与短评。
- **配图完全自动从 Bangumi 获取**：日志本身带有随文附图时优先使用附图；没有附图时自动使用关联番剧的 Bangumi 官方海报。新增日志无需手工选图。

## 页面特点

- **长评总览（[index.html](./index.html)）**：
  - 左侧图片框宽度始终 100% 填满、保持原图比例、上下超出部分裁切；整页居中对准某篇时，图片框与框内图片同时纵轴居中，上下滚动时框体轻柔平移、框内图片纯纵向反向滑动（不缩放）。
  - 跨篇连续 RGB 换色、水平滑动标题带、`[ESC]` 目录抽屉、虚线作品档案与短评引用。
- **长评阅读页（`entries/{id}.html`）**：
  - 素白底色 + 17px 标准字号，严格保留日志原文与自然段（不自行加小标题、不插摘句、无大纲与标签）。
  - 顶部 3px 阅读进度条、左粘性题头与关联作品信息；有横版随文附图时顶部全幅呈现，无附图时左侧栏完整无裁剪展示番剧海报。

## 刷新命令

```powershell
node demo2/scripts/sync.mjs
node demo2/scripts/render.mjs
```
