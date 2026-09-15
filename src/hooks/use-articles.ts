import { useQuery } from '@tanstack/react-query'
import { sampleArticles } from '@/data/articles'
import { getAuthToken } from '@/lib/auth-client'
import type { Article, ArticleAttachment } from '@/types/article'

/**
 * 文章数据源改为 Worker + SITE_KV：
 *   GET    /api/articles         列表（默认仅已发布）
 *   POST   /api/articles         新建（需登录）
 * 旧实现依赖腾讯 CloudBase 数据库，未配置凭据时整站只读，是登录不可用的同源问题。
 */

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function normalizeAttachments(value: unknown): ArticleAttachment[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const entry = item as Record<string, unknown>
    const url = text(entry.url)
    if (!url) return []
    return [{
      name: text(entry.name, '附件'),
      url,
      size: typeof entry.size === 'number' ? entry.size : undefined,
      type: text(entry.type) || undefined,
    }]
  })
}

const DEFAULT_COVER = 'https://images.unsplash.com/photo-1495446815901-a7297e633e8d?auto=format&fit=crop&w=1800&q=88'

function normalizeArticle(value: unknown): Article | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  const slug = text(item.slug)
  const title = text(item.title)
  if (!slug || !title) return null
  return {
    id: typeof item.id === 'string' || typeof item.id === 'number' ? item.id : slug,
    user_id: text(item.user_id) || undefined,
    slug,
    title,
    excerpt: text(item.excerpt),
    content: text(item.content),
    // 空字符串同样视为「无封面」：否则会渲染出空 src，触发浏览器整页重新下载
    cover_url: text(item.cover_url) || DEFAULT_COVER,
    tags: Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    status: item.status === 'draft' ? 'draft' : 'published',
    featured: item.featured === true,
    author: text(item.author, 'huiyiziyuan'),
    reading_time: text(item.reading_time, '阅读文章'),
    attachments: normalizeAttachments(item.attachments),
    published_at: text(item.published_at, text(item.created_at).slice(0, 10)),
    created_at: text(item.created_at) || undefined,
    updated_at: text(item.updated_at) || undefined,
  }
}

function authHeaders(): Record<string, string> {
  const token = getAuthToken()
  return token ? { authorization: `Bearer ${token}` } : {}
}

export async function fetchArticles(): Promise<Article[]> {
  const response = await fetch('/api/articles', { credentials: 'include', headers: authHeaders() })
  if (!response.ok) throw new Error(`文章加载失败（HTTP ${response.status}）`)
  const payload = (await response.json()) as { data?: { articles?: unknown[] } }
  const list = payload.data?.articles
  if (!Array.isArray(list)) return []
  return list.map(normalizeArticle).filter((article): article is Article => article !== null)
}

export async function createArticle(article: Omit<Article, 'id'>): Promise<Article> {
  const response = await fetch('/api/articles', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify(article),
  })
  const payload = (await response.json().catch(() => ({}))) as {
    status?: string
    data?: { article?: unknown }
    message?: string
  }
  if (!response.ok || payload.status === 'error') {
    throw new Error(payload.message || '文章保存失败')
  }
  return normalizeArticle(payload.data?.article) ?? ({ ...article, id: article.slug } as Article)
}

export function useArticles() {
  return useQuery({ queryKey: ['articles'], queryFn: fetchArticles, placeholderData: sampleArticles })
}
