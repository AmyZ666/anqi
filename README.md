# 暗棋

中国象棋暗棋变体：将帅明牌固定，其余 30 子随机扣着打乱。暗子按**所在点位**的能力走，走动后翻开并按真实身份、真实颜色归属。

- 红方永远先走；首局红黑随机，之后每局结束交换。
- 每个人看到的棋盘都是自己这方在下面。
- 可以请求悔棋，对方同意后撤回你最近一步（对方已应对则连同对方那一步一起撤回）；翻开的暗子会恢复为暗子。

## 三种玩法

| 玩法 | 需要 | 说明 |
|---|---|---|
| **面对面（点对点）** | 同一 Wi-Fi 或热点，不需要服务器 | 房主手机页面里运行 Hub，客人通过 WebRTC 连入。适合手机，PWA 安装后可离线 |
| **服务器大厅** | 一台内网服务器（Docker） | 同事都访问同一地址，大厅里点加入 |
| **本地双人** | 无 | 调试规则用，`/#local` 直达 |

## 结构

- `packages/engine` 规则引擎（纯 TS）。浏览器与服务器共用。
- `packages/hub` 房间、对局、重连、再来一局。不依赖任何网络库，所以既能跑在 Node 服务器里，也能跑在房主的浏览器里。
- `apps/server` Node + ws：静态托管、WebSocket 转发。
- `apps/web` Vite 原生 TS 前端（SVG 棋盘、二维码、PWA）。
- `tools/` 开发工具：端到端冒烟、浏览器自检、图标生成。

## 开发

```bash
npm install
npm run dev:server        # :8080
npm run dev:web           # :5173，/ws 已代理到 :8080
npm test                  # 引擎 + Hub 测试
npm run typecheck
```

## 面对面对战怎么用

1. 两台手机都先**联网打开一次**部署好的页面，"添加到主屏幕"（iPhone：Safari 分享 → 添加到主屏幕；安卓：Chrome 菜单 → 安装应用）。之后从主屏幕图标打开，**不再需要联网**。
2. 两台手机连同一个 Wi-Fi，或一台开热点、另一台连上。
3. 房主点"我来当房主"，屏幕出现二维码。
4. 客人点"加入朋友的房间"，扫房主的二维码，屏幕出现回复二维码。
5. 房主点"第 2 步"，扫客人的回复二维码。连通后自动开局。

扫码不方便时，每一步都可以"复制连接码"，通过微信等发给对方，再粘贴。

对局中断线：对局界面点"重新连接"，重新走一遍上面的握手，对局会接着打（棋谱在房主手里）。**房主关掉页面，对局就没了。**

### 排障

- 连接码下方提示"使用 .local 地址"：浏览器隐藏了真实 IP。允许摄像头权限后重新生成，通常就变成真实 IP。
- 两台手机在同一 Wi-Fi 但连不上：路由器可能开了"AP 隔离"或"访客网络"，改用一台手机开热点。
- iPhone 需要 iOS 16.4 以上才能完整支持 PWA 的摄像头和 WebRTC。

## 部署

### GitHub Pages（面对面对战用）

仓库推送到 GitHub 的 `main` 分支后，`.github/workflows/pages.yml` 会自动测试、构建并发布。
首次需要在仓库 **Settings → Pages → Build and deployment → Source** 选 **GitHub Actions**。
发布后的地址是 `https://<用户名>.github.io/<仓库名>/`。

Pages 是 HTTPS，浏览器不允许它连 `ws://` 服务器，所以从这个地址打开时只有"面对面"和"本地双人"。

### 内网服务器（Docker）

在有网络的机器上构建并导出：

```bash
docker build -t anqi:latest .
docker save anqi:latest | gzip > anqi.tar.gz
```

拷贝到服务器后：

```bash
gunzip -c anqi.tar.gz | docker load
docker run -d --name anqi --restart unless-stopped -p 8080:8080 anqi:latest
```

同事访问 `http://<服务器IP>:8080/`。健康检查：`/healthz`。前置反向代理时需开启 WebSocket 升级（`/ws`）。
纯 HTTP 下摄像头不可用，也不能安装 PWA，但服务器大厅功能完全正常。

## 工具

```bash
npm run smoke                                   # 两个机器人连服务器对局到结束
node tools/browser-selftest.mjs http://localhost:8099/#selftest   # 浏览器内 WebRTC 全流程自检
node tools/e2e-p2p.mjs http://localhost:8099/                     # 两个标签页走完整 UI 握手流程
node tools/offline-check.mjs http://localhost:8099/               # 验证 PWA 离线可用
node tools/gen-icons.mjs                                          # 由 icon.svg 生成 PNG 图标
```

这些工具默认用本机 Edge（`BROWSER` 环境变量可改）。

测试
