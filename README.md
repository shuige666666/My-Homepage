# 我的动漫偏好

基于 Astro 构建的静态动漫偏好单页。页面在构建时读取本地 Bangumi 数据，不会在访客打开页面时直接请求第三方接口。

## 本地开发

建议使用 Node.js 24。

```bash
npm install
npm run dev
```

默认开发地址为 `http://localhost:4321`。

## 同步 Bangumi 数据

同步脚本会读取用户 `860550` 的公开动画收藏，并更新：

- 看过、在看、想看数量；
- 个人评分最高的十部动画；
- 最近看过的十部动画；
- 最近评分与短评。

直接同步：

```bash
npm run sync:bangumi
```

本地需要代理时，可在 PowerShell 中执行：

```powershell
$env:HTTPS_PROXY='http://127.0.0.1:7890'
npm run sync:bangumi
```

脚本只有在全部请求和数据整理成功后才会替换 `src/data/bangumi.json`。同步失败时，旧数据会继续保留。

## 替换头像

将正方形头像图片放到以下位置：

```text
public/images/profile/avatar.webp
```

推荐使用至少 `512 × 512` 像素的 WebP 图片。图片不存在时，页面会自动显示用户名首字作为占位头像。

## 页面配置

自我介绍、外部链接和个人短句开关位于：

```text
src/data/site.ts
```

将 `showFavoriteNotes` 设置为 `true` 后，评分前十条目中存在的可选 `note` 字段才会显示。

## 构建与自动同步

```bash
npm run build
npm run preview
```

GitHub Actions 工作流 `.github/workflows/sync-bangumi.yml` 会每天自动同步一次，也支持在 Actions 页面手动触发。数据变化后，工作流会提交更新后的 JSON，并触发托管平台重新部署。

### Cloudflare Workers 部署设置

连接 GitHub 仓库后，使用以下构建设置：

```text
Project name: my-homepage
Build command: npm run build
Deploy command: npx wrangler deploy
Production branch: main
```

在高级设置中添加构建环境变量：

```text
NODE_VERSION=24
```

`wrangler.jsonc` 会将 Astro 生成的 `dist` 目录作为静态资源部署，不会启用服务端渲染或额外 Worker 逻辑。
