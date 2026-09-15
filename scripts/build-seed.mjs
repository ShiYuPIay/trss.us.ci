/**
 * 生成 Worker 侧的 KV 播种数据：从 src/data/articles.ts 抽取示例文章，
 * 补齐 KV 记录所需的时间字段，输出为可直接 import 的 TS 模块。
 *
 * 用法：node scripts/build-seed.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const root = path.resolve(import.meta.dirname, '..')
const source = fs.readFileSync(path.join(root, 'src/data/articles.ts'), 'utf-8')

const start = source.indexOf('[')
const end = source.lastIndexOf(']')
if (start < 0 || end < 0) throw new Error('未能在 src/data/articles.ts 中定位示例数据数组')

const arrayLiteral = source.slice(start, end + 1)
const articles = vm.runInNewContext(`(${arrayLiteral})`, Object.create(null))

const normalized = articles.map((article) => ({
  id: String(article.id ?? article.slug),
  slug: article.slug,
  title: article.title,
  excerpt: article.excerpt ?? '',
  content: article.content ?? '',
  cover_url: article.cover_url ?? '',
  tags: Array.isArray(article.tags) ? article.tags : [],
  status: article.status === 'draft' ? 'draft' : 'published',
  featured: article.featured === true,
  author: article.author ?? 'huiyiziyuan',
  reading_time: article.reading_time ?? '阅读文章',
  attachments: Array.isArray(article.attachments) ? article.attachments : [],
  published_at: article.published_at ?? '2025-01-01',
  created_at: `${article.published_at ?? '2025-01-01'}T00:00:00.000Z`,
  updated_at: `${article.published_at ?? '2025-01-01'}T00:00:00.000Z`,
}))

const outDir = path.join(root, 'worker/seed')
fs.mkdirSync(outDir, { recursive: true })

const banner = `/**
 * 自动生成，请勿手工编辑。来源：src/data/articles.ts
 * 重新生成：node scripts/build-seed.mjs
 */
import type { ArticleRecord } from '../routes/articles.ts'

export const seedArticles: ArticleRecord[] = `

fs.writeFileSync(path.join(outDir, 'articles.ts'), `${banner}${JSON.stringify(normalized, null, 2)}\n`, 'utf-8')
console.log(`已生成 worker/seed/articles.ts，共 ${normalized.length} 篇示例文章`)
