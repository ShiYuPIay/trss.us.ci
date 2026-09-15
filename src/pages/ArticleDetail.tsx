import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowUp, Bookmark, CalendarDays, ChevronLeft, ChevronRight, Clock, Download, Eye, Heart, List, Share2, Sparkles, UserRound } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { FadeIn, Stagger } from '@/components/MotionPrimitives'
import { ArticleCard } from '@/components/blog/ArticleCard'
import { MarkdownContent, headingId } from '@/components/blog/MarkdownContent'
import { Button } from '@/components/ui/button'
import { useArticles } from '@/hooks/use-articles'

function getTableOfContents(content: string) {
  return Array.from(content.matchAll(/^(#{2,3})\s+(.+)$/gm)).map((match) => ({
    depth: match[1].length,
    label: match[2].replace(/[*_`]/g, '').trim(),
    id: headingId(match[2]),
  }))
}

export default function ArticleDetail() {
  const { slug } = useParams()
  const { data: articles = [], isLoading, isError, refetch } = useArticles()
  const article = articles.find((item) => item.slug === slug)
  const toc = useMemo(() => getTableOfContents(article?.content ?? ''), [article?.content])
  const [activeHeading, setActiveHeading] = useState('')
  const [reactions, setReactions] = useState({ liked: false, saved: false })
  const [readingProgress, setReadingProgress] = useState(0)

  useEffect(() => {
    const updateProgress = () => {
      const documentHeight = document.documentElement.scrollHeight - window.innerHeight
      setReadingProgress(documentHeight > 0 ? Math.min(100, (window.scrollY / documentHeight) * 100) : 0)
    }
    const frame = window.requestAnimationFrame(updateProgress)
    window.addEventListener('scroll', updateProgress, { passive: true })
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', updateProgress)
    }
  }, [])

  useEffect(() => {
    if (!toc.length) return
    const elements = toc.map((item) => document.getElementById(item.id)).filter((item): item is HTMLElement => Boolean(item))
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.find((entry) => entry.isIntersecting)
      if (visible) setActiveHeading(visible.target.id)
    }, { rootMargin: '-110px 0px -65% 0px' })
    elements.forEach((element) => observer.observe(element))
    const frame = window.requestAnimationFrame(() => setActiveHeading((current) => current || toc[0].id))
    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [toc])

  if (isLoading) return <main className="page-main"><div className="container reading-loading">正在打开文章…</div></main>
  if (!article) return <main className="page-main"><div className="container empty-state"><h1>这篇文章暂时找不到</h1><Link to="/articles" className="button button-primary">返回文章列表</Link></div></main>

  const currentIndex = articles.findIndex((item) => item.slug === article.slug)
  const previous = currentIndex < articles.length - 1 ? articles[currentIndex + 1] : undefined
  const next = currentIndex > 0 ? articles[currentIndex - 1] : undefined
  const related = articles
    .filter((item) => item.slug !== article.slug)
    .sort((a, b) => Number(b.tags.some((tag) => article.tags.includes(tag))) - Number(a.tags.some((tag) => article.tags.includes(tag))))
    .slice(0, 3)

  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: article.title, url: window.location.href })
      else {
        await navigator.clipboard.writeText(window.location.href)
        toast.success('文章链接已复制')
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') toast.error('暂时无法分享，请稍后重试')
    }
  }

  return (
    <main className="article-detail">
      <div className="article-reading-progress" aria-hidden="true"><span style={{ width: `${readingProgress}%` }} /></div>
      <div className="container article-detail-shell">
        <nav className="article-breadcrumb" aria-label="面包屑导航">
          <Link to="/articles" className="breadcrumb-back"><ArrowLeft size={14} />返回文章</Link>
          <span className="breadcrumb-separator" />
          <Link to="/">首页</Link><ChevronRight size={14} /><Link to="/articles">文章</Link>
          {article.tags[0] && <><ChevronRight size={14} /><Link to={`/articles?tag=${encodeURIComponent(article.tags[0])}`}>{article.tags[0]}</Link></>}
        </nav>

        {isError && <div className="cloud-error-strip"><span>云端文章暂时无法读取，当前展示缓存内容。</span><button onClick={() => refetch()}>重新连接</button></div>}

        <section className="reading-layout">
          <div className="article-main-column">
            <FadeIn className="reading-card">
              <header className="detail-article-header">
                <div className="detail-kicker">
                  {article.featured && <span className="featured-label"><Sparkles size={13} />编辑精选</span>}
                  <span>{article.tags[0] || '个人随笔'}</span>
                </div>
                <h1>{article.title}</h1>
                <p className="article-lead">{article.excerpt}</p>
                <div className="detail-author-row">
                  <Link to="/about" className="detail-author"><span className="detail-author-avatar">H</span><span><strong>{article.author}</strong><small>记录设计、阅读与缓慢生活</small></span></Link>
                  <div className="detail-meta">
                    <span><CalendarDays size={15} />{article.published_at}</span>
                    <span><Clock size={15} />{article.reading_time}</span>
                    <span><Eye size={15} />公开阅读</span>
                  </div>
                </div>
              </header>

              {article.cover_url && <figure className="detail-cover"><img src={article.cover_url} alt={`${article.title}封面`} /><figcaption>huiyiziyuan · 让值得记住的片段被认真收藏</figcaption></figure>}
              <MarkdownContent content={article.content} hideTitle />

              {article.attachments.length > 0 && <div className="attachments"><h3>文章附件</h3>{article.attachments.map((file) => <a key={file.name} href={file.url} download><Download size={18} /><span>{file.name}</span><small>点击下载</small></a>)}</div>}

              <footer className="article-ending">
                <div className="article-copyright"><strong>版权说明</strong><span>本文由 {article.author} 原创发布，转载请保留出处。内容仅代表作者的个人记录。</span></div>
                <div className="article-tag-footer"><span>文章标签</span>{article.tags.map((tag) => <Link key={tag} to={`/articles?tag=${encodeURIComponent(tag)}`}># {tag}</Link>)}</div>
                <div className="article-end-mark"><span>THE END</span></div>
                <p>如果这篇文章对你有启发，欢迎留下一个回应</p>
                <div className="article-actions">
                  <Button variant="ghost" className={reactions.liked ? 'is-active' : ''} onClick={() => setReactions((value) => ({ ...value, liked: !value.liked }))}><Heart fill={reactions.liked ? 'currentColor' : 'none'} />{reactions.liked ? '已喜欢' : '喜欢'}</Button>
                  <Button variant="ghost" onClick={share}><Share2 />分享</Button>
                  <Button variant="ghost" className={reactions.saved ? 'is-active' : ''} onClick={() => setReactions((value) => ({ ...value, saved: !value.saved }))}><Bookmark fill={reactions.saved ? 'currentColor' : 'none'} />{reactions.saved ? '已收藏' : '收藏'}</Button>
                </div>
              </footer>
            </FadeIn>

            <FadeIn className="detail-author-card">
              <div className="author-avatar">H</div><div><span className="eyebrow dark">ABOUT THE AUTHOR</span><h2>{article.author}</h2><p>记录设计、阅读与缓慢生活，也收集那些值得被认真记住的片段。</p></div><Link to="/about" className="button button-outline">关于作者</Link>
            </FadeIn>

            {(previous || next) && <nav className="article-pagination" aria-label="文章翻页">
              {previous ? <Link to={`/articles/${previous.slug}`}><span><ChevronLeft size={15} />上一篇</span><strong>{previous.title}</strong></Link> : <span />}
              {next && <Link to={`/articles/${next.slug}`} className="next"><span>下一篇<ChevronRight size={15} /></span><strong>{next.title}</strong></Link>}
            </nav>}

            {related.length > 0 && <section className="related-section"><div className="detail-section-title"><span />相关推荐</div><Stagger className="related-grid" stagger={0.06}>{related.map((item, index) => <ArticleCard key={item.slug} article={item} compact index={index} />)}</Stagger></section>}
          </div>

          <aside className="reading-aside">
            <div className="sidebar-card sidebar-profile">
              <div className="sidebar-profile-cover" />
              <div className="sidebar-profile-avatar">H</div>
              <h2>{article.author}</h2>
              <p>在文字、设计与远方之间，记录缓慢但清晰的生活。</p>
              <div className="sidebar-profile-stats"><span><strong>{articles.length}</strong>文章</span><span><strong>{new Set(articles.flatMap((item) => item.tags)).size}</strong>标签</span></div>
              <Link to="/about"><UserRound size={15} />认识作者</Link>
            </div>
            {toc.length > 0 && <div className="sidebar-card toc-card"><div className="sidebar-title"><List size={18} />文章目录</div><nav>{toc.map((item) => <a key={item.id} href={`#${item.id}`} className={`${item.depth === 3 ? 'toc-child' : ''} ${activeHeading === item.id ? 'active' : ''}`} onClick={() => setActiveHeading(item.id)}>{item.label}</a>)}</nav></div>}
            <div className="sidebar-card sidebar-latest"><div className="sidebar-title"><Sparkles size={17} />最近文章</div>{articles.filter((item) => item.slug !== article.slug).slice(0, 5).map((item, index) => <Link key={item.slug} to={`/articles/${item.slug}`}><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{item.title}</strong><small>{item.published_at}</small></div></Link>)}</div>
          </aside>
        </section>
      </div>

      <div className="article-float-tools" aria-label="文章快捷操作">
        <Button variant="ghost" size="icon" className={reactions.liked ? 'is-active' : ''} onClick={() => setReactions((value) => ({ ...value, liked: !value.liked }))} aria-label="喜欢文章"><Heart size={18} fill={reactions.liked ? 'currentColor' : 'none'} /></Button>
        <Button variant="ghost" size="icon" className={reactions.saved ? 'is-active' : ''} onClick={() => setReactions((value) => ({ ...value, saved: !value.saved }))} aria-label="收藏文章"><Bookmark size={18} fill={reactions.saved ? 'currentColor' : 'none'} /></Button>
        <Button variant="ghost" size="icon" onClick={share} aria-label="分享文章"><Share2 size={18} /></Button>
        <Button variant="ghost" size="icon" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="返回顶部"><ArrowUp size={18} /></Button>
      </div>
    </main>
  )
}
