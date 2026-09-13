import { Github, Mail, Rss } from 'lucide-react'
import { FadeIn } from '@/components/MotionPrimitives'
import { SiteLogo } from './SiteLogo'

export function Footer() {
  return (
    <footer className="site-footer">
      <FadeIn className="container footer-grid">
        <div>
          <SiteLogo />
          <p className="footer-note">收藏生活的微光，也认真写下走过的路。</p>
        </div>
        <div className="footer-links" aria-label="社交链接">
          <a href="mailto:hello@example.com" aria-label="发送邮件"><Mail size={18} /></a>
          <a href="https://github.com" target="_blank" rel="noreferrer" aria-label="Github"><Github size={18} /></a>
          <a href="/articles" aria-label="订阅文章"><Rss size={18} /></a>
        </div>
      </FadeIn>
      <div className="container footer-bottom">© {new Date().getFullYear()} huiyiziyuan · 保持好奇，持续记录</div>
    </footer>
  )
}
