import { useQuery } from '@tanstack/react-query'
import { cloudApp, db, isCloudConfigured } from '@/lib/cloudbase'
import { sampleArticles } from '@/data/articles'
import type { Article, ArticleAttachment } from '@/types/article'

function text(value: unknown, fallback = ''): string { return typeof value === 'string' ? value : fallback }

function normalizeAttachments(value: unknown): ArticleAttachment[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const entry = item as Record<string, unknown>
    const url = text(entry.url)
    if (!url) return []
    return [{ name: text(entry.name, '附件'), url, size: typeof entry.size === 'number' ? entry.size : undefined, type: text(entry.type) || undefined }]
  })
}

function normalizeArticle(value: unknown): Article | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  const slug = text(item.slug)
  const title = text(item.title)
  if (!slug || !title) return null
  return {
    id: typeof item.id === 'string' || typeof item.id === 'number' ? item.id : slug,
    user_id: text(item.user_id) || undefined,
    slug, title,
    excerpt: text(item.excerpt), content: text(item.content),
    cover_url: text(item.cover_url, 'https://images.unsplash.com/photo-1495446815901-a7297e633e8d?auto=format&fit=crop&w=1800&q=88'),
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

async function resolveAssetUrls(articles: Article[]): Promise<Article[]> {
  if (!cloudApp) return articles
  const ids = Array.from(new Set(articles.flatMap((article) => [article.cover_url, ...article.attachments.map((file) => file.url)]).filter((url) => url.startsWith('cloud://'))))
  if (!ids.length) return articles
  const result = await cloudApp.getTempFileURL({ fileList: ids })
  const urls = new Map((result.fileList || []).map((file) => [file.fileID, file.tempFileURL || file.fileID]))
  return articles.map((article) => ({ ...article, cover_url: urls.get(article.cover_url) || article.cover_url, attachments: article.attachments.map((file) => ({ ...file, url: urls.get(file.url) || file.url })) }))
}

export async function fetchArticles(): Promise<Article[]> {
  if (!db) return sampleArticles
  const { data, error } = await db.from('articles').select('*').eq('status', 'published').order('published_at', { ascending: false })
  if (error) throw new Error(error.message || '文章加载失败')
  const normalized = Array.isArray(data) ? data.map(normalizeArticle).filter((article): article is Article => article !== null) : []
  return resolveAssetUrls(normalized)
}

export async function createArticle(article: Omit<Article, 'id'>) {
  if (!db) throw new Error('云服务正在准备中，请稍后再试')
  const { error } = await db.from('articles').insert(article)
  if (error) throw new Error(error.message || '文章保存失败')
}

export function useArticles() {
  return useQuery({ queryKey: ['articles', isCloudConfigured], queryFn: fetchArticles, placeholderData: sampleArticles })
}
