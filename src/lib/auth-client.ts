/**
 * 认证 API 客户端。
 *
 * 与 Worker 侧 /api/auth/* 一一对应，统一处理：
 *   - 凭据携带（HttpOnly Cookie 为主，同时回传 token 供 Authorization 头兜底）
 *   - 错误归一化（把后端的 code/message 暴露给 UI，便于展示可读提示）
 */

export interface AuthUser {
  uid: string
  email: string
  name: string
  avatar_url: string
  provider: string
  email_verified: boolean
}

export interface AuthProviders {
  email: boolean
  mail_channel: boolean
  dev_echo: boolean
  oauth: { google: boolean; github: boolean }
}

export type OAuthProviderName = 'google' | 'github'

export class AuthApiError extends Error {
  code: string
  status: number

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

const BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') || '/api'

let memoryToken = ''

export function setAuthToken(token: string) {
  memoryToken = token
}

export function getAuthToken(): string {
  return memoryToken
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json')
  if (memoryToken) headers.set('authorization', `Bearer ${memoryToken}`)

  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, { ...init, headers, credentials: 'include' })
  } catch {
    throw new AuthApiError(0, 'network_error', '网络连接失败，请检查网络后重试')
  }

  const text = await response.text()
  let payload: { status?: string; data?: T; message?: string; code?: string } = {}
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = {}
    }
  }

  if (!response.ok || payload.status === 'error') {
    throw new AuthApiError(
      response.status,
      payload.code || 'request_failed',
      payload.message || `请求失败（HTTP ${response.status}）`,
    )
  }

  return (payload.data ?? ({} as T)) as T
}

export const authApi = {
  providers: () => request<AuthProviders>('/auth/providers'),

  checkEmail: (email: string) =>
    request<{ allowed: boolean; reason: string; code: string }>('/auth/email/check', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  register: (input: { email: string; password: string; name?: string }) =>
    request<{ user: AuthUser; token: string; expires_at: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  login: (input: { email: string; password: string }) =>
    request<{ user: AuthUser; token: string; expires_at: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  requestOtp: (email: string) =>
    request<{ sent: boolean; channel: string; expires_in: number; dev_code?: string }>('/auth/otp/request', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  verifyOtp: (email: string, code: string) =>
    request<{ user: AuthUser; token: string; expires_at: string }>('/auth/otp/verify', {
      method: 'POST',
      body: JSON.stringify({ email, code }),
    }),

  session: () => request<{ user: AuthUser | null; expires_at?: string }>('/auth/session'),

  logout: () => request<{ signed_out: boolean }>('/auth/logout', { method: 'POST' }),
}

/** 拼装 OAuth 授权入口地址，由浏览器整页跳转或弹出新窗口。 */
export function oauthStartUrl(provider: OAuthProviderName, options: { returnTo?: string; popup?: boolean } = {}): string {
  const params = new URLSearchParams()
  if (options.returnTo) params.set('returnTo', options.returnTo)
  if (options.popup) params.set('popup', '1')
  const query = params.toString()
  return `${BASE}/auth/oauth/${provider}/start${query ? `?${query}` : ''}`
}
