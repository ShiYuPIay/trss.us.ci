import { ArrowRight, BookOpen, PenLine, Sparkles, Tags, UserRound } from 'lucide-react'
import { Link } from 'react-router-dom'
import { FadeIn, Stagger } from '@/components/MotionPrimitives'
import { ArticleCard } from '@/components/blog/ArticleCard'
import { HeroSlider } from '@/components/blog/HeroSlider'
import { CountUp } from '@/components/reactbits/CountUp'
import { useArticles } from '@/hooks/use-articles'

/** 子比式快捷入口：四块瓷片，各带一个主题色图标底。 */
const quickLinks = [
  { to: '/articles', label: '全部文章', hint: '按时间翻阅', tone: 'is-blue', Icon: BookOpen },
  { to: '/tags', label: '标签分类', hint: '循兴趣检索', tone: 'is-theme', Icon: Tags },
  { to: '/studio', label: '开始写作', hint: '进入创作空间', tone: 'is-orange', Icon: PenLine },
  { to: '/about', label: '关于作者', hint: '了解这个空间', tone: 'is-green', Icon: UserRound },
]

export default function Index() {
  const { data: articles = [], isError, refetch } = useArticles()
  const featured = articles.filter((article) => article.featured)
  const tags = Array.from(new Set(articles.flatMap((article) => article.tags)))

  return (
    <main>
      <HeroSlider articles={featured.length ? featured : articles} />
      {isError && <div className="container cloud-error-strip"><span>云端文章暂时无法读取，当前展示精选示例内容。</span><button onClick={() => refetch()}>重新连接</button></div>}

      <nav className="quick-nav container" aria-label="快捷入口">
        {quickLinks.map(({ to, label, hint, tone, Icon }) => (
          <Link key={to} to={to} className={`quick-tile ${tone}`}>
            <span className="quick-tile-icon"><Icon size={20} /></span>
            <span className="quick-tile-copy"><strong>{label}</strong><small>{hint}</small></span>
          </Link>
        ))}
      </nav>

      <section className="section-shell container">
        <FadeIn className="section-heading split-heading">
          <div><span className="eyebrow dark"><Sparkles size={15} /> LATEST WRITING</span><h2>最近写下的</h2></div>
          <Link to="/articles" className="text-link">查看全部文章 <ArrowRight size={17} /></Link>
        </FadeIn>
        <Stagger className="article-grid">
          {articles.slice(0, 6).map((article, index) => <ArticleCard key={article.slug} article={article} index={index} />)}
        </Stagger>
      </section>

      <section className="tag-feature-section">
        <div className="container tag-feature-grid">
          <FadeIn>
            <span className="eyebrow dark">EXPLORE TOPICS</span>
            <h2>循着兴趣，发现更多</h2>
            <p>旅行、写作、设计与生活。这里没有固定边界，只有持续生长的观察和记录。</p>
            <Link to="/tags" className="button button-primary">浏览全部标签 <ArrowRight size={17} /></Link>
          </FadeIn>
          <Stagger className="tag-cloud" stagger={0.05}>
            {tags.map((tag) => {
              const count = articles.filter((article) => article.tags.includes(tag)).length
              return <Link key={tag} to={`/articles?tag=${encodeURIComponent(tag)}`} className="tag-orbit"><span>{tag}</span><small><CountUp value={count} /> 篇</small></Link>
            })}
          </Stagger>
        </div>
      </section>

      <section className="container section-shell">
        <FadeIn className="about-banner">
          <div className="about-monogram">H</div>
          <div><span className="eyebrow dark">ABOUT THE AUTHOR</span><h2>你好，我是这个空间的记录者</h2><p>关注设计、文字与日常里微小但真实的变化。我相信持续记录，本身就是一种温柔的抵抗。</p></div>
          <Link to="/about" className="button button-ghost">认识我 <ArrowRight size={17} /></Link>
        </FadeIn>
      </section>
    </main>
  )
}
