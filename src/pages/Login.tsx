import { useState, type FormEvent } from 'react'
import { ArrowRight, CloudCog, KeyRound, Mail } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { FadeIn } from '@/components/MotionPrimitives'
import { useAuth, type VerificationInfo } from '@/lib/AuthContext'
import { isCloudConfigured } from '@/lib/cloudbase'

export default function Login() {
  const navigate = useNavigate()
  const { sendEmailCode, verifyEmailCode, signInWithEmailPassword, signInWithGoogle } = useAuth()
  const [mode, setMode] = useState<'code' | 'password'>('code')
  const [email, setEmail] = useState('')
  const [secret, setSecret] = useState('')
  const [verification, setVerification] = useState<VerificationInfo | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!isCloudConfigured) return toast.info('云服务正在准备中，请稍后再试')
    setBusy(true)
    try {
      if (mode === 'password') await signInWithEmailPassword(email, secret)
      else if (!verification) { setVerification(await sendEmailCode(email)); toast.success('验证码已发送，请查看邮箱'); setSecret(''); return }
      else await verifyEmailCode(secret, verification)
      toast.success('登录成功')
      navigate('/studio')
    } catch (error) { toast.error(error instanceof Error ? error.message : '登录失败') }
    finally { setBusy(false) }
  }

  return (
    <main className="login-page">
      <div className="login-visual"><img src="https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1600&q=88" alt="暮色山林壁纸" /><div className="hero-overlay" /><div className="login-quote"><span>PRIVATE ENTRANCE</span><blockquote>把灵感保存下来，<br />让它成为下一篇文章。</blockquote></div></div>
      <FadeIn className="login-panel">
        <div className="login-card">
          <span className="eyebrow dark">WELCOME BACK</span><h1>登录创作空间</h1><p>管理文章、上传图片与附件，让每次更新都安全保存。</p>
          {!isCloudConfigured && <div className="service-notice"><CloudCog size={20} /><div><strong>云服务正在准备</strong><span>界面已完成，云端环境就绪后即可使用登录与同步。</span></div></div>}
          <div className="login-tabs"><button className={mode === 'code' ? 'active' : ''} onClick={() => { setMode('code'); setVerification(null); setSecret('') }}>邮箱验证码</button><button className={mode === 'password' ? 'active' : ''} onClick={() => { setMode('password'); setVerification(null); setSecret('') }}>邮箱密码</button></div>
          <form onSubmit={submit}>
            <label><span>邮箱地址</span><div className="input-wrap"><Mail size={18} /><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" /></div></label>
            {(mode === 'password' || verification) && <label><span>{mode === 'password' ? '登录密码' : '6 位验证码'}</span><div className="input-wrap"><KeyRound size={18} /><input type={mode === 'password' ? 'password' : 'text'} required value={secret} onChange={(event) => setSecret(event.target.value)} placeholder={mode === 'password' ? '输入登录密码' : '输入邮箱中的验证码'} /></div></label>}
            <button type="submit" className="button button-primary button-wide" disabled={busy}>{busy ? '请稍候…' : mode === 'code' && !verification ? '发送验证码' : '进入创作空间'}<ArrowRight size={17} /></button>
          </form>
          <div className="or-line"><span>或</span></div>
          <button className="button button-outline button-wide" onClick={() => signInWithGoogle().catch((error) => toast.error(error.message))}>使用 Google 登录</button>
        </div>
      </FadeIn>
    </main>
  )
}
