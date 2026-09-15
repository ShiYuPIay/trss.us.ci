export type ArticleStatus = 'draft' | 'published'

export interface ArticleAttachment {
  name: string
  url: string
  size?: number
  type?: string
}

export interface Article {
  id: string | number
  user_id?: string
  slug: string
  title: string
  excerpt: string
  content: string
  cover_url: string
  tags: string[]
  status: ArticleStatus
  featured: boolean
  author: string
  reading_time: string
  attachments: ArticleAttachment[]
  published_at: string
  created_at?: string
  updated_at?: string
}
