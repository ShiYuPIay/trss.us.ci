import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/lib/AuthContext'

/**
 * OAuth 回调落地页。
 *
 * Worker 在 /api/auth/oauth/:provider/callback 完成令牌交换、邮箱风控与会话签发后，
 * 会把浏览器重定向到这里，并带上 auth=success|error。
 * 会话以 HttpOnly Cookie 承载，因此本页只需刷新一次会话状态即可。
 */
export default function AuthCallback() {
  const navigate = useNavigate()
  const { refresh } = useAuth()
  const handled = useRef(false)
  const [message, setMessage] = useState('正在完成登录…')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (handled.current) return
    handled.current = true

    const params = new URLSearchParams(window.location.search)
    const status = params.get('auth') || 'success'
    const isPopup = params.get('popup') === '1'
    const returnTo = params.get('returnTo') || '/studio'
    const reason = params.get('message') || ''

    const finish = async () => {
      if (status !== 'success') {
        setFailed(true)
        setMessage(reason || '登录失败，请返回登录页重试')
        if (isPopup && window.opener) {
          window.opener.postMessage({ type: 'auth:oauth-complete', ok: false, message: reason }, window.location.origin)
          window.setTimeout(() => window.close(), 1600)
        }
        return
      }

      await refresh()

      if (isPopup) {
        window.opener?.postMessage({ type: 'auth:oauth-complete', ok: true }, window.location.origin)
        setMessage('登录成功，正在关闭窗口…')
        window.setTimeout(() => window.close(), 600)
        return
      }

      setMessage('登录成功，正在进入创作空间…')
      navigate(returnTo.startsWith('/') ? returnTo : '/studio', { replace: true })
    }

    void finish()
  }, [navigate, refresh])

  return (
    <main className="callback-page">
      {failed ? (
        <>
          <p className="callback-error" role="alert">{message}</p>
          <Link className="button button-outline" to="/login">返回登录页</Link>
        </>
      ) : (
        <>
          <div className="callback-spinner" aria-hidden="true" />
          {/* 加载期间必须把 message 渲染出来：它承载「正在完成登录 / 正在进入创作空间」的进度，
              并且是读屏软件唯一能拿到的状态来源（本页没有其他可访问内容）。 */}
          <p className="callback-status" role="status" aria-live="polite">{message}</p>
        </>
      )}
    </main>
  )
}
