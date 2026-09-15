# 部署与 OAuth 配置指南

本指南覆盖从零到可登录的完整步骤。**顺序很重要**：KV 命名空间必须在首次部署前创建，否则 Worker 启动即报绑定缺失。

---

## 0. 前置条件

- Node.js ≥ 20，pnpm ≥ 9
- Cloudflare 账号，且域名已托管在 Cloudflare（本方案默认 `trss.us.ci`）
- `npx wrangler login` 完成授权

```bash
pnpm install
```

---

## 1. 创建 KV 命名空间并回填 ID

```bash
pnpm kv:create
# 等价于：
# npx wrangler kv namespace create AUTH_KV
# npx wrangler kv namespace create SITE_KV
# npx wrangler kv namespace create BLOCKLIST_KV
```

命令会输出形如下面的片段，**把 id 填回 `wrangler.jsonc` 的 `kv_namespaces` 对应字段**：

```
[[kv_namespaces]]
binding = "AUTH_KV"
id = "a1b2c3d4e5f6478899aabbccddeeff00"
```

若同时要支持 `wrangler dev --remote`，再执行一次加 `--preview` 生成 `preview_id`：

```bash
npx wrangler kv namespace create AUTH_KV --preview
```

> 也可以用 `--update-config` 让 wrangler 自动把 id 写回 `wrangler.jsonc`（实测该 flag 在当前版本存在）：
> `npx wrangler kv namespace create SITE_KV --binding SITE_KV --update-config`
> **但本文件带注释**，自动改写有丢失注释的风险，执行后务必 `git diff wrangler.jsonc` 复查。
> 求稳就直接手工填。

> 三个命名空间的职责划分见《KV-绑定可行性评估.md》的「二、三类目标负载与 KV 的匹配度」。**不要合并成一个命名空间**：`BLOCKLIST_KV` 需要独立的高频读与热更新权限，`AUTH_KV` 承载敏感令牌，混用会让权限与配额难以隔离。

---

## 2. 注入密钥

以下三项**必须**用 secret 注入，不要写进 `wrangler.jsonc`：

```bash
# 会话签名与验证码派生密钥（必填，≥32 位随机值）
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" | npx wrangler secret put SESSION_SECRET

# OAuth 客户端密钥（按需）
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GITHUB_CLIENT_SECRET

# 邮件通道（按需，二选一）
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put MAIL_WEBHOOK_URL
```

非机密值直接写在 `wrangler.jsonc` 的 `vars` 中：

```jsonc
"vars": {
  "PUBLIC_BASE_URL": "https://trss.us.ci",
  "ENVIRONMENT": "production",
  "GOOGLE_CLIENT_ID": "xxxxxxxx.apps.googleusercontent.com",
  "GITHUB_CLIENT_ID": "Ov23liXXXXXXXXXXXXXX",
  "MAIL_FROM": "trss <no-reply@trss.us.ci>"
}
```

> `PUBLIC_BASE_URL` 必须与用户实际访问的地址完全一致（含协议、不带结尾斜杠）。它决定 OAuth 的 `redirect_uri`，不一致会直接导致 `redirect_uri_mismatch`。
>
> ⚠️ **不要把它设成裸 IP**（如 `https://47.106.222.26`）：Google 不接受裸 IP 作为回调地址（见 §3），
> 会导致 Google 登录不可用。**用域名。** 若暂时没有域名，可先只启用邮箱验证码与 GitHub 登录。
> 本工程仓库内的默认值当前是服务器 IP（按用户要求替换），**正式部署前建议改回域名**。

---

## 3. 配置 Google OAuth

1. 打开 [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → **创建凭据** → **OAuth 客户端 ID** → 应用类型选 **Web 应用**；
2. **已获授权的重定向 URI** 添加：
   ```
   https://trss.us.ci/api/auth/oauth/google/callback          # 生产域名
   http://localhost:8787/api/auth/oauth/google/callback       # 本地联调
   ```
   > ### ⚠️ Google 不接受裸 IP 回调地址
   >
   > 官方 [Redirect URI validation rules](https://developers.google.com/identity/protocols/oauth2/web-server) 明确两条硬限制：
   >
   > > "Redirect URIs must use the HTTPS scheme, not plain HTTP."
   > > "**Hosts cannot be raw IP addresses.** Localhost IP addresses are exempted from this rule."
   >
   > 即 **`https://47.106.222.26/...` 这种裸 IP 形式无论用不用 HTTPS 都无法注册**，
   > localhost 是唯一例外。**因此若站点只能通过 IP 访问，Google 登录必然不可用**——
   > 这不是配置问题，是平台限制，改配置无法绕过。
   >
   > 三种应对：① 给服务器绑定域名（推荐）；② 该场景下关闭 Google 入口，用邮箱验证码或 GitHub 登录；
   > ③ 仅把 IP 用于非 OAuth 场景（如内网预览），对外仍走域名。
3. 复制 **客户端 ID** → 填入 `vars.GOOGLE_CLIENT_ID`；
4. 复制 **客户端密钥** → `wrangler secret put GOOGLE_CLIENT_SECRET`；
5. 在 **OAuth 同意屏幕** 中确认已配置应用名称与支持邮箱（未配置会导致授权页报错）。

实现细节：Google 走标准 OpenID Connect 授权码流程，并启用 **PKCE（S256）**；用户信息取自 `openidconnect.googleapis.com/v1/userinfo`，且**强制要求 `email_verified === true`**。

---

## 4. 配置 GitHub OAuth

1. 打开 [GitHub Developer settings → OAuth Apps → New OAuth App](https://github.com/settings/developers)；
2. **Authorization callback URL** 填：
   ```
   https://trss.us.ci/api/auth/oauth/github/callback
   ```
   本地联调再加一条：
   ```
   http://127.0.0.1:8787/api/auth/oauth/github/callback
   ```
   > **GitHub OAuth App 自 2026-08-14 起支持最多 10 个回调地址**（此前只能填一个）。
   > 注册时间较早且从未修改过的应用可能仍是单条配置，去设置页确认后按需补。
   > 关于裸 IP：GitHub 未查到与 Google 同类的「禁止裸 IP」限制，但**本工程未实测过**；
   > 若确实要用 IP 形式，请先在 GitHub 设置页试填并确认能保存。
3. 创建后复制 **Client ID** → 填入 `vars.GITHUB_CLIENT_ID`；
4. **Generate a new client secret** → `wrangler secret put GITHUB_CLIENT_SECRET`。

实现细节：GitHub OAuth App 不支持 PKCE，因此以 `state` 一次性校验作为 CSRF 防护；邮箱取自 `/user/emails`，只接受 **primary 且 verified** 的地址。若用户未公开已验证邮箱，登录会失败并提示「请在 GitHub 设置中将邮箱设为 Primary 并勾选 Verified」——这是有意的：否则无法确认邮箱归属，会绕过一次性邮箱风控。

---

## 5. 配置邮件通道（邮箱验证码登录需要）

未配置时：验证码登录返回 `503 mail_channel_unconfigured`，前端会提示改用 Google / GitHub 登录。**OAuth 登录完全不受影响。**

### 方案 A：Resend（推荐）

```bash
npx wrangler secret put RESEND_API_KEY     # re_xxxxxxxx
# vars 中设置 MAIL_FROM，例如 "trss <no-reply@trss.us.ci>"
```
需在 Resend 完成发信域名验证（添加 SPF / DKIM 记录）。

### 方案 B：通用 Webhook

```bash
npx wrangler secret put MAIL_WEBHOOK_URL   # https://your-mail-gateway/send
```
Worker 会向该地址 POST：

```json
{ "to": "user@example.com", "subject": "登录验证码", "code": "123456", "expiresMinutes": 5, "html": "<html>…</html>" }
```
适用于自建邮件网关、企业 SMTP 中继或其它邮件服务商。

### 本地调试

`.dev.vars` 中设置 `ALLOW_OTP_DEV_ECHO=true`，接口会直接回显 `dev_code`，前端自动填入。**生产环境即使设了该变量也会被忽略**（`ENVIRONMENT=production` 时强制关闭）。

---

## 6. 本地开发

```bash
cp .dev.vars.example .dev.vars     # 填入本地值
pnpm worker:dev                    # Worker 运行在 http://127.0.0.1:8787
pnpm dev                           # 前端运行在 http://127.0.0.1:5173
```

本地 `wrangler dev` 使用模拟 KV，**无需真实命名空间 ID**，可直接跑通全部登录流程。

### 6.0 服务器地址与本地模式

后端地址默认是**服务器**（见仓库 README 的「服务器地址」小节），因此 `pnpm dev` 的 `/api` 默认代理到服务器。
要跑**完整本地模式**（前后端都在本机、OAuth 回调也指向本机）：

```bash
# 终端 A：Worker，并把 PUBLIC_BASE_URL 覆盖为本机（无需改 .dev.vars）
pnpm worker:dev:local

# 终端 B：前端，代理指向本机 Worker
WORKER_DEV_ORIGIN=http://127.0.0.1:8787 pnpm dev
```

三种粒度一览：

| 场景 | 前端代理 | `PUBLIC_BASE_URL` | 命令 |
| --- | --- | --- | --- |
| 本地前端 + 服务器后端（默认） | 服务器 | 服务器 | `pnpm dev` |
| 完整本地 | 本机 | 本机 | `worker:dev:local` + `WORKER_DEV_ORIGIN=… pnpm dev` |
| 服务器对外提供服务 | — | 服务器 | `pnpm worker:dev:public`（绑定 `0.0.0.0`） |

跑测试与检查：

```bash
pnpm typecheck      # 前端 + Worker 类型检查
pnpm test           # 50 项集成测试（内存 KV + 模拟第三方端点，无需联网）
pnpm worker:dry-run # 校验 wrangler 配置与打包结果
```

### 6.1 浏览器端到端验证

`scripts/e2e-login.mjs` 用真实 Chrome 驱动完整用户路径，共 27 项断言：三页签与 OAuth 入口渲染 → 临时邮箱实时拦截 → OAuth 授权地址携带 PKCE 与一次性 state → 验证码登录全链路 → 密码注册 → 封面上传与 KV 回读 → 发文 → 列表与详情页 → 登录态持久 → 登出与受保护路由重定向。

```bash
# 终端 A：Worker（三个场景都要它常驻）
pnpm worker:dev

# 终端 B：开发服务器场景——需要两个终端，因为 `pnpm dev` 是常驻进程，
# 用 `&&` 串起来的话后面的命令永远不会执行。
pnpm dev              # 终端 B，常驻
pnpm test:e2e         # 终端 C —— 打 127.0.0.1:5173

# 本机生产产物场景：build 不是常驻进程，可以串起来。
# wrangler dev 会直接托管 dist/，与线上拓扑一致。
pnpm build && pnpm test:e2e:local     # 打 127.0.0.1:8787

# 服务器场景
pnpm test:e2e:prod                    # 打 https://47.106.222.26
```

> 三个 e2e 脚本的**目标各不相同**，别混用：`test:e2e` = 本机 dev 服务器，
> `test:e2e:local` = 本机生产产物，`test:e2e:prod` = 服务器。

两点说明：

- **为什么生产验证用 `wrangler dev` 而不是 `vite preview`**：`vite preview` 不代理 `/api`，且不经过 Worker。用 `wrangler dev` 托管 `dist/` 才同时覆盖 Worker 入口、`ASSETS` 绑定与 `run_worker_first`，与线上一致。
- **限流与重复运行**：限流按客户端 IP 计数，而本地 KV 跨进程保留。脚本会为每轮分配独立的客户端 IP 桶，因此可连续重复执行而不会撞 429。生产环境由 Cloudflare 边缘覆盖 `CF-Connecting-IP`，客户端无法伪造。

---

## 7. 部署

### 方式一：命令行

```bash
pnpm cf:deploy      # = pnpm build && wrangler deploy
```

### 方式二：Cloudflare Workers Builds（Git 集成）

| 配置项 | 值 |
| --- | --- |
| Build command | `pnpm build` |
| Deploy command | `npx wrangler deploy` |
| 根目录 | 仓库根目录 |

**必须提交 `wrangler.jsonc`**（本仓库已包含）。缺失时 wrangler 会在非交互环境启动自动配置向导，用 npx 拉取未固定版本的 wrangler、改写构建命令，并生成缺少 `assets.directory` 的配置，导致部署失败——这是原项目提交记录中出现过的故障。

**不要在构建环境注入 CloudBase 凭据**：认证已完全由 Worker + KV 承载，前端不再需要任何构建期密钥。

---

## 8. 上线后验证清单

```bash
BASE=https://trss.us.ci

# 1) 绑定与密钥状态（bindings 四项、secrets.SESSION_SECRET 均应为 true）
curl -s $BASE/api/health
# 期望：data.bindings = {AUTH_KV,SITE_KV,BLOCKLIST_KV,ASSETS} 全为 true
#       data.secrets.SESSION_SECRET 为 true
#       data.secrets.MAIL 反映邮件通道是否配好（未配邮件通道时为 false，属正常）

# 2) 登录入口探测
curl -s $BASE/api/auth/providers
# 期望：{"email":true,"mail_channel":<bool>,"dev_echo":<bool>,
#        "oauth":{"google":<bool>,"github":<bool>}}
# 注意 google/github 是嵌在 oauth 下的，不是顶层字段

# 3) 一次性邮箱预检（注意：这里是 200，不是 403）
curl -s -X POST $BASE/api/auth/email/check -H 'content-type: application/json' -d '{"email":"a@mailinator.com"}'
# 期望：HTTP 200 且 data.allowed=false、data.code="email_disposable"
# 该接口是「预检」语义——它回答「这个邮箱能不能用」，所以用 200 承载否定结果。
# 真正的 403 出现在提交动作上（见第 4 项）。

# 4) 一次性邮箱提交注册应被拒绝（这里才是 403）
curl -s -o /dev/null -w '%{http_code}\n' -X POST $BASE/api/auth/register \
  -H 'content-type: application/json' -d '{"email":"a@mailinator.com","password":"Passw0rd123"}'
# 期望：403，响应体 code="email_disposable"

# 5) 正常邮箱应放行
curl -s -X POST $BASE/api/auth/email/check -H 'content-type: application/json' -d '{"email":"you@gmail.com"}'
# 期望：data.allowed=true

# 6) 文章数据源（期望返回 KV 中的文章列表）
curl -s $BASE/api/articles | head -c 200

# 7) OAuth 跳转（期望 302 到 accounts.google.com，且带 code_challenge）
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' "$BASE/api/auth/oauth/google/start"
```

> 第 3 项与第 4 项的区别容易踩坑：**预检接口用 200 承载否定结果，提交接口才用 403**。
> 若把第 3 项按「期望 403」去核对，会误判成风控失效。

浏览器侧：登录页应显示「邮箱验证码 / 密码登录 / 注册账号」三个页签，以及已配置的 Google / GitHub 按钮；点击后弹窗完成授权并自动登录跳转 `/studio`。

---

## 9. 故障排查

| 现象 | 定位 | 处置 |
| --- | --- | --- |
| 登录页显示「登录通道尚未配置」 | `/api/auth/providers` 返回 `mail_channel:false` 且两个 OAuth 均为 false | 按 §3–§5 配置任一通道 |
| 点击 OAuth 报 `provider_unconfigured` | `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` 缺失 | 补 `vars` 或 `wrangler secret put` |
| `redirect_uri_mismatch` | `PUBLIC_BASE_URL` 与 OAuth 控制台回调地址不一致 | 二者改为完全一致（注意 `http` vs `https`、结尾斜杠、`127.0.0.1` vs `localhost`） |
| **Google 控制台拒绝保存回调地址，或 OAuth 一直失败** | `PUBLIC_BASE_URL` 是**裸 IP** | **Google 不接受裸 IP 主机名**（官方 validation rules: "Hosts cannot be raw IP addresses."）。改用域名，或该场景下关闭 Google 入口 |
| 注册/登录返回 `server_misconfigured` | `SESSION_SECRET` 未注入或短于 16 位 | 执行 §2 的 secret 命令后重新部署 |
| 验证码接口返回 `mail_channel_unconfigured` | 邮件通道未配置 | 配置 Resend 或 Webhook，或改用 OAuth 登录 |
| OAuth 回调跳回 `/auth/callback?auth=error` | 页面会显示具体原因 | 常见：邮箱未验证、邮箱命中一次性邮箱风控、state 过期（>10 分钟） |
| 新注册用户短暂无法登录 | KV 跨区域最终一致（≤60s） | 属预期行为；如需强一致改用 Durable Object |
| 上传返回 `file_too_large` | 单文件超过 2 MiB | 压缩文件，或将媒体层迁移至 R2（见评估报告 §4.5） |

### 邮箱黑名单热更新

无需重新部署，直接写 KV：

```bash
npx wrangler kv key put --binding=BLOCKLIST_KV "block:spam-farm.example" "1" --remote
npx wrangler kv key put --binding=BLOCKLIST_KV "allow:partner-corp.com" "1" --remote
```

`allow:` 优先级最高，可用于放行被内置清单误伤的域名。

### 批量吊销会话

```bash
# 查看会话键（键名即 HMAC 派生值，不含任何用户信息）
npx wrangler kv key list --binding=AUTH_KV --prefix "sess:" --remote

# 吊销单个会话
npx wrangler kv key delete --binding=AUTH_KV "sess:<hash>" --remote
```

> 注意：因会话键由 `SESSION_SECRET` 派生，**轮换 SESSION_SECRET 会使全部存量会话立即失效**（所有用户需重新登录）。这既是应急吊销手段，也意味着轮换需安排在低峰期。
