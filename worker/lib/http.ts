import type { AppEnv } from '../types.ts'

export const SESSION_COOKIE = 'trss_session'

export class ApiError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  headers.set('content-type', 'application/json; charset=utf-8')
  headers.set('cache-control', 'no-store')
  return new Response(JSON.stringify(data), { ...init, headers })
}

export function ok<T>(data: T, init: ResponseInit = {}): Response {
  return json({ status: 'success', data }, init)
}

export function fail(status: number, code: string, message: string, extra: Record<string, unknown> = {}): Response {
  return json({ status: 'error', code, message, ...extra }, { status })
}

export function fromError(error: unknown): Response {
  if (error instanceof ApiError) return fail(error.status, error.code, error.message)
  const message = error instanceof Error ? error.message : '服务器内部错误'
  return fail(500, 'internal_error', message)
}

/** 解析请求体 JSON，带体积上限，防止超大载荷打爆 CPU/内存。 */
export async function readJson<T>(request: Request, maxBytes = 64 * 1024): Promise<T> {
  const length = Number(request.headers.get('content-length') || '0')
  if (length > maxBytes) throw new ApiError(413, 'payload_too_large', '请求内容过大')
  const text = await request.text()
  if (text.length > maxBytes) throw new ApiError(413, 'payload_too_large', '请求内容过大')
  if (!text.trim()) return {} as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw new ApiError(400, 'invalid_json', '请求体不是合法 JSON')
  }
}

/** 取客户端 IP，用于限流。CF-Connecting-IP 由 Cloudflare 边缘注入，不可被伪造。 */
/**
 * 取客户端 IP，用于限流与会话审计。
 *
 * 安全前提：这些请求头**必须由可信代理写入**。部署在 Cloudflare 上时，
 * 边缘节点会覆盖客户端自带的 `CF-Connecting-IP`，因此无法伪造；
 * 本地 `wrangler dev` 不做覆盖，客户端可自带该头改变限流桶（仅影响本地调试）。
 * 若将来把本 Worker 置于其他反代之后，需确保该代理同样覆盖这几个头，
 * 否则限流可被绕过。
 */
export function clientIp(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-real-ip') ||
    (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
    'unknown'
  )
}

export function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.get('cookie') || ''
  const jar: Record<string, string> = {}
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index < 1) continue
    jar[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim())
  }
  return jar
}

export function serializeCookie(
  name: string,
  value: string,
  options: { maxAge?: number; path?: string; sameSite?: 'Lax' | 'Strict' | 'None'; secure?: boolean; httpOnly?: boolean } = {},
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`]
  parts.push(`Path=${options.path ?? '/'}`)
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`)
  parts.push(`SameSite=${options.sameSite ?? 'Lax'}`)
  if (options.secure !== false) parts.push('Secure')
  if (options.httpOnly !== false) parts.push('HttpOnly')
  return parts.join('; ')
}

/** 仅同源或白名单来源可携带凭据访问 API。 */
export function corsHeaders(request: Request, env: AppEnv): Record<string, string> {
  const origin = request.headers.get('origin')
  if (!origin) return {}
  const allowList = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  const selfOrigin = safeOrigin(env.PUBLIC_BASE_URL)
  const allowed = origin === selfOrigin || allowList.includes(origin)
  if (!allowed) return {}
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
    vary: 'Origin',
  }
}

export function safeOrigin(value: string | undefined): string {
  if (!value) return ''
  try {
    return new URL(value).origin
  } catch {
    return ''
  }
}

/** 统一附加安全响应头。 */
export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers)
  headers.set('x-content-type-options', 'nosniff')
  headers.set('referrer-policy', 'strict-origin-when-cross-origin')
  headers.set('x-frame-options', 'SAMEORIGIN')
  headers.set('permissions-policy', 'geolocation=(), microphone=(), camera=()')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}
