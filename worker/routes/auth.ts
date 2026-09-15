import type { AppEnv, SessionUser } from '../types.ts'
import { ApiError, clientIp, fail, ok, readJson } from '../lib/http.ts'
import {
  hashPassword,
  otpFingerprint,
  pkceChallenge,
  randomDigits,
  randomToken,
  sha256Hex,
  timingSafeEqualString,
  verifyPassword,
} from '../lib/crypto.ts'
import { checkEmail } from '../lib/email-guard.ts'
import { hitRateLimit, resetRateLimit } from '../lib/rate-limit.ts'
import { KEYS, getJson, putJson, removeKey } from '../lib/store.ts'
import { isDevEchoEnabled, sendOtpMail } from '../lib/mailer.ts'
import {
  PROVIDERS,
  buildAuthorizeUrl,
  exchangeCode,
  fetchProfile,
  isProviderConfigured,
  parseProvider,
} from '../lib/oauth.ts'
import {
  clearSessionCookie,
  createSession,
  destroySession,
  loadUser,
  readSession,
  sessionCookie,
  sessionSecret,
  toSessionUser,
  touchSession,
} from '../lib/session.ts'
import { createUser, findUserByEmail, touchLogin, upsertEmailUser, upsertOAuthUser } from '../lib/users.ts'

const OTP_TTL_SECONDS = 300
const OTP_MAX_ATTEMPTS = 5
const OAUTH_STATE_TTL_SECONDS = 600

interface OtpRecord {
  fingerprint: string
  attempts: number
  created_at: string
}

interface OAuthStateRecord {
  provider: string
  code_verifier?: string
  return_to: string
  popup: boolean
  created_at: string
}

/** 密码策略：长度 8–128，且同时包含字母与数字。 */
export function validatePassword(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < 8) return '密码至少需要 8 位字符'
  if (password.length > 128) return '密码长度不能超过 128 位'
  if (!/[A-Za-z]/.test(password)) return '密码需要包含至少一个字母'
  if (!/\d/.test(password)) return '密码需要包含至少一个数字'
  return null
}

/** 只允许同源相对路径回跳，杜绝 open redirect。 */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/studio'
  return value
}

async function ensureRateLimit(
  env: AppEnv,
  bucket: string,
  identifier: string,
  limit: number,
  windowSeconds: number,
  message: string,
): Promise<void> {
  const result = await hitRateLimit(env.AUTH_KV, bucket, identifier, limit, windowSeconds)
  if (!result.allowed) {
    throw new ApiError(429, 'rate_limited', `${message}，请在 ${Math.ceil(result.retryAfter / 60)} 分钟后再试`)
  }
}

async function issueSession(env: AppEnv, request: Request, user: SessionUser): Promise<Response> {
  const { token, maxAge, expiresAt } = await createSession(env, user, {
    ip: clientIp(request),
    userAgent: request.headers.get('user-agent') || '',
  })
  return ok({ user, expires_at: expiresAt, token }, { headers: { 'set-cookie': sessionCookie(token, maxAge) } })
}

export async function handleAuth(request: Request, env: AppEnv, url: URL): Promise<Response> {
  const path = url.pathname.replace(/\/+$/, '') || '/api/auth'
  const method = request.method.toUpperCase()

  if (method === 'OPTIONS') return new Response(null, { status: 204 })

  // —— 能力探测：前端据此决定展示哪些登录入口 ——
  if (path === '/api/auth/providers' && method === 'GET') {
    return ok({
      email: true,
      mail_channel: Boolean(env.RESEND_API_KEY || env.MAIL_WEBHOOK_URL || isDevEchoEnabled(env)),
      dev_echo: isDevEchoEnabled(env),
      oauth: {
        google: isProviderConfigured(env, 'google'),
        github: isProviderConfigured(env, 'github'),
      },
    })
  }

  // —— 邮箱准入实时校验（前端输入即反馈，避免填完表单才被拒） ——
  if (path === '/api/auth/email/check' && method === 'POST') {
    const body = await readJson<{ email?: string }>(request)
    const verdict = await checkEmail(body.email, env.BLOCKLIST_KV)
    return ok({ allowed: verdict.ok, reason: verdict.ok ? '' : verdict.reason, code: verdict.ok ? '' : verdict.code })
  }

  // —— 注册（邮箱 + 密码） ——
  if (path === '/api/auth/register' && method === 'POST') {
    const body = await readJson<{ email?: string; password?: string; name?: string }>(request)
    await ensureRateLimit(env, 'register:ip', clientIp(request), 10, 3600, '注册请求过于频繁')

    const verdict = await checkEmail(body.email, env.BLOCKLIST_KV)
    if (!verdict.ok) throw new ApiError(403, verdict.code, verdict.reason)

    const passwordError = validatePassword(body.password)
    if (passwordError) throw new ApiError(400, 'weak_password', passwordError)

    const emailHash = await sha256Hex(verdict.email)
    const existingPassword = await getJson<unknown>(env.AUTH_KV, KEYS.password(emailHash))
    if (existingPassword) throw new ApiError(409, 'email_exists', '该邮箱已注册，请直接登录')

    const existingUser = await findUserByEmail(env, verdict.email)
    // 已存在的账号（例如先用 Google 登录过）允许补设密码；已有密码的情况在上一步已被拒。
    const user = existingUser
      ? await touchLogin(env, existingUser, {})
      : await createUser(env, {
          email: verdict.email,
          name: body.name,
          provider: 'password',
          emailVerified: false,
        })

    const record = await hashPassword(body.password as string)
    await putJson(env.AUTH_KV, KEYS.password(emailHash), record)

    return issueSession(env, request, toSessionUser(user))
  }

  // —— 登录（邮箱 + 密码） ——
  if (path === '/api/auth/login' && method === 'POST') {
    const body = await readJson<{ email?: string; password?: string }>(request)
    await ensureRateLimit(env, 'login:ip', clientIp(request), 30, 900, '登录尝试过于频繁')

    const verdict = await checkEmail(body.email, env.BLOCKLIST_KV)
    if (!verdict.ok) throw new ApiError(403, verdict.code, verdict.reason)
    await ensureRateLimit(env, 'login:email', verdict.email, 8, 900, '该邮箱登录尝试过于频繁')

    if (typeof body.password !== 'string' || !body.password) {
      throw new ApiError(400, 'password_required', '请输入密码')
    }

    const emailHash = await sha256Hex(verdict.email)
    const record = await getJson<{ algo: 'PBKDF2-SHA256'; iterations: number; salt: string; hash: string }>(
      env.AUTH_KV,
      KEYS.password(emailHash),
    )
    const passwordOk = record ? await verifyPassword(body.password, record) : false
    if (!passwordOk) {
      // 统一错误文案，避免暴露「邮箱是否已注册」。
      throw new ApiError(401, 'invalid_credentials', '邮箱或密码错误')
    }

    const user = await upsertEmailUser(env, verdict.email)
    await resetRateLimit(env.AUTH_KV, 'login:email', verdict.email)
    return issueSession(env, request, toSessionUser(user))
  }

  // —— 邮箱验证码：请求 ——
  if (path === '/api/auth/otp/request' && method === 'POST') {
    const body = await readJson<{ email?: string }>(request)
    await ensureRateLimit(env, 'otp:ip', clientIp(request), 20, 3600, '验证码请求过于频繁')

    const verdict = await checkEmail(body.email, env.BLOCKLIST_KV)
    if (!verdict.ok) throw new ApiError(403, verdict.code, verdict.reason)
    await ensureRateLimit(env, 'otp:email', verdict.email, 5, 600, '该邮箱验证码请求过于频繁')

    const secret = sessionSecret(env)
    const code = randomDigits(6)
    const record: OtpRecord = {
      fingerprint: await otpFingerprint(secret, verdict.email, code),
      attempts: 0,
      created_at: new Date().toISOString(),
    }
    await putJson(env.AUTH_KV, KEYS.otp(await sha256Hex(verdict.email)), record, OTP_TTL_SECONDS)

    const delivery = await sendOtpMail(env, verdict.email, code, Math.round(OTP_TTL_SECONDS / 60))
    return ok({
      sent: true,
      channel: delivery.channel,
      expires_in: OTP_TTL_SECONDS,
      ...(delivery.channel === 'dev-echo' ? { dev_code: code } : {}),
    })
  }

  // —— 邮箱验证码：校验 ——
  if (path === '/api/auth/otp/verify' && method === 'POST') {
    const body = await readJson<{ email?: string; code?: string }>(request)
    const verdict = await checkEmail(body.email, env.BLOCKLIST_KV)
    if (!verdict.ok) throw new ApiError(403, verdict.code, verdict.reason)
    await ensureRateLimit(env, 'otpverify:email', verdict.email, 12, 600, '验证码校验次数过多')

    const emailHash = await sha256Hex(verdict.email)
    const record = await getJson<OtpRecord>(env.AUTH_KV, KEYS.otp(emailHash))
    if (!record) throw new ApiError(400, 'otp_expired', '验证码已失效，请重新获取')

    const code = String(body.code || '').trim()
    if (!/^\d{6}$/.test(code)) throw new ApiError(400, 'otp_invalid', '请输入 6 位数字验证码')

    const secret = sessionSecret(env)
    const actual = await otpFingerprint(secret, verdict.email, code)
    if (!timingSafeEqualString(record.fingerprint, actual)) {
      const attempts = record.attempts + 1
      if (attempts >= OTP_MAX_ATTEMPTS) {
        await removeKey(env.AUTH_KV, KEYS.otp(emailHash))
        throw new ApiError(400, 'otp_locked', '验证码错误次数过多，请重新获取')
      }
      await putJson(env.AUTH_KV, KEYS.otp(emailHash), { ...record, attempts }, OTP_TTL_SECONDS)
      throw new ApiError(400, 'otp_invalid', `验证码不正确，还可尝试 ${OTP_MAX_ATTEMPTS - attempts} 次`)
    }

    // 一次性使用：校验通过立即删除，防止重放。
    await removeKey(env.AUTH_KV, KEYS.otp(emailHash))
    const user = await upsertEmailUser(env, verdict.email)
    return issueSession(env, request, toSessionUser(user))
  }

  // —— 会话查询 ——
  if (path === '/api/auth/session' && method === 'GET') {
    const session = await readSession(env, request)
    if (!session) return ok({ user: null })
    const user = await loadUser(env, session.record.uid)
    if (!user) return ok({ user: null })
    await touchSession(env, session.tokenHash, session.record)
    return ok({ user: toSessionUser(user), expires_at: session.record.expires_at })
  }

  // —— 登出 ——
  if (path === '/api/auth/logout' && method === 'POST') {
    await destroySession(env, request)
    return ok({ signed_out: true }, { headers: { 'set-cookie': clearSessionCookie() } })
  }

  // —— OAuth 发起 ——
  const startMatch = path.match(/^\/api\/auth\/oauth\/([a-z]+)\/start$/)
  if (startMatch && (method === 'GET' || method === 'POST')) {
    const provider = parseProvider(startMatch[1])
    if (!isProviderConfigured(env, provider)) {
      throw new ApiError(
        503,
        'provider_unconfigured',
        `${PROVIDERS[provider].label} 登录尚未配置，请管理员设置 ${provider.toUpperCase()}_CLIENT_ID / ${provider.toUpperCase()}_CLIENT_SECRET`,
      )
    }
    const state = randomToken(24)
    const popup = url.searchParams.get('popup') === '1'
    const returnTo = safeReturnTo(url.searchParams.get('returnTo'))
    const codeVerifier = PROVIDERS[provider].supportsPkce ? randomToken(32) : undefined
    const codeChallenge = codeVerifier ? await pkceChallenge(codeVerifier) : undefined

    const record: OAuthStateRecord = {
      provider,
      code_verifier: codeVerifier,
      return_to: returnTo,
      popup,
      created_at: new Date().toISOString(),
    }
    await putJson(env.AUTH_KV, KEYS.oauthState(state), record, OAUTH_STATE_TTL_SECONDS)

    const authorizeUrl = buildAuthorizeUrl(env, request, provider, { state, codeChallenge })
    return Response.redirect(authorizeUrl, 302)
  }

  // —— OAuth 回调 ——
  const callbackMatch = path.match(/^\/api\/auth\/oauth\/([a-z]+)\/callback$/)
  if (callbackMatch && method === 'GET') {
    const provider = parseProvider(callbackMatch[1])
    const base = env.PUBLIC_BASE_URL?.replace(/\/$/, '') || url.origin
    const state = url.searchParams.get('state') || ''
    const code = url.searchParams.get('code') || ''
    const providerError = url.searchParams.get('error')

    const stateRecord = state ? await getJson<OAuthStateRecord>(env.AUTH_KV, KEYS.oauthState(state)) : null
    if (state) await removeKey(env.AUTH_KV, KEYS.oauthState(state))

    const popupSuffix = stateRecord?.popup ? '&popup=1' : ''
    const failureRedirect = (message: string) =>
      Response.redirect(`${base}/auth/callback?auth=error${popupSuffix}&message=${encodeURIComponent(message)}`, 302)

    if (providerError) return failureRedirect(`授权被拒绝：${providerError}`)
    if (!stateRecord) return failureRedirect('登录状态已过期或校验失败，请重新登录')
    if (stateRecord.provider !== provider) return failureRedirect('登录方式与请求不匹配，请重新登录')
    if (!code) return failureRedirect('未收到授权码，请重新登录')

    try {
      const accessToken = await exchangeCode(env, request, provider, code, stateRecord.code_verifier)
      const profile = await fetchProfile(provider, accessToken)

      // 与邮箱注册/登录同一套风控：第三方返回的邮箱同样要过临时邮箱拦截。
      const verdict = await checkEmail(profile.email, env.BLOCKLIST_KV)
      if (!verdict.ok) {
        return failureRedirect(`${PROVIDERS[provider].label} 账号邮箱被风控拦截：${verdict.reason}`)
      }
      if (!profile.emailVerified) {
        return failureRedirect(`${PROVIDERS[provider].label} 账号邮箱未验证，请先在 ${PROVIDERS[provider].label} 完成邮箱验证`)
      }

      const user = await upsertOAuthUser(env, profile)
      const { token, maxAge } = await createSession(env, toSessionUser(user), {
        ip: clientIp(request),
        userAgent: request.headers.get('user-agent') || '',
      })

      const target = `${base}/auth/callback?auth=success${popupSuffix}&returnTo=${encodeURIComponent(stateRecord.return_to)}`
      return new Response(null, {
        status: 302,
        headers: { location: target, 'set-cookie': sessionCookie(token, maxAge) },
      })
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '登录过程中出现异常，请稍后重试'
      return failureRedirect(message)
    }
  }

  return fail(404, 'not_found', `未知的认证接口：${method} ${path}`)
}
