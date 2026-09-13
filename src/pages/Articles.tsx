import { useMemo, useState } from 'react'
import { Search, SlidersHorizontal } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { FadeIn, Stagger } from '@/components/MotionPrimitives'
import { ArticleCard } from '@/components/blog/ArticleCard'
import { useArticles } from '@/hooks/use-articles'

export default function Articles() {
  const { data: articles = [], isError, refetch } = useArticles()
  const [params, setParams] = useSearchParams()
  const [keyword, setKeyword] = useState('')
  const activeTag = params.get('tag') || ''
  const tags = Array.from(new Set(articles.flatMap((article) => article.tags)))
  const filtered = useMemo(() => articles.filter((article) => {
    const matchesTag = !activeTag || article.tags.includes(activeTag)
    const query = keyword.trim().toLowerCase()
    const matchesKeyword = !query || `${article.title}${article.excerpt}${article.tags.join('')}`.toLowerCase().includes(query)
    return matchesTag && matchesKeyword
  }), [articles, activeTag, keyword])

  return (
    <main className="page-main">
      <section className="page-hero container">
        <FadeIn><span className="eyebrow dark">ARCHIVE · 文章归档</span><h1>所有文章</h1><p>在旅行、设计、阅读与生活之间，收集值得被认真记住的片段。</p></FadeIn>
      </section>
      <section className="container article-browser">
        {isError && <div className="cloud-error-strip"><span>云端文章暂时无法读取，当前展示精选示例内容。</span><button onClick={() => refetch()}>重新连接</button></div>}
        <FadeIn className="filter-panel glass-light">
          <label className="search-box"><Search size={18} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索标题、摘要或标签" aria-label="搜索文章" /></label>
          <div className="filter-tags"><span className="filter-label"><SlidersHorizontal size={16} />筛选</span><button className={!activeTag ? 'active' : ''} onClick={() => setParams({})}>全部</button>{tags.map((tag) => <button key={tag} className={activeTag === tag ? 'active' : ''} onClick={() => setParams({ tag })}>{tag}</button>)}</div>
        </FadeIn>
        <div className="result-line">找到 <strong>{filtered.length}</strong> 篇文章{activeTag && <span> · 标签「{activeTag}」</span>}</div>
        {filtered.length ? <Stagger className="article-grid">{filtered.map((article) => <ArticleCard key={article.slug} article={article} />)}</Stagger> : <FadeIn className="empty-state"><Search size={28} /><h2>暂时没有匹配的文章</h2><p>换个关键词，或清除标签筛选再试试。</p></FadeIn>}
      </section>
    </main>
  )
}
