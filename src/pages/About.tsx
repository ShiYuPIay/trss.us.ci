import { Camera, Compass, Feather, Mail } from 'lucide-react'
import { FadeIn, HoverLift, Stagger } from '@/components/MotionPrimitives'

const interests = [
  { icon: Feather, title: '文字', text: '用写作整理经验，也给稍纵即逝的念头一个长期住处。' },
  { icon: Camera, title: '影像', text: '偏爱自然光、街道和没有被刻意安排的真实瞬间。' },
  { icon: Compass, title: '远行', text: '用步行认识城市，以缓慢的方式感受不同地方的日常。' },
]

export default function About() {
  return (
    <main className="page-main about-page">
      <section className="container about-hero">
        <FadeIn className="about-portrait"><div className="portrait-frame"><img src="https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=900&q=86" alt="huiyiziyuan 作者肖像" /></div><span>BASED IN CHINA · WRITING EVERYWHERE</span></FadeIn>
        <FadeIn className="about-intro" delay={0.12}><span className="eyebrow dark">ABOUT ME</span><h1>你好，我是<br />huiyiziyuan</h1><p className="about-lead">一个喜欢把复杂事物讲清楚，也愿意为微小感受停留的人。</p><p>这个网站是我的数字花园。我在这里记录读过的书、走过的路、做设计时的思考，以及那些暂时没有答案的问题。</p><a href="mailto:hello@example.com" className="button button-primary"><Mail size={17} />和我聊聊</a></FadeIn>
      </section>
      <section className="container section-shell"><FadeIn className="section-heading"><span className="eyebrow dark">WHAT I CARE ABOUT</span><h2>我持续关注的事情</h2></FadeIn><Stagger className="interest-grid">{interests.map(({ icon: Icon, title, text }) => <HoverLift key={title} className="interest-card"><Icon size={24} /><h3>{title}</h3><p>{text}</p></HoverLift>)}</Stagger></section>
      <section className="quote-section"><FadeIn className="container"><blockquote>“愿每一次记录，都让我们更接近真实的自己。”</blockquote><span>— huiyiziyuan</span></FadeIn></section>
    </main>
  )
}
