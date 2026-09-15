import { useEffect, useRef, useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { LogIn, LogOut, Menu, PenLine, Search, X } from 'lucide-react'
import { useAuth } from '@/lib/AuthContext'
import { SiteLogo } from './SiteLogo'

const navItems = [
  { to: '/', label: '首页', end: true },
  { to: '/articles', label: '文章' },
  { to: '/tags', label: '标签' },
  { to: '/about', label: '关于' },
]

/**
 * 站点页头。
 *
 * 交互取自子比主题：毛玻璃底色 + 下滑隐藏、上滑显示。
 * 阈值取 6px 是为了避开移动端滚动回弹造成的抖动；顶部 80px 内始终显示，
 * 否则「回到顶部」后页头会停在隐藏状态，用户需要反向滚动才能唤出。
 */
export function Header() {
  const [open, setOpen] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const lastScroll = useRef(0)
  const { user, signOut } = useAuth()

  useEffect(() => {
    let ticking = false

    const update = () => {
      const current = window.scrollY
      setScrolled(current > 8)
      if (current <= 80) {
        setHidden(false)
      } else if (Math.abs(current - lastScroll.current) > 6) {
        setHidden(current > lastScroll.current)
      }
      lastScroll.current = current
      ticking = false
    }

    const onScroll = () => {
      if (ticking) return
      ticking = true
      window.requestAnimationFrame(update)
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    update()
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // 移动端菜单展开时不能把页头一起收走，否则菜单会跟着消失。
  const isHidden = hidden && !open

  return (
    <header className={`header-wrap${isHidden ? ' is-hidden' : ''}${scrolled ? ' is-scrolled' : ''}`}>
      <div className="site-header glass">
        <SiteLogo />
        <nav className={`main-nav ${open ? 'is-open' : ''}`} aria-label="主导航">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} onClick={() => setOpen(false)} className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="header-actions">
          <Link to="/articles" className="icon-button" aria-label="搜索文章"><Search size={18} /></Link>
          {user ? (
            <>
              <Link to="/projects" className="button button-primary"><PenLine size={16} />我的项目</Link>
              <button className="icon-button" onClick={() => signOut()} aria-label="退出登录"><LogOut size={18} /></button>
            </>
          ) : (
            <Link to="/login" className="button button-ghost"><LogIn size={17} />登录</Link>
          )}
          <button className="menu-button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label="打开导航菜单">
            {open ? <X size={21} /> : <Menu size={21} />}
          </button>
        </div>
      </div>
    </header>
  )
}
