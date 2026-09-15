import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { handleRequest } from '../worker/index.ts'
import { MemoryKV } from './kv-mock.ts'
import type { AppEnv } from '../worker/types.ts'

const BASE = 'https://trss.us.ci'
const SESSION_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'

// ---------------------------------------------------------------------------
// 测试替身：把对第三方 OAuth 端点的请求路由到内存响应
// ---------------------------------------------------------------------------

type FetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response>
type FetchInput = Parameters<typeof fetch>[0]
type FetchInit = Parameters<typeof fetch>[1]

const realFetch = globalThis.fetch
const oauthRoutes = new Map<string, FetchHandler>()

globalThis.fetch = (async (input: FetchInput, init?: FetchInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
  const handler = oauthRoutes.get(url)
  if (handler) return handler(url, init)
  return realFetch(input, init)
}) as typeof fetch

after(() => {
  globalThis.fetch = realFetch
})

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
}

function setOAuthRoutes(routes: Record<string, FetchHandler>) {
  oauthRoutes.clear()
  for (const [key, value] of Object.entries(routes)) oauthRoutes.set(key, value)
}

function googleRoutes(email: string, emailVerified = true) {
  setOAuthRoutes({
    'https://oauth2.googleapis.com/token': () => jsonResponse({ access_token: 'google-access-token' }),
    'https://openidconnect.googleapis.com/v1/userinfo': () =>
      jsonResponse({ sub: 'google-sub-1', email, email_verified: emailVerified, name: 'Google User', picture: 'https://cdn.example.com/a.png' }),
  })
}

function githubRoutes(email: string, verified = true, exposeEmail = false) {
  setOAuthRoutes({
    'https://github.com/login/oauth/access_token': () => jsonResponse({ access_token: 'github-access-token' }),
    'https://api.github.com/user': () =>
      jsonResponse({ id: 4242, login: 'octocat', name: 'Octo Cat', avatar_url: 'https://cdn.example.com/g.png', email: exposeEmail ? email : null }),
    'https://api.github.com/user/emails': () => jsonResponse([{ email, primary: true, verified }]),
  })
}

// ---------------------------------------------------------------------------
// 测试辅助
// ---------------------------------------------------------------------------

function newEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    AUTH_KV: new MemoryKV(),
    SITE_KV: new MemoryKV(),
    BLOCKLIST_KV: new MemoryKV(),
    PUBLIC_BASE_URL: BASE,
    SESSION_SECRET,
    ENVIRONMENT: 'development',
    ALLOW_OTP_DEV_ECHO: 'true',
    GOOGLE_CLIENT_ID: 'google-client-id',
    GOOGLE_CLIENT_SECRET: 'google-client-secret',
    GITHUB_CLIENT_ID: 'github-client-id',
    GITHUB_CLIENT_SECRET: 'github-client-secret',
    ...overrides,
  }
}

async function call(env: AppEnv, path: string, init: RequestInit = {}): Promise<Response> {
  return handleRequest(new Request(`${BASE}${path}`, init), env)
}

async function postJson(env: AppEnv, path: string, body: unknown, extra: Record<string, string> = {}): Promise<Response> {
  return call(env, path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...extra },
    body: JSON.stringify(body),
  })
}

async function bodyOf<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

function cookieOf(response: Response): string {
  const header = response.headers.get('set-cookie') || ''
  return header.split(';')[0]
}

async function registerUser(env: AppEnv, email: string, password = 'Passw0rd123') {
  const response = await postJson(env, '/api/auth/register', { email, password })
  assert.equal(response.status, 200, `注册应成功，实际 ${response.status}`)
  return { cookie: cookieOf(response), payload: await bodyOf<{ data: { user: { uid: string; email: string }; token: string } }>(response) }
}

// ---------------------------------------------------------------------------
// 1. 绑定与能力探测
// ---------------------------------------------------------------------------

describe('KV 绑定与能力探测', () => {
  it('健康检查应回报三个 KV 绑定与密钥状态', async () => {
    const env = newEnv()
    const response = await call(env, '/api/health')
    assert.equal(response.status, 200)
    const payload = await bodyOf<{ data: { bindings: Record<string, boolean>; secrets: Record<string, boolean> } }>(response)
    assert.deepEqual(payload.data.bindings, { AUTH_KV: true, SITE_KV: true, BLOCKLIST_KV: true, ASSETS: false })
    assert.equal(payload.data.secrets.SESSION_SECRET, true)
    assert.equal(payload.data.secrets.GOOGLE, true)
    assert.equal(payload.data.secrets.GITHUB, true)
  })

  it('缺少 SESSION_SECRET 时注册应返回可读的配置错误', async () => {
    const env = newEnv({ SESSION_SECRET: undefined })
    const response = await postJson(env, '/api/auth/register', { email: 'user@gmail.com', password: 'Passw0rd123' })
    assert.equal(response.status, 500)
    const payload = await bodyOf<{ code: string; message: string }>(response)
    assert.equal(payload.code, 'server_misconfigured')
    assert.match(payload.message, /SESSION_SECRET/)
  })

  it('能力探测应反映 OAuth 与邮件通道配置', async () => {
    const env = newEnv()
    const payload = await bodyOf<{ data: { mail_channel: boolean; oauth: Record<string, boolean> } }>(await call(env, '/api/auth/providers'))
    assert.equal(payload.data.mail_channel, true)
    assert.deepEqual(payload.data.oauth, { google: true, github: true })

    const bare = newEnv({ GOOGLE_CLIENT_ID: undefined, GOOGLE_CLIENT_SECRET: undefined, GITHUB_CLIENT_ID: undefined, GITHUB_CLIENT_SECRET: undefined, RESEND_API_KEY: undefined, ALLOW_OTP_DEV_ECHO: 'false' })
    const barePayload = await bodyOf<{ data: { mail_channel: boolean; oauth: Record<string, boolean> } }>(await call(bare, '/api/auth/providers'))
    assert.equal(barePayload.data.mail_channel, false)
    assert.deepEqual(barePayload.data.oauth, { google: false, github: false })
  })
})

// ---------------------------------------------------------------------------
// 2. 临时邮箱与可疑域名拦截
// ---------------------------------------------------------------------------

describe('临时邮箱与可疑域名拦截', () => {
  const cases: [string, string][] = [
    ['user@mailinator.com', '内置清单'],
    ['user@10minutemail.com', '内置清单'],
    ['user@guerrillamail.com', '内置清单'],
    ['user@yopmail.com', '内置清单'],
    ['user@sharklasers.com', '别名域'],
    ['user@pickup-tempmail.io', '关键词启发式'],
    ['user@inbox.throwaway-mail.net', '关键词启发式'],
    ['user@random.tk', '高风险 TLD'],
    ['test@gmail.com', '测试用本地部分'],
    ['123456@gmail.com', '纯数字前缀'],
  ]

  for (const [email, label] of cases) {
    it(`应拦截 ${email}（${label}）`, async () => {
      const env = newEnv()
      const payload = await bodyOf<{ data: { allowed: boolean; reason: string } }>(
        await postJson(env, '/api/auth/email/check', { email }),
      )
      assert.equal(payload.data.allowed, false, `${email} 应被拦截`)
      assert.ok(payload.data.reason.length > 0)
    })
  }

  it('应放行正常邮箱', async () => {
    const env = newEnv()
    for (const email of ['user@gmail.com', 'creator@outlook.com', 'hi@company.com.cn', 'someone@proton.me']) {
      const payload = await bodyOf<{ data: { allowed: boolean } }>(await postJson(env, '/api/auth/email/check', { email }))
      assert.equal(payload.data.allowed, true, `${email} 应被放行`)
    }
  })

  it('注册接口对临时邮箱返回 403 且不入库', async () => {
    const env = newEnv()
    const response = await postJson(env, '/api/auth/register', { email: 'user@mailinator.com', password: 'Passw0rd123' })
    assert.equal(response.status, 403)
    const payload = await bodyOf<{ code: string; message: string }>(response)
    assert.equal(payload.code, 'email_disposable')
    assert.match(payload.message, /一次性邮箱/)
    const identityKeys = (env.AUTH_KV as MemoryKV).keys().filter((key) => /^(user|pass|email|ident):/.test(key))
    assert.deepEqual(identityKeys, [], '被拦截的注册不应写入任何账号或密码记录')
  })

  it('登录接口同样拦截临时邮箱', async () => {
    const env = newEnv()
    const response = await postJson(env, '/api/auth/login', { email: 'user@mailinator.com', password: 'Passw0rd123' })
    assert.equal(response.status, 403)
    assert.equal((await bodyOf<{ code: string }>(response)).code, 'email_disposable')
  })

  it('BLOCKLIST_KV 白名单可放行被内置清单命中的域名', async () => {
    const env = newEnv()
    await env.BLOCKLIST_KV.put('allow:mailinator.com', '1')
    const payload = await bodyOf<{ data: { allowed: boolean } }>(await postJson(env, '/api/auth/email/check', { email: 'user@mailinator.com' }))
    assert.equal(payload.data.allowed, true)
  })

  it('BLOCKLIST_KV 黑名单可拦截自定义域名（无需重新部署）', async () => {
    const env = newEnv()
    await env.BLOCKLIST_KV.put('block:spam-farm.example', '1')
    const payload = await bodyOf<{ data: { allowed: boolean; reason: string } }>(
      await postJson(env, '/api/auth/email/check', { email: 'user@spam-farm.example' }),
    )
    assert.equal(payload.data.allowed, false)
    assert.match(payload.data.reason, /拦截名单/)
  })

  it('邮箱格式非法时应给出明确提示', async () => {
    const env = newEnv()
    for (const email of ['', 'not-an-email', 'a@b', 'a@@b.com']) {
      const payload = await bodyOf<{ data: { allowed: boolean; reason: string } }>(await postJson(env, '/api/auth/email/check', { email }))
      assert.equal(payload.data.allowed, false)
    }
  })
})

// ---------------------------------------------------------------------------
// 3. 注册、密码登录与会话
// ---------------------------------------------------------------------------

describe('注册、密码登录与会话', () => {
  it('注册成功后应签发会话并可直接查询用户', async () => {
    const env = newEnv()
    const { cookie, payload } = await registerUser(env, 'Creator@Gmail.com')
    assert.equal(payload.data.user.email, 'creator@gmail.com', '邮箱应被归一化为小写')
    assert.ok(payload.data.token.length > 20)
    assert.match(cookie, /^trss_session=/)

    const session = await bodyOf<{ data: { user: { email: string } | null } }>(await call(env, '/api/auth/session', { headers: { cookie } }))
    assert.equal(session.data.user?.email, 'creator@gmail.com')
  })

  it('弱密码应被拒绝', async () => {
    const env = newEnv()
    for (const password of ['short1', 'alllettersonly', '12345678']) {
      const response = await postJson(env, '/api/auth/register', { email: `weak-${password.length}${password.charCodeAt(0)}@gmail.com`, password })
      assert.equal(response.status, 400, `密码 ${password} 应被拒绝`)
      assert.equal((await bodyOf<{ code: string }>(response)).code, 'weak_password')
    }
  })

  it('重复注册应返回 409', async () => {
    const env = newEnv()
    await registerUser(env, 'dup@gmail.com')
    const response = await postJson(env, '/api/auth/register', { email: 'dup@gmail.com', password: 'Passw0rd123' })
    assert.equal(response.status, 409)
    assert.equal((await bodyOf<{ code: string }>(response)).code, 'email_exists')
  })

  it('密码登录成功与失败路径', async () => {
    const env = newEnv()
    await registerUser(env, 'login@gmail.com', 'Passw0rd123')

    const bad = await postJson(env, '/api/auth/login', { email: 'login@gmail.com', password: 'WrongPass123' })
    assert.equal(bad.status, 401)
    assert.equal((await bodyOf<{ code: string }>(bad)).code, 'invalid_credentials')

    const good = await postJson(env, '/api/auth/login', { email: 'login@gmail.com', password: 'Passw0rd123' })
    assert.equal(good.status, 200)
    assert.match(cookieOf(good), /^trss_session=/)
  })

  it('未注册邮箱登录应返回统一的凭据错误（不泄露注册状态）', async () => {
    const env = newEnv()
    const response = await postJson(env, '/api/auth/login', { email: 'nobody@gmail.com', password: 'Passw0rd123' })
    assert.equal(response.status, 401)
    assert.equal((await bodyOf<{ message: string }>(response)).message, '邮箱或密码错误')
  })

  it('登出后会话应失效', async () => {
    const env = newEnv()
    const { cookie } = await registerUser(env, 'bye@gmail.com')
    const logout = await call(env, '/api/auth/logout', { method: 'POST', headers: { cookie } })
    assert.equal(logout.status, 200)
    assert.match(logout.headers.get('set-cookie') || '', /Max-Age=0/)

    const session = await bodyOf<{ data: { user: unknown } }>(await call(env, '/api/auth/session', { headers: { cookie } }))
    assert.equal(session.data.user, null)
  })

  it('伪造的会话令牌不应通过校验', async () => {
    const env = newEnv()
    const session = await bodyOf<{ data: { user: unknown } }>(
      await call(env, '/api/auth/session', { headers: { cookie: 'trss_session=forged-token-value' } }),
    )
    assert.equal(session.data.user, null)
  })
})

// ---------------------------------------------------------------------------
// 4. 邮箱验证码
// ---------------------------------------------------------------------------

describe('邮箱验证码登录', () => {
  it('验证码错误、正确与重放三条路径', async () => {
    const env = newEnv()
    const requested = await postJson(env, '/api/auth/otp/request', { email: 'otp@gmail.com' })
    assert.equal(requested.status, 200)
    const ticket = await bodyOf<{ data: { channel: string; dev_code?: string } }>(requested)
    assert.equal(ticket.data.channel, 'dev-echo')
    assert.match(ticket.data.dev_code || '', /^\d{6}$/)
    const code = ticket.data.dev_code as string

    const wrong = await postJson(env, '/api/auth/otp/verify', { email: 'otp@gmail.com', code: code === '000000' ? '111111' : '000000' })
    assert.equal(wrong.status, 400)
    assert.equal((await bodyOf<{ code: string }>(wrong)).code, 'otp_invalid')

    const success = await postJson(env, '/api/auth/otp/verify', { email: 'otp@gmail.com', code })
    assert.equal(success.status, 200)
    assert.match(cookieOf(success), /^trss_session=/)

    // 一次性使用：同一验证码不可重放
    const replay = await postJson(env, '/api/auth/otp/verify', { email: 'otp@gmail.com', code })
    assert.equal(replay.status, 400)
    assert.equal((await bodyOf<{ code: string }>(replay)).code, 'otp_expired')
  })

  it('验证码请求对临时邮箱返回 403', async () => {
    const env = newEnv()
    const response = await postJson(env, '/api/auth/otp/request', { email: 'user@mailinator.com' })
    assert.equal(response.status, 403)
  })

  it('验证码存储的是哈希而非明文', async () => {
    const env = newEnv()
    const requested = await postJson(env, '/api/auth/otp/request', { email: 'hash@gmail.com' })
    const code = (await bodyOf<{ data: { dev_code: string } }>(requested)).data.dev_code
    const stored = (env.AUTH_KV as MemoryKV).keys().filter((key) => key.startsWith('otp:'))
    assert.equal(stored.length, 1)
    const value = await env.AUTH_KV.get(stored[0])
    assert.ok(value && !value.includes(code), 'KV 中不应出现验证码明文')
  })

  it('未配置邮件通道时应返回可操作的提示', async () => {
    const env = newEnv({ ALLOW_OTP_DEV_ECHO: 'false' })
    const response = await postJson(env, '/api/auth/otp/request', { email: 'otp@gmail.com' })
    assert.equal(response.status, 503)
    assert.equal((await bodyOf<{ code: string }>(response)).code, 'mail_channel_unconfigured')
  })
})

// ---------------------------------------------------------------------------
// 5. Google / GitHub OAuth
// ---------------------------------------------------------------------------

describe('OAuth 授权码流程', () => {
  it('Google 入口应生成带 state 与 PKCE 的授权地址', async () => {
    const env = newEnv()
    const response = await call(env, '/api/auth/oauth/google/start?returnTo=/studio&popup=1')
    assert.equal(response.status, 302)
    const location = new URL(response.headers.get('location') as string)
    assert.equal(location.origin, 'https://accounts.google.com')
    assert.equal(location.searchParams.get('client_id'), 'google-client-id')
    assert.equal(location.searchParams.get('redirect_uri'), `${BASE}/api/auth/oauth/google/callback`)
    assert.equal(location.searchParams.get('code_challenge_method'), 'S256')
    assert.ok((location.searchParams.get('state') || '').length > 20)
    assert.ok((location.searchParams.get('code_challenge') || '').length > 20)
    assert.match(location.searchParams.get('scope') || '', /email/)
  })

  it('GitHub 入口应指向 GitHub 授权页', async () => {
    const env = newEnv()
    const response = await call(env, '/api/auth/oauth/github/start')
    assert.equal(response.status, 302)
    const location = new URL(response.headers.get('location') as string)
    assert.equal(location.origin, 'https://github.com')
    assert.equal(location.pathname, '/login/oauth/authorize')
    assert.match(location.searchParams.get('scope') || '', /user:email/)
  })

  it('未配置的提供商应返回 503 而不是静默失败', async () => {
    const env = newEnv({ GOOGLE_CLIENT_ID: undefined, GOOGLE_CLIENT_SECRET: undefined })
    const response = await call(env, '/api/auth/oauth/google/start')
    assert.equal(response.status, 503)
    assert.equal((await bodyOf<{ code: string }>(response)).code, 'provider_unconfigured')
  })

  it('Google 回调应完成令牌交换、签发会话并跳回站点', async () => {
    const env = newEnv()
    googleRoutes('member@gmail.com')

    const start = await call(env, '/api/auth/oauth/google/start?returnTo=/studio')
    const state = new URL(start.headers.get('location') as string).searchParams.get('state') as string

    const callback = await call(env, `/api/auth/oauth/google/callback?code=auth-code&state=${state}`)
    assert.equal(callback.status, 302)
    const target = new URL(callback.headers.get('location') as string)
    assert.equal(target.pathname, '/auth/callback')
    assert.equal(target.searchParams.get('auth'), 'success')
    assert.equal(target.searchParams.get('returnTo'), '/studio')

    const cookie = cookieOf(callback)
    const session = await bodyOf<{ data: { user: { email: string; provider: string; name: string } } }>(
      await call(env, '/api/auth/session', { headers: { cookie } }),
    )
    assert.equal(session.data.user.email, 'member@gmail.com')
    assert.equal(session.data.user.provider, 'google')
    assert.equal(session.data.user.name, 'Google User')
  })

  it('Google 回调的邮箱同样受临时邮箱风控约束', async () => {
    const env = newEnv()
    googleRoutes('member@mailinator.com')

    const start = await call(env, '/api/auth/oauth/google/start')
    const state = new URL(start.headers.get('location') as string).searchParams.get('state') as string
    const callback = await call(env, `/api/auth/oauth/google/callback?code=auth-code&state=${state}`)

    assert.equal(callback.status, 302)
    const target = new URL(callback.headers.get('location') as string)
    assert.equal(target.searchParams.get('auth'), 'error')
    assert.match(target.searchParams.get('message') || '', /一次性邮箱/)
    assert.equal(callback.headers.get('set-cookie'), null, '被拦截的登录不应签发会话')
  })

  it('Google 未验证邮箱应被拒绝', async () => {
    const env = newEnv()
    googleRoutes('member@gmail.com', false)
    const start = await call(env, '/api/auth/oauth/google/start')
    const state = new URL(start.headers.get('location') as string).searchParams.get('state') as string
    const target = new URL((await call(env, `/api/auth/oauth/google/callback?code=c&state=${state}`)).headers.get('location') as string)
    assert.equal(target.searchParams.get('auth'), 'error')
    assert.match(target.searchParams.get('message') || '', /未验证/)
  })

  it('GitHub 回调应读取 primary + verified 邮箱并完成登录', async () => {
    const env = newEnv()
    githubRoutes('octo@outlook.com')
    const start = await call(env, '/api/auth/oauth/github/start')
    const state = new URL(start.headers.get('location') as string).searchParams.get('state') as string

    const callback = await call(env, `/api/auth/oauth/github/callback?code=gh-code&state=${state}`)
    assert.equal(callback.status, 302)
    assert.equal(new URL(callback.headers.get('location') as string).searchParams.get('auth'), 'success')

    const session = await bodyOf<{ data: { user: { email: string; provider: string; avatar_url: string } } }>(
      await call(env, '/api/auth/session', { headers: { cookie: cookieOf(callback) } }),
    )
    assert.equal(session.data.user.email, 'octo@outlook.com')
    assert.equal(session.data.user.provider, 'github')
    assert.equal(session.data.user.avatar_url, 'https://cdn.example.com/g.png')
  })

  it('GitHub 邮箱未验证时应给出可操作提示', async () => {
    const env = newEnv()
    githubRoutes('octo@outlook.com', false)
    const start = await call(env, '/api/auth/oauth/github/start')
    const state = new URL(start.headers.get('location') as string).searchParams.get('state') as string
    const target = new URL((await call(env, `/api/auth/oauth/github/callback?code=c&state=${state}`)).headers.get('location') as string)
    assert.equal(target.searchParams.get('auth'), 'error')
    assert.match(target.searchParams.get('message') || '', /未验证/)
  })

  it('GitHub 完全未提供邮箱时应提示先公开邮箱', async () => {
    const env = newEnv()
    setOAuthRoutes({
      'https://github.com/login/oauth/access_token': () => jsonResponse({ access_token: 'github-access-token' }),
      'https://api.github.com/user': () => jsonResponse({ id: 9, login: 'ghost', name: 'Ghost', avatar_url: '', email: null }),
      'https://api.github.com/user/emails': () => jsonResponse([]),
    })
    const start = await call(env, '/api/auth/oauth/github/start')
    const state = new URL(start.headers.get('location') as string).searchParams.get('state') as string
    const target = new URL((await call(env, `/api/auth/oauth/github/callback?code=c&state=${state}`)).headers.get('location') as string)
    assert.equal(target.searchParams.get('auth'), 'error')
    assert.match(target.searchParams.get('message') || '', /Primary/)
  })

  it('OAuth state 不可重放（CSRF 防护）', async () => {
    const env = newEnv()
    googleRoutes('member@gmail.com')
    const start = await call(env, '/api/auth/oauth/google/start')
    const state = new URL(start.headers.get('location') as string).searchParams.get('state') as string

    assert.equal((await call(env, `/api/auth/oauth/google/callback?code=c&state=${state}`)).status, 302)
    const replay = await call(env, `/api/auth/oauth/google/callback?code=c&state=${state}`)
    const target = new URL(replay.headers.get('location') as string)
    assert.equal(target.searchParams.get('auth'), 'error')
    assert.match(target.searchParams.get('message') || '', /过期|校验失败/)
  })

  it('伪造 state 应被拒绝', async () => {
    const env = newEnv()
    const target = new URL((await call(env, '/api/auth/oauth/google/callback?code=c&state=forged')).headers.get('location') as string)
    assert.equal(target.searchParams.get('auth'), 'error')
  })

  it('同一邮箱先注册后 OAuth 登录应归并为同一账号', async () => {
    const env = newEnv()
    const { payload } = await registerUser(env, 'merge@gmail.com', 'Passw0rd123')
    const uidBefore = payload.data.user.uid

    googleRoutes('merge@gmail.com')
    const start = await call(env, '/api/auth/oauth/google/start')
    const state = new URL(start.headers.get('location') as string).searchParams.get('state') as string
    const callback = await call(env, `/api/auth/oauth/google/callback?code=c&state=${state}`)

    const session = await bodyOf<{ data: { user: { uid: string } } }>(
      await call(env, '/api/auth/session', { headers: { cookie: cookieOf(callback) } }),
    )
    assert.equal(session.data.user.uid, uidBefore, '邮箱一致时应复用既有账号')
  })
})

// ---------------------------------------------------------------------------
// 6. 文章接口（SITE_KV 数据层）
// ---------------------------------------------------------------------------

describe('文章接口与 SITE_KV 数据层', () => {
  it('首次读取应播种示例文章并写入索引', async () => {
    const env = newEnv()
    const payload = await bodyOf<{ data: { articles: { slug: string }[]; total: number } }>(await call(env, '/api/articles'))
    assert.equal(payload.data.total, 6)
    assert.equal(payload.data.articles.length, 6)
    const keys = (env.SITE_KV as MemoryKV).keys()
    assert.ok(keys.includes('articles:index'))
    assert.ok(keys.includes('seed:articles'))
  })

  it('未登录时不可写入文章', async () => {
    const env = newEnv()
    const response = await postJson(env, '/api/articles', { title: '未授权文章', content: 'x' })
    assert.equal(response.status, 401)
  })

  it('登录后可创建文章，且列表与详情均可读取', async () => {
    const env = newEnv()
    const { cookie } = await registerUser(env, 'author@gmail.com')

    const created = await call(env, '/api/articles', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ slug: 'kv-bound-article', title: 'KV 绑定实践', content: '# 正文', tags: ['工程'], status: 'published' }),
    })
    assert.equal(created.status, 201)

    const detail = await bodyOf<{ data: { article: { slug: string; user_id: string } } }>(await call(env, '/api/articles/kv-bound-article'))
    assert.equal(detail.data.article.slug, 'kv-bound-article')
    assert.ok(detail.data.article.user_id.startsWith('u_'))

    const list = await bodyOf<{ data: { articles: { slug: string }[]; total: number } }>(await call(env, '/api/articles'))
    assert.equal(list.data.total, 7)
    assert.ok(list.data.articles.some((article) => article.slug === 'kv-bound-article'))
  })

  it('他人不可删除自己创建的文章', async () => {
    const env = newEnv()
    const { cookie: ownerCookie } = await registerUser(env, 'owner@gmail.com')
    await call(env, '/api/articles', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: ownerCookie },
      body: JSON.stringify({ slug: 'owned', title: '归属文章', content: 'x' }),
    })

    const { cookie: otherCookie } = await registerUser(env, 'other@gmail.com')
    const denied = await call(env, '/api/articles/owned', { method: 'DELETE', headers: { cookie: otherCookie } })
    assert.equal(denied.status, 403)

    const allowed = await call(env, '/api/articles/owned', { method: 'DELETE', headers: { cookie: ownerCookie } })
    assert.equal(allowed.status, 200)
  })
})

// ---------------------------------------------------------------------------
// 7. 限流与静态资源兜底
// ---------------------------------------------------------------------------

describe('限流与静态资源兜底', () => {
  it('同一邮箱连续失败登录应触发 429', async () => {
    const env = newEnv()
    await registerUser(env, 'bruteforce@gmail.com', 'Passw0rd123')
    const statuses: number[] = []
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await postJson(env, '/api/auth/login', { email: 'bruteforce@gmail.com', password: 'WrongPass123' })
      statuses.push(response.status)
    }
    assert.ok(statuses.includes(429), `应出现限流响应，实际状态序列 ${statuses.join(',')}`)
    assert.equal(statuses.at(-1), 429)
  })

  it('非 API 请求应交给静态资源绑定处理', async () => {
    const env = newEnv({
      ASSETS: { fetch: async () => new Response('<html>spa</html>', { headers: { 'content-type': 'text/html' } }) },
    })
    const response = await call(env, '/articles')
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('x-frame-options'), 'SAMEORIGIN')
    assert.match(await response.text(), /spa/)
  })

  it('未绑定静态资源时返回可读错误而非 500', async () => {
    const env = newEnv()
    const response = await call(env, '/')
    assert.equal(response.status, 503)
    assert.equal((await bodyOf<{ code: string }>(response)).code, 'assets_unbound')
  })

  it('未知 API 路径应返回 JSON 404', async () => {
    const env = newEnv()
    const response = await call(env, '/api/unknown')
    assert.equal(response.status, 404)
    assert.equal((await bodyOf<{ code: string }>(response)).code, 'not_found')
  })
})
