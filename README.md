# trss.us.ci

个人内容站点：Vite + React 19 前端，Cloudflare Workers 承载静态资源与 `/api` 服务端逻辑，数据层使用 Workers KV。

## 架构

```
浏览器
  │
  ├─ /              → Workers 静态资源（Vite 产物，SPA 回退）
  └─ /api/*         → Worker 入口（worker/index.ts）
                       ├─ /api/auth/*     认证：会话、验证码、密码、OAuth
                       ├─ /api/articles*  文章读写
                       └─ /api/uploads, /api/media/*  媒体对象
                             │
                             ├─ AUTH_KV       会话 / 验证码 / OAuth state / 限流
                             ├─ SITE_KV       文章 / 配置 / 媒体对象
                             └─ BLOCKLIST_KV  一次性邮箱域名黑/白名单（热更新）
```

## 登录能力

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 邮箱验证码登录 | 需配置邮件通道 | 验证码只存 HMAC 指纹，5 分钟 TTL，一次性使用 |
| 邮箱密码登录 / 注册 | 开箱可用 | PBKDF2-SHA256（21 万次迭代），密码 ≥8 位且含字母与数字 |
| Google OAuth | 需配置凭据 | OpenID Connect + PKCE(S256)，强制 `email_verified` |
| GitHub OAuth | 需配置凭据 | 只接受 primary 且 verified 的邮箱 |
| 一次性邮箱拦截 | 开箱可用 | 内置约 700 条域名 + 关键词启发式 + 风险 TLD + KV 热更新 |

**风控作用于全部入口**：注册、密码登录、验证码请求与校验，以及 OAuth 回调返回的邮箱。

## 快速开始

```bash
pnpm install
cp .dev.vars.example .dev.vars   # 至少填 SESSION_SECRET
pnpm worker:dev                  # Worker → http://127.0.0.1:8787
pnpm dev                         # 前端  → http://127.0.0.1:5173（/api 代理到服务器）
```

本地 `wrangler dev` 使用模拟 KV，无需真实命名空间 ID 即可跑通全部登录流程。

### 服务器地址

默认后端地址为 **`https://47.106.222.26`**。本地联调时用环境变量或专用脚本切回本机，**无需改文件**：

```bash
# 完整本地模式：前端代理 + OAuth 回调都指向本机
WORKER_DEV_ORIGIN=http://127.0.0.1:8787 pnpm dev   # 终端 A（前端）
pnpm worker:dev:local                              # 终端 B（Worker，覆盖 PUBLIC_BASE_URL 为本机）

# 仅前端指向本机、后端仍用服务器（默认即此模式，无需额外参数）
pnpm dev

# e2e
pnpm test:e2e          # Vite 开发服务器（127.0.0.1:5173）
pnpm test:e2e:local    # 本机生产产物（127.0.0.1:8787）
pnpm test:e2e:prod     # 服务器（默认）
```

> `PUBLIC_BASE_URL` 决定 OAuth 的 `redirect_uri`。默认值为服务器地址，因此默认模式下
> OAuth 回调指向服务器；跑完整本地 OAuth 需要同时用 `worker:dev:local` 覆盖它。
> `worker:dev:local` 等价于 `wrangler dev --var PUBLIC_BASE_URL:http://127.0.0.1:8787`，
> 无需编辑 `.dev.vars`。

> ⚠️ **裸 IP 与 Google 登录不兼容**：Google 的重定向 URI 校验规则明确
> *"Hosts cannot be raw IP addresses."*（只有 localhost 例外）。因此 `PUBLIC_BASE_URL`
> 为 `https://47.106.222.26` 时**无法注册 Google 回调地址，Google 登录不可用**——
> 这是平台限制，改配置绕不过。需要 Google 登录就用域名；暂时没有域名可先只用
> 邮箱验证码或 GitHub 登录。详见 `docs/部署与OAuth配置指南.md` §3。

> 服务器上若要被外部访问，需让 Worker 绑定所有网卡：`pnpm worker:dev:public`（等价于 `wrangler dev --ip 0.0.0.0 --port 8787`）。
> 若前面有反向代理（nginx 等）转发到本机 8787，则保持 `pnpm worker:dev` 即可，**不要**绑定 `0.0.0.0`。

## 常用命令

```bash
pnpm dev               # 前端开发服务器
pnpm worker:dev        # 本地 Worker 运行时（workerd，仅监听本机）
pnpm worker:dev:local  # 同上，且 PUBLIC_BASE_URL 覆盖为本机（完整本地 OAuth）
pnpm worker:dev:public # 同上，但绑定 0.0.0.0（供外部访问）
pnpm build             # 生产构建（tsc -b && vite build）
pnpm typecheck         # 前端 + Worker 类型检查
pnpm test              # 集成测试（内存 KV + 模拟第三方端点，离线可跑）
pnpm test:e2e          # 浏览器端到端，跑 Vite 开发服务器（127.0.0.1:5173）
pnpm test:e2e:local    # 同上，跑本机生产产物（127.0.0.1:8787）
pnpm test:e2e:prod     # 同上，跑服务器（https://47.106.222.26）
pnpm worker:dry-run    # 校验 wrangler 配置与打包产物
pnpm kv:create         # 创建三个 KV 命名空间
pnpm cf:deploy         # 构建并部署
pnpm seed:build        # 由 src/data/articles.ts 重新生成 Worker 侧播种数据
```

## 目录结构

```
worker/
  index.ts                  Worker 入口与路由分发
  types.ts                  环境绑定与数据结构类型
  lib/
    http.ts                 JSON 响应、Cookie、CORS、安全响应头
    crypto.ts               PBKDF2 / HMAC / 常量时间比较 / PKCE
    email-guard.ts          邮箱准入判定（三层）
    disposable-domains.ts   一次性邮箱域名库
    session.ts              会话签发、校验、滑动续期、吊销
    rate-limit.ts           KV 计数式限流
    mailer.ts               验证码投递（Resend / Webhook / 本地回显）
    oauth.ts                Google / GitHub 授权码流程
    store.ts                KV 读写封装与键空间规划
    users.ts                用户归并（OAuth 身份 + 邮箱打通）
  routes/                   auth / articles / media
  seed/articles.ts          自动生成的 KV 播种数据
src/
  index.css                 设计令牌层（子比主题视觉语言，见 docs/视觉规范.md）
  components/layout/        页头（毛玻璃 + 滚动隐藏）、页脚、站点标识
  components/blog/          首屏横幅、文章卡片、Markdown 渲染
  components/ui/            shadcn 组件（仅保留实际使用的 3 个）
  pages/                    9 个路由页面
  lib/auth-client.ts        认证 API 客户端
  lib/AuthContext.tsx       登录态管理（跨标签页同步 + OAuth 弹窗回调）
  lib/uploads.ts            媒体上传
test/                       集成测试与内存 KV 实现
docs/
  KV-绑定可行性评估.md        可行性评估与设计决策
  部署与OAuth配置指南.md      部署、OAuth 配置、排障
  视觉规范.md                子比主题设计令牌与兼容性约束
```

## 文档

- [KV 绑定可行性评估](docs/KV-绑定可行性评估.md) —— 为什么选 KV、边界在哪、如何规避
- [部署与 OAuth 配置指南](docs/部署与OAuth配置指南.md) —— 从零到可登录的完整步骤
- [视觉规范](docs/视觉规范.md) —— 子比主题令牌取值与来源、响应式断点、兼容性约束

## 视觉与交互

界面以 [zibll.com](https://www.zibll.com/1997.html) 为参考基准，令牌取值来自对目标站点实际渲染**计算样式的抓取**而非目测近似：主色 `#ff3f9f`、无方向性柔和阴影 `0 0 10px rgba(116,116,116,.08)`、圆角 4/12px、内容宽 1300px、页头 `saturate(5) blur(20px)` 毛玻璃且下滑隐藏上滑显示。

做法上是**重写令牌层并把令牌映射到 shadcn 令牌**，而非逐个改组件——未改动的组件自动继承配色。完整取值、响应式断点与浏览器兼容性约束见 [视觉规范](docs/视觉规范.md)。

## 技术要点

- **无第三方运行时依赖**：密码学全部使用 WebCrypto，Worker 产物仅 91.5 KiB（gzip 24.4 KiB）；
- **前端零构建期密钥**：认证凭据只在 Worker 侧，前端不再需要注入任何云服务配置；
- **会话令牌不透明**：KV 中存 `HMAC(SESSION_SECRET, token)` 派生键，泄漏 KV 内容也无法构造会话；
- **邮箱风控可热更新**：`BLOCKLIST_KV` 写入 `block:` / `allow:` 即刻生效，无需重新部署；
- **静态资源优先**：仅 `/api/*` 进入 Worker（`assets.run_worker_first`），其余请求由边缘直接返回。
