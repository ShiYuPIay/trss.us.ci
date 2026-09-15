import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactElement } from 'react'
import { ArrowRight, CheckCircle2, CloudCog, KeyRound, Mail, RefreshCw, ShieldAlert, UserPlus } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { FadeIn } from '@/components/MotionPrimitives'
import { useAuth, type OtpTicket } from '@/lib/AuthContext'

type Mode = 'code' | 'password' | 'register'

const MODE_LABELS: Record<Mode, string> = {
  code: '邮箱验证码',
  password: '密码登录',
  register: '注册账号',
}

/** Google 官方 G 标（lucide 未内置），使用官方四色路径以保证品牌识别度。 */
function GoogleMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  )
}

function GitHubMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.7-2.8 5.7-5.5 6 .4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3z" />
    </svg>
  )
}

const EMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/

export default function Login() {
  const navigate = useNavigate()
  const {
    user,
    providers,
    providersLoaded,
    register,
    signInWithPassword,
    requestEmailCode,
    signInWithEmailCode,
    signInWithOAuth,
    checkEmail,
  } = useAuth()

  const [mode, setMode] = useState<Mode>('code')
  const [email, setEmail] = useState('')
  const [secret, setSecret] = useState('')
  const [name, setName] = useState('')
  const [ticket, setTicket] = useState<OtpTicket | null>(null)
  const [busy, setBusy] = useState(false)
  const [emailHint, setEmailHint] = useState<{ tone: 'error' | 'ok'; text: string } | null>(null)
  const checkSeq = useRef(0)

  // 已登录用户直接进入创作空间，避免重复登录。
  useEffect(() => {
    if (user) navigate('/studio', { replace: true })
  }, [navigate, user])

  /** 邮箱风控实时反馈：命中临时邮箱时立即提示，而不是等提交后才失败。 */
  const verifyEmail = useCallback(
    async (value: string) => {
      const target = value.trim().toLowerCase()
      if (!EMAIL_PATTERN.test(target)) {
        setEmailHint(target ? { tone: 'error', text: '邮箱格式不正确' } : null)
        return
      }
      const seq = ++checkSeq.current
      const result = await checkEmail(target)
      if (seq !== checkSeq.current) return
      setEmailHint(
        result.allowed
          ? { tone: 'ok', text: '邮箱可用' }
          : { tone: 'error', text: result.reason || '该邮箱不可用于注册或登录' },
      )
    },
    [checkEmail],
  )

  const switchMode = (next: Mode) => {
    setMode(next)
    setSecret('')
    setTicket(null)
    setEmailHint(null)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const target = email.trim().toLowerCase()
    if (!EMAIL_PATTERN.test(target)) return toast.error('请输入有效的邮箱地址')

    setBusy(true)
    try {
      if (mode === 'register') {
        if (!secret) throw new Error('请设置登录密码')
        await register(target, secret, name.trim() || undefined)
        toast.success('注册成功，已自动登录')
        navigate('/studio')
        return
      }

      if (mode === 'password') {
        if (!secret) throw new Error('请输入登录密码')
        await signInWithPassword(target, secret)
        toast.success('登录成功')
        navigate('/studio')
        return
      }

      if (!ticket) {
        const created = await requestEmailCode(target)
        setTicket(created)
        setSecret('')
        if (created.devCode) {
          setSecret(created.devCode)
          toast.success(`本地调试模式：验证码 ${created.devCode} 已自动填入`)
        } else {
          toast.success(`验证码已发送至 ${target}，${Math.round(created.expiresIn / 60)} 分钟内有效`)
        }
        return
      }

      await signInWithEmailCode(ticket, secret.trim())
      toast.success('登录成功')
      navigate('/studio')
    } catch (error) {
      const message = error instanceof Error ? error.message : '操作失败，请稍后重试'
      toast.error(message)
      if (/邮箱|域名|一次性/.test(message)) setEmailHint({ tone: 'error', text: message })
    } finally {
      setBusy(false)
    }
  }

  const oauthProviders = useMemo(() => {
    const list: { key: 'google' | 'github'; label: string; mark: ReactElement }[] = []
    if (providers?.oauth.google) list.push({ key: 'google', label: 'Google', mark: <GoogleMark /> })
    if (providers?.oauth.github) list.push({ key: 'github', label: 'GitHub', mark: <GitHubMark /> })
    return list
  }, [providers])

  const noEntryAvailable = providersLoaded && !providers?.mail_channel && oauthProviders.length === 0

  const submitLabel = busy
    ? '请稍候…'
    : mode === 'register'
      ? '注册并登录'
      : mode === 'code' && !ticket
        ? '发送验证码'
        : '进入创作空间'

  return (
    <main className="login-page">
      <div className="login-visual">
        <img src="https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1600&q=88" alt="暮色山林壁纸" />
        <div className="hero-overlay" />
        <div className="login-quote">
          <span>PRIVATE ENTRANCE</span>
          <blockquote>把灵感保存下来，<br />让它成为下一篇文章。</blockquote>
        </div>
      </div>

      <FadeIn className="login-panel">
        <div className="login-card">
          <span className="eyebrow dark">WELCOME BACK</span>
          <h1>登录创作空间</h1>
          <p>管理文章、上传图片与附件，让每次更新都安全保存。</p>

          {noEntryAvailable && (
            <div className="service-notice">
              <CloudCog size={20} />
              <div>
                <strong>登录通道尚未配置</strong>
                <span>管理员需配置 Google / GitHub OAuth 凭据或邮件通道后方可登录。</span>
              </div>
            </div>
          )}

          <div className="login-tabs" role="tablist">
            {(Object.keys(MODE_LABELS) as Mode[]).map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={mode === item}
                className={mode === item ? 'active' : ''}
                onClick={() => switchMode(item)}
              >
                {MODE_LABELS[item]}
              </button>
            ))}
          </div>

          <form onSubmit={submit} noValidate>
            <label>
              <span>邮箱地址</span>
              <div className={`input-wrap ${emailHint?.tone === 'error' ? 'has-error' : ''}`}>
                <Mail size={18} />
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value)
                    setEmailHint(null)
                    setTicket(null)
                  }}
                  onBlur={(event) => void verifyEmail(event.target.value)}
                  placeholder="name@example.com"
                  disabled={Boolean(ticket)}
                />
              </div>
              {emailHint && (
                <span className={`field-hint ${emailHint.tone}`}>
                  {emailHint.tone === 'ok' ? <CheckCircle2 size={13} /> : <ShieldAlert size={13} />}
                  {emailHint.text}
                </span>
              )}
            </label>

            {mode === 'register' && (
              <label>
                <span>昵称（可选）</span>
                <div className="input-wrap">
                  <UserPlus size={18} />
                  <input
                    type="text"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="展示在文章作者处"
                    maxLength={32}
                  />
                </div>
              </label>
            )}

            {(mode === 'password' || mode === 'register' || ticket) && (
              <label>
                <span>{mode === 'register' ? '设置密码' : mode === 'password' ? '登录密码' : '6 位验证码'}</span>
                <div className="input-wrap">
                  <KeyRound size={18} />
                  <input
                    type={mode === 'code' ? 'text' : 'password'}
                    required
                    inputMode={mode === 'code' ? 'numeric' : undefined}
                    autoComplete={mode === 'register' ? 'new-password' : mode === 'password' ? 'current-password' : 'one-time-code'}
                    value={secret}
                    onChange={(event) => setSecret(event.target.value)}
                    placeholder={
                      mode === 'register' ? '至少 8 位，需包含字母与数字' : mode === 'password' ? '输入登录密码' : '输入邮箱中的验证码'
                    }
                  />
                </div>
                {mode === 'register' && <span className="field-hint">密码至少 8 位，且同时包含字母和数字。</span>}
                {ticket && (
                  <span className="field-hint">
                    验证码已发送（{ticket.channel === 'dev-echo' ? '本地调试模式' : '邮件'}），
                    <button type="button" className="link-button" onClick={() => { setTicket(null); setSecret('') }}>
                      <RefreshCw size={12} />重新获取
                    </button>
                  </span>
                )}
              </label>
            )}

            <button type="submit" className="button button-primary button-wide" disabled={busy}>
              {submitLabel}
              <ArrowRight size={17} />
            </button>
          </form>

          {oauthProviders.length > 0 && (
            <>
              <div className="or-line"><span>或</span></div>
              <div className="oauth-row">
                {oauthProviders.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className="button button-outline oauth-button"
                    onClick={() => signInWithOAuth(item.key).catch((error: unknown) => toast.error(error instanceof Error ? error.message : '登录失败'))}
                  >
                    {item.mark}
                    使用 {item.label} 登录
                  </button>
                ))}
              </div>
            </>
          )}

          <p className="login-foot">为保障账号质量，系统会自动拦截一次性邮箱与可疑域名地址。</p>
        </div>
      </FadeIn>
    </main>
  )
}
