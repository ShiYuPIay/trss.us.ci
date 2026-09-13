import { ArrowUpRight, Clock } from 'lucide-react'
import { Link } from 'react-router-dom'
import { HoverLift } from '@/components/MotionPrimitives'
import type { Article } from '@/types/article'

export function ArticleCard({ article, compact = false }: { article: Article; compact?: boolean }) {
  return (
    <HoverLift className={`article-card ${compact ? 'article-card-compact' : ''}`}>
      <Link to={`/articles/${article.slug}`} className="article-card-link">
        <div className="article-cover-wrap">
          <img src={article.cover_url} alt={`${article.title}封面`} className="article-cover" loading="lazy" />
          <span className="article-arrow"><ArrowUpRight size={18} /></span>
        </div>
        <div className="article-body">
          <div className="tag-row">{article.tags.slice(0, 2).map((tag) => <span key={tag} className="tag-pill">{tag}</span>)}</div>
          <h3>{article.title}</h3>
          <p>{article.excerpt}</p>
          <div className="article-meta"><span>{article.published_at}</span><span><Clock size={14} />{article.reading_time}</span></div>
        </div>
      </Link>
    </HoverLift>
  )
}
