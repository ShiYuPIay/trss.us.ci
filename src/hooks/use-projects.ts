import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getAuthToken } from '@/lib/auth-client'

/**
 * 写作项目与章节的前端数据层。
 *
 * 对应后端 worker/routes/projects.ts。约定与 use-articles 一致：
 *   - 原生 fetch + credentials: 'include'（会话走 HttpOnly Cookie）
 *   - 响应统一是 { status, data }，这里做一次归一化，避免页面里到处判空
 */

// ─────────────────────────── 类型 ───────────────────────────

export type ProjectType = 'longform' | 'series' | 'booklet'
export type ProjectStatus = 'idea' | 'outline' | 'drafting' | 'revising' | 'published' | 'iterating'
export type ProjectVisibility = 'private' | 'public'
export type ChapterStatus = 'empty' | 'drafting' | 'done'

export interface ProjectProgress {
  words: number
  targetWords: number
  wordRatio: number
  chapterCount: number
  doneChapters: number
  chapterRatio: number
}

export interface Project {
  id: string
  user_id: string
  title: string
  summary: string
  type: ProjectType
  status: ProjectStatus
  visibility: ProjectVisibility
  target_words: number
  due_date: string
  cover_url: string
  tags: string[]
  version: number
  published_at: string
  created_at: string
  updated_at: string
  progress: ProjectProgress
}

export interface ChapterIndexEntry {
  id: string
  title: string
  status: ChapterStatus
  target_words: number
  words: number
  updated_at: string
}

export interface Chapter {
  id: string
  project_id: string
  user_id: string
  title: string
  content: string
  status: ChapterStatus
  target_words: number
  created_at: string
  updated_at: string
}

/** 看板列的顺序即状态机的顺序。 */
export const PROJECT_STATUSES: ProjectStatus[] = ['idea', 'outline', 'drafting', 'revising', 'published', 'iterating']

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  idea: '构思',
  outline: '大纲',
  drafting: '撰写',
  revising: '修订',
  published: '已发布',
  iterating: '迭代中',
}

export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  longform: '长文',
  series: '系列',
  booklet: '小册子',
}

export const CHAPTER_STATUS_LABELS: Record<ChapterStatus, string> = {
  empty: '未开始',
  drafting: '撰写中',
  done: '已完成',
}

// ─────────────────────────── 归一化 ───────────────────────────

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function isStatus(v: unknown): v is ProjectStatus {
  return typeof v === 'string' && (PROJECT_STATUSES as string[]).includes(v)
}

function isType(v: unknown): v is ProjectType {
  return v === 'longform' || v === 'series' || v === 'booklet'
}

function isChapterStatus(v: unknown): v is ChapterStatus {
  return v === 'empty' || v === 'drafting' || v === 'done'
}

const EMPTY_PROGRESS: ProjectProgress = {
  words: 0,
  targetWords: 0,
  wordRatio: 0,
  chapterCount: 0,
  doneChapters: 0,
  chapterRatio: 0,
}

function normalizeProgress(value: unknown): ProjectProgress {
  if (!value || typeof value !== 'object') return EMPTY_PROGRESS
  const p = value as Record<string, unknown>
  return {
    words: num(p.words),
    targetWords: num(p.targetWords),
    wordRatio: num(p.wordRatio),
    chapterCount: num(p.chapterCount),
    doneChapters: num(p.doneChapters),
    chapterRatio: num(p.chapterRatio),
  }
}

function normalizeProject(value: unknown): Project | null {
  if (!value || typeof value !== 'object') return null
  const p = value as Record<string, unknown>
  const id = text(p.id)
  if (!id) return null
  return {
    id,
    user_id: text(p.user_id),
    title: text(p.title, '未命名项目'),
    summary: text(p.summary),
    type: isType(p.type) ? p.type : 'longform',
    status: isStatus(p.status) ? p.status : 'idea',
    visibility: p.visibility === 'public' ? 'public' : 'private',
    target_words: num(p.target_words),
    due_date: text(p.due_date),
    cover_url: text(p.cover_url),
    tags: Array.isArray(p.tags) ? p.tags.filter((t): t is string => typeof t === 'string') : [],
    version: num(p.version),
    published_at: text(p.published_at),
    created_at: text(p.created_at),
    updated_at: text(p.updated_at),
    progress: normalizeProgress(p.progress),
  }
}

function normalizeChapterIndexEntry(value: unknown): ChapterIndexEntry | null {
  if (!value || typeof value !== 'object') return null
  const c = value as Record<string, unknown>
  const id = text(c.id)
  if (!id) return null
  return {
    id,
    title: text(c.title, '未命名章节'),
    status: isChapterStatus(c.status) ? c.status : 'empty',
    target_words: num(c.target_words),
    words: num(c.words),
    updated_at: text(c.updated_at),
  }
}

function normalizeChapter(value: unknown): Chapter | null {
  if (!value || typeof value !== 'object') return null
  const c = value as Record<string, unknown>
  const id = text(c.id)
  if (!id) return null
  return {
    id,
    project_id: text(c.project_id),
    user_id: text(c.user_id),
    title: text(c.title, '未命名章节'),
    content: text(c.content),
    status: isChapterStatus(c.status) ? c.status : 'empty',
    target_words: num(c.target_words),
    created_at: text(c.created_at),
    updated_at: text(c.updated_at),
  }
}

// ─────────────────────────── 请求 ───────────────────────────

function authHeaders(): Record<string, string> {
  const token = getAuthToken()
  return token ? { authorization: `Bearer ${token}` } : {}
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: { ...authHeaders(), ...(init.headers || {}) },
  })
  const payload = (await response.json().catch(() => ({}))) as {
    status?: string
    data?: T
    message?: string
  }
  if (!response.ok || payload.status === 'error') {
    // 401 单独抛出，便于页面区分「未登录」与「业务失败」
    if (response.status === 401) throw new Error('UNAUTHORIZED')
    throw new Error(payload.message || `请求失败（HTTP ${response.status}）`)
  }
  return payload.data as T
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

// ─────────────────────────── 项目 hooks ───────────────────────────

export async function fetchProjects(): Promise<Project[]> {
  const data = await request<{ projects?: unknown[] }>('/api/projects')
  const list = data?.projects
  if (!Array.isArray(list)) return []
  return list.map(normalizeProject).filter((p): p is Project => p !== null)
}

export function useProjects() {
  return useQuery({ queryKey: ['projects'], queryFn: fetchProjects })
}

export function useProject(id: string | undefined) {
  return useQuery({
    queryKey: ['project', id],
    enabled: !!id,
    queryFn: async () => {
      const data = await request<{ project?: unknown; chapters?: unknown[] }>(`/api/projects/${id}`)
      const project = normalizeProject(data?.project)
      if (!project) throw new Error('项目不存在')
      const chapters = Array.isArray(data?.chapters)
        ? data.chapters.map(normalizeChapterIndexEntry).filter((c): c is ChapterIndexEntry => c !== null)
        : []
      return { project, chapters }
    },
  })
}

export function useCreateProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { title: string; summary?: string; type?: ProjectType; target_words?: number; due_date?: string }) => {
      const data = await request<{ project?: unknown }>('/api/projects', json(input))
      const project = normalizeProject(data?.project)
      if (!project) throw new Error('创建失败')
      return project
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

export function useUpdateProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Pick<Project, 'title' | 'summary' | 'status' | 'visibility' | 'type' | 'target_words' | 'due_date'>> }) => {
      const data = await request<{ project?: unknown }>(`/api/projects/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      })
      return normalizeProject(data?.project)
    },
    onSuccess: (_result, variables) => {
      void qc.invalidateQueries({ queryKey: ['projects'] })
      void qc.invalidateQueries({ queryKey: ['project', variables.id] })
    },
  })
}

export function useDeleteProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => request(`/api/projects/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

// ─────────────────────────── 章节 hooks ───────────────────────────

export function useChapter(id: string | undefined) {
  return useQuery({
    queryKey: ['chapter', id],
    enabled: !!id,
    queryFn: async () => {
      const data = await request<{ chapter?: unknown }>(`/api/chapters/${id}`)
      const chapter = normalizeChapter(data?.chapter)
      if (!chapter) throw new Error('章节不存在')
      return chapter
    },
  })
}

export function useCreateChapter(projectId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { title?: string; content?: string } = {}) => {
      const data = await request<{ chapter?: unknown }>(`/api/projects/${projectId}/chapters`, json(input))
      const chapter = normalizeChapter(data?.chapter)
      if (!chapter) throw new Error('创建章节失败')
      return chapter
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['project', projectId] })
      void qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

export function useUpdateChapter() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Pick<Chapter, 'title' | 'content' | 'status' | 'target_words'>> }) => {
      const data = await request<{ chapter?: unknown }>(`/api/chapters/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      })
      return normalizeChapter(data?.chapter)
    },
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: ['chapter', result?.id] })
      void qc.invalidateQueries({ queryKey: ['project', result?.project_id] })
      void qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

export function useDeleteChapter(projectId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => request(`/api/chapters/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['project', projectId] })
      void qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

export function useReorderChapters(projectId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const data = await request<{ chapters?: unknown[] }>(`/api/projects/${projectId}/chapters/reorder`, json({ ids }))
      return Array.isArray(data?.chapters)
        ? data.chapters.map(normalizeChapterIndexEntry).filter((c): c is ChapterIndexEntry => c !== null)
        : []
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['project', projectId] })
    },
  })
}
