import { useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { LogIn, LogOut, Menu, PenLine, X } from 'lucide-react'
import { motion } from 'framer-motion'
import { useAuth } from '@/lib/AuthContext'
import { SiteLogo } from './SiteLogo'

const navItems = [
  { to: '/', label: '首页', end: true },
  { to: '/articles', label: '文章' },
  { to: '/tags', label: '标签' },
  { to: '/about', label: '关于' },
]

export function Header() {
  const [open, setOpen] = useState(false)
  const { user, signOut } = useAuth()

  return (
    <header className="header-wrap">
      <motion.div className="site-header glass" initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }}>
        <SiteLogo />
        <nav className={`main-nav ${open ? 'is-open' : ''}`} aria-label="主导航">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} onClick={() => setOpen(false)} className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="header-actions">
          {user ? (
            <>
              <Link to="/studio" className="button button-primary"><PenLine size={16} />写文章</Link>
              <button className="icon-button" onClick={() => signOut()} aria-label="退出登录"><LogOut size={18} /></button>
            </>
          ) : (
            <Link to="/login" className="button button-ghost"><LogIn size={17} />登录</Link>
          )}
          <button className="menu-button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label="打开导航菜单">
            {open ? <X size={21} /> : <Menu size={21} />}
          </button>
        </div>
      </motion.div>
    </header>
  )
}
