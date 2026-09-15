import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  AuthApiError,
  authApi,
  oauthStartUrl,
  setAuthToken,
  type AuthProviders,
  type AuthUser,
  type OAuthProviderName,
} from './auth-client'

export type UserProfile = AuthUser | null

export interface OtpTicket {
  email: string
  channel: string
  expiresIn: number
  /** 仅本地开发（ALLOW_OTP_DEV_ECHO）会返回，便于在无邮件通道时自测。 */
  devCode?: string
}

type AuthContextType = {
  user: UserProfile
  loading: boolean
  providers: AuthProviders | null
  providersLoaded: boolean
  register: (email: string, password: string, name?: string) => Promise<void>
  signInWithPassword: (email: string, password: string) => Promise<void>
  requestEmailCode: (email: string) => Promise<OtpTicket>
  signInWithEmailCode: (ticket: OtpTicket, code: string) => Promise<void>
  signInWithOAuth: (provider: OAuthProviderName, options?: { returnTo?: string }) => Promise<void>
  checkEmail: (email: string) => Promise<{ allowed: boolean; reason: string }>
  signOut: () => Promise<void>
  refresh: () => Promise<void>
}

const NOT_READY = '登录服务尚未就绪，请稍后再试'

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  providers: null,
  providersLoaded: false,
  register: async () => { throw new Error(NOT_READY) },
  signInWithPassword: async () => { throw new Error(NOT_READY) },
  requestEmailCode: async () => { throw new Error(NOT_READY) },
  signInWithEmailCode: async () => { throw new Error(NOT_READY) },
  signInWithOAuth: async () => { throw new Error(NOT_READY) },
  checkEmail: async () => ({ allowed: true, reason: '' }),
  signOut: async () => {},
  refresh: async () => {},
})

/** 跨标签页同步登录态：任一标签登出/登录后，其它标签立即跟随。 */
const BROADCAST_KEY = 'trss:auth:changed'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile>(null)
  const [loading, setLoading] = useState(true)
  const [providers, setProviders] = useState<AuthProviders | null>(null)
  const [providersLoaded, setProvidersLoaded] = useState(false)
  const mounted = useRef(true)

  const refresh = useCallback(async () => {
    try {
      const { user: current } = await authApi.session()
      if (mounted.current) setUser(current)
    } catch (error) {
      // 会话接口异常时保持未登录态，避免把用户永久卡在 loading。
      if (mounted.current && !(error instanceof AuthApiError)) setUser(null)
    }
  }, [])

  const broadcast = useCallback(() => {
    try {
      localStorage.setItem(BROADCAST_KEY, String(Date.now()))
    } catch {
      // 隐私模式下 localStorage 可能不可用，忽略即可。
    }
  }, [])

  useEffect(() => {
    mounted.current = true

    const bootstrap = async () => {
      try {
        const info = await authApi.providers()
        if (mounted.current) setProviders(info)
      } catch {
        if (mounted.current) setProviders(null)
      } finally {
        if (mounted.current) setProvidersLoaded(true)
      }
      await refresh()
      if (mounted.current) setLoading(false)
    }
    void bootstrap()

    const onStorage = (event: StorageEvent) => {
      if (event.key === BROADCAST_KEY) void refresh()
    }
    const onFocus = () => { void refresh() }
    // OAuth 弹窗完成后通知父窗口刷新会话。
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if (event.data?.type === 'auth:oauth-complete') void refresh()
    }

    window.addEventListener('storage', onStorage)
    window.addEventListener('focus', onFocus)
    window.addEventListener('message', onMessage)
    return () => {
      mounted.current = false
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('message', onMessage)
    }
  }, [refresh])

  const applyResult = useCallback(async (result: { user: AuthUser; token: string }) => {
    setAuthToken(result.token)
    setUser(result.user)
    broadcast()
  }, [broadcast])

  const register = useCallback(async (email: string, password: string, name?: string) => {
    const result = await authApi.register({ email, password, name })
    await applyResult(result)
  }, [applyResult])

  const signInWithPassword = useCallback(async (email: string, password: string) => {
    const result = await authApi.login({ email, password })
    await applyResult(result)
  }, [applyResult])

  const requestEmailCode = useCallback(async (email: string): Promise<OtpTicket> => {
    const result = await authApi.requestOtp(email)
    return { email, channel: result.channel, expiresIn: result.expires_in, devCode: result.dev_code }
  }, [])

  const signInWithEmailCode = useCallback(async (ticket: OtpTicket, code: string) => {
    const result = await authApi.verifyOtp(ticket.email, code)
    await applyResult(result)
  }, [applyResult])

  const signInWithOAuth = useCallback(async (provider: OAuthProviderName, options: { returnTo?: string } = {}) => {
    const target = options.returnTo || '/studio'
    const popup = window.open(oauthStartUrl(provider, { returnTo: target, popup: true }), 'trss_oauth', 'width=560,height=680,left=180,top=90')
    if (!popup) {
      // 弹窗被拦截时退回整页跳转，保证登录路径始终可用。
      window.location.href = oauthStartUrl(provider, { returnTo: target })
    }
  }, [])

  const checkEmail = useCallback(async (email: string) => {
    try {
      const result = await authApi.checkEmail(email)
      return { allowed: result.allowed, reason: result.reason }
    } catch {
      // 校验接口异常时不阻断用户，交由提交阶段做最终判定。
      return { allowed: true, reason: '' }
    }
  }, [])

  const signOut = useCallback(async () => {
    try {
      await authApi.logout()
    } finally {
      setAuthToken('')
      setUser(null)
      broadcast()
    }
  }, [broadcast])

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        providers,
        providersLoaded,
        register,
        signInWithPassword,
        requestEmailCode,
        signInWithEmailCode,
        signInWithOAuth,
        checkEmail,
        signOut,
        refresh,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
