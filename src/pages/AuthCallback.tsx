import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/lib/AuthContext'
import { cloudApp } from '@/lib/cloudbase'

export default function AuthCallback() {
  const navigate = useNavigate()
  const { applySession } = useAuth()
  const handled = useRef(false)
  const [message, setMessage] = useState('正在完成登录…')

  useEffect(() => {
    if (handled.current) return
    handled.current = true
    const run = async () => {
      const params = new URLSearchParams(window.location.search)
      const code = params.get('code')
      const provider = params.get('provider') || 'google'
      const popup = params.get('mode') === 'popup'
      if (!code || !cloudApp) { setMessage('登录信息无效'); return }
      try {
        const response = await cloudApp.callFunction({ name: 'oauth-callback', data: { code, provider } })
        const result = response.result
        if (result?.status !== 'success') throw new Error(result?.message || '登录失败')
        const { access_token, refresh_token, user } = result.data
        if (popup && window.opener) { window.opener.postMessage({ type: 'oauth_callback', access_token, refresh_token, user }, window.location.origin); window.close() }
        else { await applySession(access_token, refresh_token, user); navigate('/studio') }
      } catch (error) { setMessage(error instanceof Error ? error.message : '登录失败'); window.setTimeout(() => navigate('/login'), 1800) }
    }
    run()
  }, [applySession, navigate])

  return <main className="callback-page"><div className="callback-spinner" /><p>{message}</p></main>
}
