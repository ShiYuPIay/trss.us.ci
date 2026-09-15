import type { AppEnv, SessionUser } from '../types.ts'
import { ApiError, ok, readJson } from '../lib/http.ts'
import { KEYS, getJson, listKeys, putJson, removeKey } from '../lib/store.ts'
import { loadUser, readSession, toSessionUser } from '../lib/session.ts'
import { seedArticles } from '../seed/articles.ts'

export interface ArticleRecord {
  id: string
  user_id?: string
  slug: string
  title: string
  excerpt: string
  content: string
  cover_url: string
  tags: string[]
  status: 'draft' | 'published'
  featured: boolean
  author: string
  reading_time: string
  attachments: { name: string; url: string; size?: number; type?: string }[]
  published_at: string
  created_at: string
  updated_at: string
}

interface ArticleIndexEntry {
  slug: string
  status: 'draft' | 'published'
  title: string
  published_at: string
  updated_at: string
}

const SEED = seedArticles

async function requireUser(env: AppEnv, request: Request): Promise<SessionUser> {
  const session = await readSession(env, request)
  if (!session) throw new ApiError(401, 'unauthorized', '请先登录后再进行此操作')
  const user = await loadUser(env, session.record.uid)
  if (!user) throw new ApiError(401, 'unauthorized', '登录状态已失效，请重新登录')
  return toSessionUser(user)
}

/** 首次访问时把内置示例文章播种进 SITE_KV，让站点内容与 KV 数据源一致。 */
async function ensureSeeded(env: AppEnv): Promise<void> {
  const flag = await getJson<boolean>(env.SITE_KV, KEYS.seedFlag)
  if (flag) return
  for (const article of SEED) {
    await putJson(env.SITE_KV, KEYS.article(article.slug), article)
  }
  await putJson(env.SITE_KV, KEYS.articleIndex, SEED.map(toIndexEntry))
  await putJson(env.SITE_KV, KEYS.seedFlag, true)
}

function toIndexEntry(article: ArticleRecord): ArticleIndexEntry {
  return {
    slug: article.slug,
    status: article.status,
    title: article.title,
    published_at: article.published_at,
    updated_at: article.updated_at,
  }
}

/** 读取文章索引；索引缺失时按前缀重建，避免依赖单一索引键的可用性。 */
async function readIndex(env: AppEnv): Promise<ArticleIndexEntry[]> {
  const index = await getJson<ArticleIndexEntry[]>(env.SITE_KV, KEYS.articleIndex)
  if (Array.isArray(index) && index.length) return index

  const names = await listKeys(env.SITE_KV, 'article:')
  const rebuilt: ArticleIndexEntry[] = []
  for (const name of names) {
    const article = await getJson<ArticleRecord>(env.SITE_KV, name)
    if (article) rebuilt.push(toIndexEntry(article))
  }
  rebuilt.sort((a, b) => (a.published_at < b.published_at ? 1 : -1))
  if (rebuilt.length) await putJson(env.SITE_KV, KEYS.articleIndex, rebuilt)
  return rebuilt
}

async function writeIndex(env: AppEnv, entries: ArticleIndexEntry[]): Promise<void> {
  entries.sort((a, b) => (a.published_at < b.published_at ? 1 : -1))
  await putJson(env.SITE_KV, KEYS.articleIndex, entries)
}

function sanitizeSlug(raw: unknown, fallbackTitle: string): string {
  const source = typeof raw === 'string' && raw.trim() ? raw : fallbackTitle
  const slug = source
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\u4e00-\u9fa5-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return slug || `article-${Date.now()}`
}

function normalizeInput(body: Record<string, unknown>): Partial<ArticleRecord> {
  const tags = Array.isArray(body.tags)
    ? body.tags.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean)
    : []
  const attachments = Array.isArray(body.attachments)
    ? (body.attachments as Record<string, unknown>[])
        .filter((item) => item && typeof item.url === 'string')
        .map((item) => ({
          name: typeof item.name === 'string' ? item.name : '附件',
          url: String(item.url),
          size: typeof item.size === 'number' ? item.size : undefined,
          type: typeof item.type === 'string' ? item.type : undefined,
        }))
    : []
  return {
    title: typeof body.title === 'string' ? body.title.trim() : undefined,
    excerpt: typeof body.excerpt === 'string' ? body.excerpt : undefined,
    content: typeof body.content === 'string' ? body.content : undefined,
    cover_url: typeof body.cover_url === 'string' ? body.cover_url : undefined,
    tags,
    attachments,
    featured: body.featured === true,
    status: body.status === 'draft' ? 'draft' : 'published',
    author: typeof body.author === 'string' && body.author ? body.author : undefined,
    reading_time: typeof body.reading_time === 'string' ? body.reading_time : undefined,
    published_at: typeof body.published_at === 'string' ? body.published_at : undefined,
  }
}

export async function handleArticles(request: Request, env: AppEnv, url: URL): Promise<Response> {
  const method = request.method.toUpperCase()
  const path = url.pathname.replace(/\/+$/, '') || '/api/articles'
  await ensureSeeded(env)

  // 列表
  if (path === '/api/articles' && method === 'GET') {
    const scope = url.searchParams.get('scope') || 'published'
    let entries = await readIndex(env)
    if (scope !== 'all') entries = entries.filter((entry) => entry.status === 'published')
    else {
      const user = await readSession(env, request)
      if (!user) entries = entries.filter((entry) => entry.status === 'published')
    }
    const limit = Math.min(Number(url.searchParams.get('limit') || '100') || 100, 200)
    const slugs = entries.slice(0, limit).map((entry) => entry.slug)
    const articles = (await Promise.all(slugs.map((slug) => getJson<ArticleRecord>(env.SITE_KV, KEYS.article(slug))))).filter(
      (item): item is ArticleRecord => item !== null,
    )
    return ok({ articles, total: entries.length })
  }

  // 详情
  const detailMatch = path.match(/^\/api\/articles\/([^/]+)$/)
  if (detailMatch && method === 'GET') {
    const slug = decodeURIComponent(detailMatch[1])
    const article = await getJson<ArticleRecord>(env.SITE_KV, KEYS.article(slug))
    if (!article) throw new ApiError(404, 'article_not_found', '文章不存在')
    if (article.status !== 'published') {
      const session = await readSession(env, request)
      if (!session) throw new ApiError(404, 'article_not_found', '文章不存在')
    }
    return ok({ article })
  }

  // 新建
  if (path === '/api/articles' && method === 'POST') {
    const user = await requireUser(env, request)
    const body = await readJson<Record<string, unknown>>(request, 512 * 1024)
    const input = normalizeInput(body)
    if (!input.title) throw new ApiError(400, 'title_required', '请先填写文章标题')

    const slug = sanitizeSlug(body.slug, input.title)
    const existing = await getJson<ArticleRecord>(env.SITE_KV, KEYS.article(slug))
    if (existing) throw new ApiError(409, 'slug_exists', '已存在同名文章，请修改标题或手动指定 slug')

    const now = new Date().toISOString()
    const article: ArticleRecord = {
      id: slug,
      user_id: user.uid,
      slug,
      title: input.title,
      excerpt: input.excerpt || '',
      content: input.content || '',
      cover_url: input.cover_url || '',
      tags: input.tags || [],
      status: input.status || 'published',
      featured: input.featured === true,
      author: input.author || user.name,
      reading_time: input.reading_time || `${Math.max(1, Math.ceil((input.content || '').length / 500))} 分钟阅读`,
      attachments: input.attachments || [],
      published_at: input.published_at || now.slice(0, 10),
      created_at: now,
      updated_at: now,
    }
    await putJson(env.SITE_KV, KEYS.article(slug), article)

    const entries = await readIndex(env)
    await writeIndex(env, [...entries.filter((entry) => entry.slug !== slug), toIndexEntry(article)])
    return ok({ article }, { status: 201 })
  }

  // 更新
  if (detailMatch && (method === 'PUT' || method === 'PATCH')) {
    const user = await requireUser(env, request)
    const slug = decodeURIComponent(detailMatch[1])
    const article = await getJson<ArticleRecord>(env.SITE_KV, KEYS.article(slug))
    if (!article) throw new ApiError(404, 'article_not_found', '文章不存在')
    if (article.user_id && article.user_id !== user.uid) {
      throw new ApiError(403, 'forbidden', '只能修改自己创建的文章')
    }
    const input = normalizeInput(await readJson<Record<string, unknown>>(request, 512 * 1024))
    const updated: ArticleRecord = {
      ...article,
      ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)),
      slug,
      updated_at: new Date().toISOString(),
    } as ArticleRecord
    await putJson(env.SITE_KV, KEYS.article(slug), updated)

    const entries = await readIndex(env)
    await writeIndex(env, [...entries.filter((entry) => entry.slug !== slug), toIndexEntry(updated)])
    return ok({ article: updated })
  }

  // 删除
  if (detailMatch && method === 'DELETE') {
    const user = await requireUser(env, request)
    const slug = decodeURIComponent(detailMatch[1])
    const article = await getJson<ArticleRecord>(env.SITE_KV, KEYS.article(slug))
    if (!article) throw new ApiError(404, 'article_not_found', '文章不存在')
    if (article.user_id && article.user_id !== user.uid) {
      throw new ApiError(403, 'forbidden', '只能删除自己创建的文章')
    }
    await removeKey(env.SITE_KV, KEYS.article(slug))
    const entries = await readIndex(env)
    await writeIndex(env, entries.filter((entry) => entry.slug !== slug))
    return ok({ deleted: slug })
  }

  throw new ApiError(404, 'not_found', `未知的文章接口：${method} ${path}`)
}
