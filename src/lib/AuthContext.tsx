import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { auth, isCloudConfigured } from './cloudbase'

export type UserProfile = {
  uid: string
  email: string
  name: string
  avatar_url: string
  provider: string
} | null

export type VerificationInfo = {
  verifyOtp: (params: { token: string }) => Promise<{ error?: { message?: string } | null }>
}

type OAuthMessage = {
  type?: string
  access_token?: string
  refresh_token?: string
  user?: UserProfile
}

type AuthContextType = {
  user: UserProfile
  loading: boolean
  signInWithGoogle: () => Promise<void>
  sendEmailCode: (email: string) => Promise<VerificationInfo>
  verifyEmailCode: (code: string, verificationInfo: VerificationInfo) => Promise<void>
  signInWithEmailPassword: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  applySession: (accessToken: string, refreshToken: string, oauthUser: UserProfile) => Promise<void>
}

const unavailable = async (): Promise<never> => { throw new Error('云服务正在准备中，请稍后再试') }
const AuthContext = createContext<AuthContextType>({
  user: null, loading: false, signInWithGoogle: unavailable, sendEmailCode: unavailable,
  verifyEmailCode: unavailable, signInWithEmailPassword: unavailable, signOut: async () => {}, applySession: unavailable,
})

async function fetchUserProfile(): Promise<UserProfile> {
  if (!auth) return null
  try {
    const { data, error } = await auth.getUser()
    const raw = data?.user
    if (error || !raw || raw.is_anonymous || raw.app_metadata?.provider === 'anonymous' || !raw.email) return null
    return {
      uid: raw.id || '', email: raw.email || '',
      name: raw.user_metadata?.nickName || raw.user_metadata?.name || raw.email.split('@')[0] || '创作者',
      avatar_url: raw.user_metadata?.avatarUrl || '', provider: raw.app_metadata?.provider || 'email',
    }
  } catch { return null }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile>(null)
  const [loading, setLoading] = useState(isCloudConfigured)

  const refreshUser = useCallback(async () => setUser(await fetchUserProfile()), [])

  const applySession = useCallback(async (accessToken: string, refreshToken: string, _oauthUser: UserProfile) => {
    if (!auth) return unavailable()
    const { error } = await auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
    if (error) throw new Error(error.message || '登录会话建立失败')
    const verified = await fetchUserProfile()
    if (!verified) throw new Error('登录身份验证失败，请重新登录')
    setUser(verified)
  }, [])

  useEffect(() => {
    const initialSync = window.setTimeout(() => {
      void refreshUser().finally(() => setLoading(false))
    }, 0)
    if (!auth) return () => window.clearTimeout(initialSync)

    const subscription = auth.onAuthStateChange(() => { void refreshUser() }).data.subscription
    const sync = () => { void refreshUser() }
    const receiveOAuth = (event: MessageEvent<OAuthMessage>) => {
      if (event.origin !== window.location.origin || event.data?.type !== 'oauth_callback') return
      const { access_token, refresh_token, user: oauthUser } = event.data
      if (!access_token || !refresh_token) return
      void applySession(access_token, refresh_token, oauthUser ?? null)
    }
    window.addEventListener('focus', sync)
    window.addEventListener('storage', sync)
    window.addEventListener('message', receiveOAuth)
    return () => {
      window.clearTimeout(initialSync)
      subscription.unsubscribe()
      window.removeEventListener('focus', sync)
      window.removeEventListener('storage', sync)
      window.removeEventListener('message', receiveOAuth)
    }
  }, [applySession, refreshUser])

  const signInWithGoogle = async () => {
    if (!isCloudConfigured) return unavailable()
    const relay = import.meta.env.VITE_OAUTH_RELAY_URL
    if (!relay) throw new Error('Google 登录通道暂未配置')
    const inFrame = window.self !== window.top
    const callbackUrl = `${window.location.origin}/auth/callback${inFrame ? '?mode=popup' : ''}`
    const oauthUrl = `${relay}/authorize?provider=google&callback_url=${encodeURIComponent(callbackUrl)}`
    if (!inFrame) window.location.href = oauthUrl
    else window.open(oauthUrl, 'oauth_popup', 'width=520,height=620,left=200,top=100')
  }

  const sendEmailCode = async (email: string): Promise<VerificationInfo> => {
    if (!auth) return unavailable()
    const { data, error } = await auth.signInWithOtp({ email })
    if (error || !data) throw new Error(error?.message || '验证码发送失败')
    return data as VerificationInfo
  }

  const verifyEmailCode = async (code: string, verificationInfo: VerificationInfo) => {
    const { error } = await verificationInfo.verifyOtp({ token: code })
    if (error) throw new Error(error.message || '验证码校验失败')
    const verified = await fetchUserProfile()
    if (!verified) throw new Error('登录身份验证失败')
    setUser(verified)
  }

  const signInWithEmailPassword = async (email: string, password: string) => {
    if (!auth) return unavailable()
    const { error } = await auth.signInWithPassword({ email, password })
    if (error) throw new Error(error.message || '邮箱或密码错误')
    const verified = await fetchUserProfile()
    if (!verified) throw new Error('登录身份验证失败')
    setUser(verified)
  }

  const signOut = async () => {
    if (auth) {
      const result = await auth.signOut()
      if (result && 'error' in result && result.error) throw new Error('退出失败，请稍后再试')
    }
    setUser(null)
  }

  return <AuthContext.Provider value={{ user, loading, signInWithGoogle, sendEmailCode, verifyEmailCode, signInWithEmailPassword, signOut, applySession }}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
