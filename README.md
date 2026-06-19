# 我的动漫偏好

基于 Astro 构建的静态动漫偏好单页。页面在构建时读取本地 Bangumi 数据，不会在访客打开页面时直接请求第三方接口。

## 本地开发

建议使用 Node.js 24。

```bash
npm install
npm run dev
```

默认开发地址为 http://localhost:4321。

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

### 调整个人信息

个人信息主要在 src\data\site.ts 中调整

### 调整“我最喜欢的动漫”

最喜欢动漫的生成方式由以下文件控制：

```text
src/data/favorites.config.json
```

默认使用自动模式：

```json
{
  "mode": "auto",
  "subjects": []
}
```

自动模式会从你的 Bangumi 动画收藏中筛选已评分作品，按照个人评分、Bangumi 社区评分和更新时间排序，展示前十部。

需要自行选择作品与顺序时，将 `mode` 改为 `manual`，并按希望展示的顺序填写 Bangumi 条目 ID：

```json
{
  "mode": "manual",
  "subjects": [
    {
      "id": 400602,
      "note": "旅途结束以后，故事才真正开始。"
    },
    {
      "id": 183875,
      "score": 10,
      "note": "像是这种我bangumi没有标记过的，可以手动添加 score 这个可选字样指定评分"
    },
  ]
}
```

条目 ID 可以从 Bangumi 详情页地址中获取。例如：

```text
https://bangumi.tv/subject/400602
                            └─ ID 为 400602
```

手动模式最多展示前十条配置记录，并严格遵循配置顺序。条目即使不在你的动画收藏列表中，脚本也会直接从 Bangumi 条目接口补全基础信息；ID 填写错误或条目接口请求失败时才会被忽略。

`note` 是可选个人短句。需要显示短句时，还应在 `src/data/site.ts` 中设置：

```ts
showFavoriteNotes: true
```

修改配置后重新同步并启动页面：

```powershell
$env:HTTPS_PROXY='http://127.0.0.1:7890'
npm run sync:bangumi
npm run dev
```

确认效果后提交并推送。GitHub Actions 和 Cloudflare 会自动同步与重新部署：

```bash
git add src/data/favorites.config.json src/data/bangumi.json
git commit -m "content: update favorite anime"
git push
```

## 构建与自动同步

```bash
npm run build
npm run preview
```

GitHub Actions 工作流 `.github/workflows/sync-bangumi.yml` 会每天自动同步一次，也支持在 Actions 页面手动触发。数据变化后，工作流会提交更新后的 JSON，并触发托管平台重新部署。

### 本地同步方法

确认本地代理正在运行，然后在项目目录执行：

powershell：

```powershell
$env:HTTPS_PROXY='http://127.0.0.1:7890' 
npm run sync:bangumi
```

cmd：

```
set HTTPS_PROXY=http://127.0.0.1:7890
npm run sync:bangumi
```

它会更新 bangumi.json，包括：

- 看过、在看、想看数量
- 最近看过的十部动画
- 全部有个人评分的记录；首页默认展示最近四条，弹窗可继续浏览
- 自动模式下最喜欢的十部动画

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
