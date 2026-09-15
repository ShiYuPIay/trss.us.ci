import type { AppEnv, SessionUser, StoredUser } from '../types.ts'
import { ApiError, SESSION_COOKIE, parseCookies, serializeCookie } from './http.ts'
import { hmacHex, randomToken } from './crypto.ts'
import { KEYS, getJson, putJson, removeKey } from './store.ts'

export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60
const REFRESH_THRESHOLD_RATIO = 0.5

export interface SessionRecord {
  token_hash: string
  uid: string
  provider: string
  created_at: string
  expires_at: string
  ip: string
  user_agent: string
}

function requireSecret(env: AppEnv): string {
  const secret = env.SESSION_SECRET
  if (!secret || secret.length < 16) {
    throw new ApiError(
      500,
      'server_misconfigured',
      '服务端缺少 SESSION_SECRET 配置，请先执行 wrangler secret put SESSION_SECRET',
    )
  }
  return secret
}

export function sessionSecret(env: AppEnv): string {
  return requireSecret(env)
}

/**
 * 会话键由 HMAC(SESSION_SECRET, token) 派生，而非直接哈希令牌。
 * 这样即使 KV 内容被读取或篡改，缺少密钥也无法构造出可用的会话键，
 * 同时缺失 SESSION_SECRET 时会在签发阶段立刻失败（fail fast），而不是静默降级。
 */
async function sessionKey(env: AppEnv, token: string): Promise<string> {
  return hmacHex(requireSecret(env), `session:${token}`)
}

/** 令牌明文只返回给客户端一次，KV 中仅存派生键。 */
export async function createSession(
  env: AppEnv,
  user: SessionUser,
  meta: { ip: string; userAgent: string },
): Promise<{ token: string; expiresAt: string; maxAge: number }> {
  const token = randomToken(32)
  const tokenHash = await sessionKey(env, token)
  const now = Date.now()
  const expiresAt = new Date(now + SESSION_TTL_SECONDS * 1000).toISOString()

  const record: SessionRecord = {
    token_hash: tokenHash,
    uid: user.uid,
    provider: user.provider,
    created_at: new Date(now).toISOString(),
    expires_at: expiresAt,
    ip: meta.ip,
    user_agent: meta.userAgent.slice(0, 200),
  }

  await putJson(env.AUTH_KV, KEYS.session(tokenHash), record, SESSION_TTL_SECONDS)
  return { token, expiresAt, maxAge: SESSION_TTL_SECONDS }
}

export async function readSession(
  env: AppEnv,
  request: Request,
): Promise<{ record: SessionRecord; tokenHash: string } | null> {
  const token = extractToken(request)
  if (!token) return null
  const tokenHash = await sessionKey(env, token)
  const record = await getJson<SessionRecord>(env.AUTH_KV, KEYS.session(tokenHash))
  if (!record) return null
  if (new Date(record.expires_at).getTime() <= Date.now()) {
    await removeKey(env.AUTH_KV, KEYS.session(tokenHash))
    return null
  }
  return { record, tokenHash }
}

export async function destroySession(env: AppEnv, request: Request): Promise<void> {
  const session = await readSession(env, request)
  if (session) await removeKey(env.AUTH_KV, KEYS.session(session.tokenHash))
}

/** 剩余有效期不足一半时顺延，减少长期在线用户的重新登录次数。 */
export async function touchSession(env: AppEnv, tokenHash: string, record: SessionRecord): Promise<void> {
  const remaining = new Date(record.expires_at).getTime() - Date.now()
  if (remaining > SESSION_TTL_SECONDS * 1000 * REFRESH_THRESHOLD_RATIO) return
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString()
  await putJson(env.AUTH_KV, KEYS.session(tokenHash), { ...record, expires_at: expiresAt }, SESSION_TTL_SECONDS)
}

export function extractToken(request: Request): string {
  const header = request.headers.get('authorization') || ''
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim()
  const cookies = parseCookies(request)
  return cookies[SESSION_COOKIE] || ''
}

export function sessionCookie(token: string, maxAge: number): string {
  return serializeCookie(SESSION_COOKIE, token, { maxAge, sameSite: 'Lax', secure: true, httpOnly: true })
}

export function clearSessionCookie(): string {
  return serializeCookie(SESSION_COOKIE, '', { maxAge: 0, sameSite: 'Lax', secure: true, httpOnly: true })
}

export async function loadUser(env: AppEnv, uid: string): Promise<StoredUser | null> {
  return getJson<StoredUser>(env.AUTH_KV, KEYS.user(uid))
}

export async function saveUser(env: AppEnv, user: StoredUser): Promise<void> {
  await putJson(env.AUTH_KV, KEYS.user(user.uid), user)
}

export function toSessionUser(user: StoredUser): SessionUser {
  return {
    uid: user.uid,
    email: user.email,
    name: user.name,
    avatar_url: user.avatar_url,
    provider: user.provider,
    email_verified: user.email_verified,
  }
}
