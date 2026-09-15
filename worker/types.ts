/**
 * Worker 运行环境类型定义。
 *
 * KV 采用结构化接口（KVNamespaceLike）而非直接依赖 @cloudflare/workers-types，
 * 目的是让同一份 Worker 代码既能在 Cloudflare 运行时（注入真实 KVNamespace），
 * 也能在 Node 集成测试中注入内存实现，从而做到「零改动、可测试」。
 */

export interface KVListResult {
  keys: { name: string; expiration?: number; metadata?: unknown }[]
  list_complete: boolean
  cursor?: string
}

export interface KVPutOptions {
  expiration?: number
  expirationTtl?: number
  metadata?: unknown
}

/** KV 绑定的最小可用子集，真实 KVNamespace 天然满足该结构。 */
export interface KVNamespaceLike {
  get(key: string, type?: 'text'): Promise<string | null>
  get(key: string, type: 'json'): Promise<unknown | null>
  put(key: string, value: string, options?: KVPutOptions): Promise<void>
  delete(key: string): Promise<void>
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<KVListResult>
}

/** 静态资源绑定（Workers Static Assets）。 */
export interface AssetsBinding {
  fetch: (request: Request) => Promise<Response>
}

export interface AppEnv {
  /** 静态资源绑定，未绑定时（纯 API 部署）自动降级。 */
  ASSETS?: AssetsBinding

  /** 身份验证令牌：会话、验证码、OAuth state、限流计数。 */
  AUTH_KV: KVNamespaceLike
  /** 站点数据：文章、配置、媒体对象（低延迟读取 + 高吞吐）。 */
  SITE_KV: KVNamespaceLike
  /** 邮箱风控：一次性邮箱域名黑/白名单，可热更新无需重新部署。 */
  BLOCKLIST_KV: KVNamespaceLike

  /** 站点对外基址，用于拼装 OAuth 回调地址，例如 https://trss.us.ci */
  PUBLIC_BASE_URL?: string
  /** 允许携带凭据跨域访问的来源，逗号分隔；留空则仅同源。 */
  ALLOWED_ORIGINS?: string

  /** Google OAuth 客户端 ID（非机密，可放 vars）。 */
  GOOGLE_CLIENT_ID?: string
  /** Google OAuth 客户端密钥（机密，用 wrangler secret put 注入）。 */
  GOOGLE_CLIENT_SECRET?: string
  /** GitHub OAuth App Client ID（非机密，可放 vars）。 */
  GITHUB_CLIENT_ID?: string
  /** GitHub OAuth App Client Secret（机密）。 */
  GITHUB_CLIENT_SECRET?: string

  /** 会话令牌签名与验证码派生密钥（机密，必须设置）。 */
  SESSION_SECRET?: string

  /** 邮件通道：Resend API Key。 */
  RESEND_API_KEY?: string
  /** 发件人，例如 "trss <no-reply@trss.us.ci>"。 */
  MAIL_FROM?: string
  /** 通用邮件 Webhook（无 Resend 时的替代通道）。 */
  MAIL_WEBHOOK_URL?: string
  /** 仅开发环境：允许在接口响应中回显验证码。生产必须留空。 */
  ALLOW_OTP_DEV_ECHO?: string

  /** 运行环境标记：production / preview / development。 */
  ENVIRONMENT?: string
}

export interface SessionUser {
  uid: string
  email: string
  name: string
  avatar_url: string
  provider: string
  email_verified: boolean
}

export interface StoredUser extends SessionUser {
  created_at: string
  last_login_at: string
}

export type ExecutionContextLike = { waitUntil: (promise: Promise<unknown>) => void }
