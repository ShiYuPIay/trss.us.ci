import { ArrowUpRight, Clock } from 'lucide-react'
import { Link } from 'react-router-dom'
import { HoverLift } from '@/components/MotionPrimitives'
import type { Article } from '@/types/article'

/** 延迟上限：列表很长时不能让最后一张等太久才出现。 */
const MAX_STAGGER_DELAY = 0.3

export function ArticleCard({ article, compact = false, index = 0 }: { article: Article; compact?: boolean; index?: number }) {
  return (
    <HoverLift
      className={`article-card ${compact ? 'article-card-compact' : ''}`}
      delay={Math.min(index * 0.06, MAX_STAGGER_DELAY)}
    >
      <Link to={`/articles/${article.slug}`} className="article-card-link">
        <div className="article-cover-wrap">
          {/* 空 src 会让浏览器把当前页面重新下载一遍，因此无封面时不渲染 img */}
          {article.cover_url
            ? <img src={article.cover_url} alt={`${article.title}封面`} className="article-cover" loading="lazy" />
            : <div className="article-cover article-cover-fallback" aria-hidden="true" />}
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
