import { Link } from 'react-router-dom'

export function SiteLogo() {
  return (
    <Link to="/" className="site-logo" aria-label="huiyiziyuan 首页">
      <span className="logo-mark" aria-hidden="true">
        <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M8 7.5C11.4 7.5 14 8.6 16 10.4C18 8.6 20.6 7.5 24 7.5V23C20.6 23 18 24.1 16 25.9C14 24.1 11.4 23 8 23V7.5Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
          <path d="M16 10.5V25" stroke="currentColor" strokeWidth="2"/>
          <path d="M11 5.5C13 5.7 14.6 6.3 16 7.4C17.4 6.3 19 5.7 21 5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      </span>
      <span className="logo-copy"><strong>huiyiziyuan</strong><small>记录 · 分享 · 生长</small></span>
    </Link>
  )
}
