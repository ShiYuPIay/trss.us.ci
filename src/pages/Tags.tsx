import { ArrowUpRight, Hash } from 'lucide-react'
import { Link } from 'react-router-dom'
import { FadeIn, HoverLift, Stagger } from '@/components/MotionPrimitives'
import { CountUp } from '@/components/reactbits/CountUp'
import { useArticles } from '@/hooks/use-articles'

export default function Tags() {
  const { data: articles = [] } = useArticles()
  const tags = Array.from(new Set(articles.flatMap((article) => article.tags))).map((name) => ({ name, articles: articles.filter((article) => article.tags.includes(name)) }))
  return (
    <main className="page-main">
      <section className="page-hero container"><FadeIn><span className="eyebrow dark">TOPIC INDEX · 主题索引</span><h1>标签分类</h1><p>每个标签都是一条通往旧文章的小径，也是一段持续生长的兴趣。</p></FadeIn></section>
      <section className="container section-shell tags-page">
        <Stagger className="tags-grid">
          {tags.map((tag) => <HoverLift key={tag.name} className="tag-card"><Link to={`/articles?tag=${encodeURIComponent(tag.name)}`}><div className="tag-icon"><Hash size={22} /></div><div><h2>{tag.name}</h2><p><CountUp value={tag.articles.length} /> 篇文章</p><small>{tag.articles.slice(0, 2).map((article) => article.title).join(' · ')}</small></div><ArrowUpRight size={20} className="tag-card-arrow" /></Link></HoverLift>)}
        </Stagger>
      </section>
    </main>
  )
}
