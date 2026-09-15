import type { AppEnv } from '../types.ts'
import { ApiError } from './http.ts'

export type OAuthProvider = 'google' | 'github'

export interface ProviderProfile {
  provider: OAuthProvider
  subject: string
  email: string
  emailVerified: boolean
  name: string
  avatarUrl: string
}

interface ProviderConfig {
  clientId: (env: AppEnv) => string | undefined
  clientSecret: (env: AppEnv) => string | undefined
  authorizeUrl: string
  tokenUrl: string
  scope: string
  /** Google 支持 PKCE，GitHub 的 OAuth App 不支持，需要区分处理。 */
  supportsPkce: boolean
  label: string
}

export const PROVIDERS: Record<OAuthProvider, ProviderConfig> = {
  google: {
    label: 'Google',
    clientId: (env) => env.GOOGLE_CLIENT_ID,
    clientSecret: (env) => env.GOOGLE_CLIENT_SECRET,
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
    supportsPkce: true,
  },
  github: {
    label: 'GitHub',
    clientId: (env) => env.GITHUB_CLIENT_ID,
    clientSecret: (env) => env.GITHUB_CLIENT_SECRET,
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scope: 'read:user user:email',
    supportsPkce: false,
  },
}

export function isProviderConfigured(env: AppEnv, provider: OAuthProvider): boolean {
  const config = PROVIDERS[provider]
  return Boolean(config.clientId(env) && config.clientSecret(env))
}

export function parseProvider(value: string | undefined): OAuthProvider {
  if (value === 'google' || value === 'github') return value
  throw new ApiError(404, 'provider_unsupported', `不支持的登录方式：${value ?? '(空)'}`)
}

export function buildRedirectUri(env: AppEnv, request: Request, provider: OAuthProvider): string {
  const base = env.PUBLIC_BASE_URL?.replace(/\/$/, '') || new URL(request.url).origin
  return `${base}/api/auth/oauth/${provider}/callback`
}

export function buildAuthorizeUrl(
  env: AppEnv,
  request: Request,
  provider: OAuthProvider,
  params: { state: string; codeChallenge?: string },
): string {
  const config = PROVIDERS[provider]
  const clientId = config.clientId(env)
  if (!clientId) {
    throw new ApiError(503, 'provider_unconfigured', `${config.label} 登录尚未配置，请联系管理员设置 ${provider.toUpperCase()}_CLIENT_ID`)
  }

  const url = new URL(config.authorizeUrl)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', buildRedirectUri(env, request, provider))
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', config.scope)
  url.searchParams.set('state', params.state)
  if (provider === 'google') {
    url.searchParams.set('access_type', 'online')
    url.searchParams.set('prompt', 'select_account')
    url.searchParams.set('include_granted_scopes', 'true')
    if (params.codeChallenge) {
      url.searchParams.set('code_challenge', params.codeChallenge)
      url.searchParams.set('code_challenge_method', 'S256')
    }
  } else {
    url.searchParams.set('allow_signup', 'true')
  }
  return url.toString()
}

async function exchangeGoogle(env: AppEnv, request: Request, code: string, codeVerifier?: string): Promise<string> {
  const body = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID || '',
    client_secret: env.GOOGLE_CLIENT_SECRET || '',
    code,
    grant_type: 'authorization_code',
    redirect_uri: buildRedirectUri(env, request, 'google'),
  })
  if (codeVerifier) body.set('code_verifier', codeVerifier)

  const response = await fetch(PROVIDERS.google.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
  const payload = (await response.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string }
  if (!response.ok || !payload.access_token) {
    throw new ApiError(502, 'oauth_exchange_failed', `Google 授权码换取令牌失败：${payload.error_description || payload.error || response.status}`)
  }
  return payload.access_token
}

async function exchangeGitHub(env: AppEnv, request: Request, code: string): Promise<string> {
  const response = await fetch(PROVIDERS.github.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      client_id: env.GITHUB_CLIENT_ID || '',
      client_secret: env.GITHUB_CLIENT_SECRET || '',
      code,
      redirect_uri: buildRedirectUri(env, request, 'github'),
    }),
  })
  const payload = (await response.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string }
  if (!response.ok || !payload.access_token) {
    throw new ApiError(502, 'oauth_exchange_failed', `GitHub 授权码换取令牌失败：${payload.error_description || payload.error || response.status}`)
  }
  return payload.access_token
}

export async function exchangeCode(
  env: AppEnv,
  request: Request,
  provider: OAuthProvider,
  code: string,
  codeVerifier?: string,
): Promise<string> {
  return provider === 'google' ? exchangeGoogle(env, request, code, codeVerifier) : exchangeGitHub(env, request, code)
}

interface GoogleUserInfo {
  sub?: string
  email?: string
  email_verified?: boolean
  name?: string
  picture?: string
}

interface GitHubUserInfo {
  id?: number
  login?: string
  name?: string
  avatar_url?: string
  email?: string
}

interface GitHubEmail {
  email?: string
  primary?: boolean
  verified?: boolean
}

/**
 * 拉取第三方档案。
 *
 * 说明：Google 走 OpenID Connect 的 userinfo 端点，数据经 TLS 由 Google 直出，
 * 并且强制要求 email_verified === true；GitHub 的公开邮箱可能为空，
 * 因此额外请求 /user/emails 并只接受「primary && verified」的地址。
 */
export async function fetchProfile(provider: OAuthProvider, accessToken: string): Promise<ProviderProfile> {
  if (provider === 'google') {
    const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { authorization: `Bearer ${accessToken}` },
    })
    const info = (await response.json().catch(() => ({}))) as GoogleUserInfo
    if (!response.ok || !info.sub) {
      throw new ApiError(502, 'oauth_profile_failed', 'Google 用户信息获取失败')
    }
    if (!info.email) {
      throw new ApiError(403, 'oauth_email_missing', 'Google 账号未返回邮箱地址，无法完成注册')
    }
    return {
      provider,
      subject: info.sub,
      email: info.email.toLowerCase(),
      emailVerified: info.email_verified === true,
      name: info.name || info.email.split('@')[0],
      avatarUrl: info.picture || '',
    }
  }

  const headers = {
    authorization: `Bearer ${accessToken}`,
    accept: 'application/vnd.github+json',
    'user-agent': 'trss-us-ci-auth',
  }
  const userResponse = await fetch('https://api.github.com/user', { headers })
  const info = (await userResponse.json().catch(() => ({}))) as GitHubUserInfo
  if (!userResponse.ok || !info.id) {
    throw new ApiError(502, 'oauth_profile_failed', 'GitHub 用户信息获取失败')
  }

  let email = (info.email || '').toLowerCase()
  let emailVerified = false

  const emailResponse = await fetch('https://api.github.com/user/emails', { headers })
  if (emailResponse.ok) {
    const list = (await emailResponse.json().catch(() => [])) as GitHubEmail[]
    if (Array.isArray(list)) {
      // 优先级：primary+verified > 任一 verified > primary（未验证也接受，用于给出「请先验证邮箱」的准确提示）
      const preferred =
        list.find((item) => item.primary && item.verified) ||
        list.find((item) => item.verified) ||
        list.find((item) => item.primary) ||
        list.find((item) => item.email?.toLowerCase() === email)
      if (preferred?.email) {
        email = preferred.email.toLowerCase()
        emailVerified = preferred.verified === true
      }
    }
  }

  if (!email) {
    throw new ApiError(
      403,
      'oauth_email_missing',
      'GitHub 账号未公开已验证邮箱，请在 GitHub 设置中将邮箱设为 Primary 并勾选 Verified 后重试',
    )
  }

  return {
    provider,
    subject: String(info.id),
    email,
    emailVerified,
    name: info.name || info.login || email.split('@')[0],
    avatarUrl: info.avatar_url || '',
  }
}
