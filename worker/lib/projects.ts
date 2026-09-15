/**
 * 写作项目与章节：数据模型与存储层。
 *
 * 设计要点（与方案 docs/产品定位与改造方案.md §6.2 对应）：
 *
 *   1. **项目是第一公民**，章节挂在项目下。文章（article）保留为「发布后的阅读输出」，
 *      在 P2 阶段由项目发布产生，两者并存而非替换。
 *
 *   2. **状态机可回退**：`已发布` 只是里程碑，不是终点。发布后继续编辑会回到 `迭代中`。
 *      这是「项目」与博客「文章」最实质的差别。
 *
 *   3. **章节单独存键**，不放项目对象里。原因：KV 单值上限 25 MB，且项目详情页
 *      只需要章节的标题与状态就能渲染大纲，不必把全文读出来。
 *
 *   4. **索引可重建**：`user:projects:<uid>` 与 `project:chapters:<id>` 都是缓存性质的索引，
 *      缺失时可按前缀重建（沿用 articles 路由的韧性做法）。
 */

import type { AppEnv } from '../types.ts'
import { randomToken } from './crypto.ts'
import { KEYS, getJson, listKeys, putJson, removeKey } from './store.ts'

// ─────────────────────────── 类型 ───────────────────────────

/** 项目形态，决定公开阅读页的呈现结构。 */
export type ProjectType = 'longform' | 'series' | 'booklet'

/**
 * 项目状态机。**可回退**——`published` 之后继续编辑会进入 `iterating`。
 * 顺序即看板列的顺序。
 */
export type ProjectStatus = 'idea' | 'outline' | 'drafting' | 'revising' | 'published' | 'iterating'

/** 可见性。**默认 private**：创作者工具应默认保护草稿。 */
export type ProjectVisibility = 'private' | 'public'

export type ChapterStatus = 'empty' | 'drafting' | 'done'

export interface ProjectRecord {
  id: string
  user_id: string
  title: string
  summary: string
  type: ProjectType
  status: ProjectStatus
  visibility: ProjectVisibility
  /** 目标字数；0 表示不设目标。 */
  target_words: number
  /** 截止日（YYYY-MM-DD）；空串表示不设。 */
  due_date: string
  cover_url: string
  tags: string[]
  /** 已发布后的版本号，每次重新发布 +1。未发布为 0。 */
  version: number
  published_at: string
  created_at: string
  updated_at: string
}

export interface ChapterRecord {
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

/** 章节索引项：大纲视图只需要这些字段，不必读全文。 */
export interface ChapterIndexEntry {
  id: string
  title: string
  status: ChapterStatus
  target_words: number
  /** 正文字数（写入时算好，避免列表页反复统计）。 */
  words: number
  updated_at: string
}

/** 项目索引项：看板与广场列表用。 */
export interface ProjectIndexEntry {
  id: string
  user_id: string
  title: string
  type: ProjectType
  status: ProjectStatus
  visibility: ProjectVisibility
  cover_url: string
  target_words: number
  words: number
  chapter_count: number
  due_date: string
  updated_at: string
  published_at: string
}

export const PROJECT_TYPES: ProjectType[] = ['longform', 'series', 'booklet']
export const PROJECT_STATUSES: ProjectStatus[] = ['idea', 'outline', 'drafting', 'revising', 'published', 'iterating']
export const CHAPTER_STATUSES: ChapterStatus[] = ['empty', 'drafting', 'done']

export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  longform: '长文',
  series: '系列',
  booklet: '小册子',
}

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  idea: '构思',
  outline: '大纲',
  drafting: '撰写',
  revising: '修订',
  published: '已发布',
  iterating: '迭代中',
}

export function isProjectType(v: unknown): v is ProjectType {
  return typeof v === 'string' && (PROJECT_TYPES as string[]).includes(v)
}
export function isProjectStatus(v: unknown): v is ProjectStatus {
  return typeof v === 'string' && (PROJECT_STATUSES as string[]).includes(v)
}
export function isChapterStatus(v: unknown): v is ChapterStatus {
  return typeof v === 'string' && (CHAPTER_STATUSES as string[]).includes(v)
}

// ─────────────────────────── 工具 ───────────────────────────

/**
 * 统计正文字数。
 *
 * 中英混排下不能简单按空格切词：中文没有词间空格，按空格切会把整段算成 1 个词。
 * 这里分开统计——CJK 字符按字计，其余按空白切词计。标点不计入。
 */
export function countWords(text: string): number {
  if (!text) return 0
  const cjk = text.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g)?.length ?? 0
  const latin = text
    .replace(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g, ' ')
    .split(/\s+/)
    .filter((w) => /[a-zA-Z0-9]/.test(w)).length
  return cjk + latin
}

/** 由正文首行或标题生成章节默认标题。 */
function defaultChapterTitle(index: number): string {
  return `第 ${index + 1} 章`
}

function nowIso(): string {
  return new Date().toISOString()
}

// ─────────────────────────── 章节 ───────────────────────────

function toChapterIndexEntry(chapter: ChapterRecord): ChapterIndexEntry {
  return {
    id: chapter.id,
    title: chapter.title,
    status: chapter.status,
    target_words: chapter.target_words,
    words: countWords(chapter.content),
    updated_at: chapter.updated_at,
  }
}

/** 读取章节索引；缺失时按项目前缀重建。 */
export async function listChapterIndex(env: AppEnv, projectId: string): Promise<ChapterIndexEntry[]> {
  const index = await getJson<ChapterIndexEntry[]>(env.SITE_KV, KEYS.projectChapters(projectId))
  if (Array.isArray(index)) return index
  return rebuildChapterIndex(env, projectId)
}

async function rebuildChapterIndex(env: AppEnv, projectId: string): Promise<ChapterIndexEntry[]> {
  const project = await getProject(env, projectId)
  if (!project) return []
  const names = await listKeys(env.SITE_KV, 'chapter:')
  const entries: ChapterIndexEntry[] = []
  for (const name of names) {
    const chapter = await getJson<ChapterRecord>(env.SITE_KV, name)
    if (chapter && chapter.project_id === projectId) entries.push(toChapterIndexEntry(chapter))
  }
  entries.sort((a, b) => (a.updated_at < b.updated_at ? -1 : 1))
  await putJson(env.SITE_KV, KEYS.projectChapters(projectId), entries)
  return entries
}

async function writeChapterIndex(env: AppEnv, projectId: string, entries: ChapterIndexEntry[]): Promise<void> {
  await putJson(env.SITE_KV, KEYS.projectChapters(projectId), entries)
}

export async function getChapter(env: AppEnv, id: string): Promise<ChapterRecord | null> {
  return getJson<ChapterRecord>(env.SITE_KV, KEYS.chapter(id))
}

export async function createChapter(
  env: AppEnv,
  project: ProjectRecord,
  input: { title?: string; content?: string; target_words?: number } = {},
): Promise<ChapterRecord> {
  const index = await listChapterIndex(env, project.id)
  const now = nowIso()
  const chapter: ChapterRecord = {
    id: `c_${randomToken(10)}`,
    project_id: project.id,
    user_id: project.user_id,
    title: (input.title || '').trim() || defaultChapterTitle(index.length),
    content: input.content || '',
    status: input.content ? 'drafting' : 'empty',
    target_words: Math.max(0, Math.floor(input.target_words || 0)),
    created_at: now,
    updated_at: now,
  }
  await putJson(env.SITE_KV, KEYS.chapter(chapter.id), chapter)
  await writeChapterIndex(env, project.id, [...index, toChapterIndexEntry(chapter)])
  await touchProject(env, project.id)
  return chapter
}

export async function updateChapter(
  env: AppEnv,
  chapter: ChapterRecord,
  patch: { title?: string; content?: string; status?: ChapterStatus; target_words?: number },
): Promise<ChapterRecord> {
  const next: ChapterRecord = {
    ...chapter,
    title: typeof patch.title === 'string' ? patch.title.trim() || chapter.title : chapter.title,
    content: typeof patch.content === 'string' ? patch.content : chapter.content,
    status: isChapterStatus(patch.status) ? patch.status : chapter.status,
    target_words:
      typeof patch.target_words === 'number' ? Math.max(0, Math.floor(patch.target_words)) : chapter.target_words,
    updated_at: nowIso(),
  }
  // 正文从空变为非空时自动把状态从 empty 推进到 drafting，避免用户忘记改状态
  if (chapter.status === 'empty' && next.content.trim() && next.status === 'empty') next.status = 'drafting'
  await putJson(env.SITE_KV, KEYS.chapter(next.id), next)

  const index = await listChapterIndex(env, next.project_id)
  await writeChapterIndex(
    env,
    next.project_id,
    index.map((e) => (e.id === next.id ? toChapterIndexEntry(next) : e)),
  )
  await touchProject(env, next.project_id)
  return next
}

export async function deleteChapter(env: AppEnv, chapter: ChapterRecord): Promise<void> {
  await removeKey(env.SITE_KV, KEYS.chapter(chapter.id))
  const index = await listChapterIndex(env, chapter.project_id)
  await writeChapterIndex(
    env,
    chapter.project_id,
    index.filter((e) => e.id !== chapter.id),
  )
  await touchProject(env, chapter.project_id)
}

/** 按传入的 id 顺序重排章节（未出现在列表中的保持在后）。 */
export async function reorderChapters(env: AppEnv, projectId: string, orderedIds: string[]): Promise<ChapterIndexEntry[]> {
  const index = await listChapterIndex(env, projectId)
  const byId = new Map(index.map((e) => [e.id, e]))
  const reordered: ChapterIndexEntry[] = []
  for (const id of orderedIds) {
    const entry = byId.get(id)
    if (entry) {
      reordered.push(entry)
      byId.delete(id)
    }
  }
  for (const entry of index) if (byId.has(entry.id)) reordered.push(entry)
  await writeChapterIndex(env, projectId, reordered)
  return reordered
}

// ─────────────────────────── 项目 ───────────────────────────

export async function getProject(env: AppEnv, id: string): Promise<ProjectRecord | null> {
  return getJson<ProjectRecord>(env.SITE_KV, KEYS.project(id))
}

/** 读取用户的项目索引；缺失时按 projects:index 过滤重建。 */
export async function listUserProjectIds(env: AppEnv, uid: string): Promise<string[]> {
  const ids = await getJson<string[]>(env.SITE_KV, KEYS.userProjects(uid))
  if (Array.isArray(ids)) return ids

  const all = await listAllProjectEntries(env)
  const rebuilt = all.filter((e) => e.user_id === uid).map((e) => e.id)
  await putJson(env.SITE_KV, KEYS.userProjects(uid), rebuilt)
  return rebuilt
}

async function listAllProjectEntries(env: AppEnv): Promise<ProjectIndexEntry[]> {
  const index = await getJson<ProjectIndexEntry[]>(env.SITE_KV, KEYS.projectIndex)
  if (Array.isArray(index)) return index

  const names = await listKeys(env.SITE_KV, 'project:')
  const entries: ProjectIndexEntry[] = []
  for (const name of names) {
    // 跳过 project:chapters:<id> 这类同前缀的键
    if (name.startsWith('project:chapters:')) continue
    const project = await getJson<ProjectRecord>(env.SITE_KV, name)
    if (!project) continue
    const chapters = await listChapterIndex(env, project.id)
    entries.push(toProjectIndexEntry(project, chapters))
  }
  entries.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
  await putJson(env.SITE_KV, KEYS.projectIndex, entries)
  return entries
}

export function toProjectIndexEntry(project: ProjectRecord, chapters: ChapterIndexEntry[]): ProjectIndexEntry {
  return {
    id: project.id,
    user_id: project.user_id,
    title: project.title,
    type: project.type,
    status: project.status,
    visibility: project.visibility,
    cover_url: project.cover_url,
    target_words: project.target_words,
    words: chapters.reduce((sum, c) => sum + c.words, 0),
    chapter_count: chapters.length,
    due_date: project.due_date,
    updated_at: project.updated_at,
    published_at: project.published_at,
  }
}

async function upsertProjectIndex(env: AppEnv, entry: ProjectIndexEntry): Promise<void> {
  const all = await listAllProjectEntries(env)
  const next = all.filter((e) => e.id !== entry.id)
  next.push(entry)
  next.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
  await putJson(env.SITE_KV, KEYS.projectIndex, next)
}

/** 项目发生任何变化时刷新 updated_at 与索引。 */
async function touchProject(env: AppEnv, projectId: string): Promise<void> {
  const project = await getProject(env, projectId)
  if (!project) return
  const updated: ProjectRecord = { ...project, updated_at: nowIso() }
  await putJson(env.SITE_KV, KEYS.project(updated.id), updated)
  const chapters = await listChapterIndex(env, updated.id)
  await upsertProjectIndex(env, toProjectIndexEntry(updated, chapters))
}

export async function createProject(
  env: AppEnv,
  uid: string,
  input: {
    title?: string
    summary?: string
    type?: ProjectType
    target_words?: number
    due_date?: string
    visibility?: ProjectVisibility
  } = {},
): Promise<ProjectRecord> {
  const now = nowIso()
  const project: ProjectRecord = {
    id: `p_${randomToken(10)}`,
    user_id: uid,
    title: (input.title || '').trim() || '未命名项目',
    summary: (input.summary || '').trim(),
    type: isProjectType(input.type) ? input.type : 'longform',
    status: 'idea',
    // 默认私有：创作者工具应默认保护草稿
    visibility: input.visibility === 'public' ? 'public' : 'private',
    target_words: Math.max(0, Math.floor(input.target_words || 0)),
    due_date: typeof input.due_date === 'string' ? input.due_date.slice(0, 10) : '',
    cover_url: '',
    tags: [],
    version: 0,
    published_at: '',
    created_at: now,
    updated_at: now,
  }
  await putJson(env.SITE_KV, KEYS.project(project.id), project)

  const ids = await listUserProjectIds(env, uid)
  await putJson(env.SITE_KV, KEYS.userProjects(uid), [project.id, ...ids.filter((id) => id !== project.id)])
  await upsertProjectIndex(env, toProjectIndexEntry(project, []))
  return project
}

export async function updateProject(
  env: AppEnv,
  project: ProjectRecord,
  patch: Partial<Pick<ProjectRecord, 'title' | 'summary' | 'type' | 'status' | 'visibility' | 'target_words' | 'due_date' | 'cover_url' | 'tags'>>,
): Promise<ProjectRecord> {
  const next: ProjectRecord = {
    ...project,
    title: typeof patch.title === 'string' ? patch.title.trim() || project.title : project.title,
    summary: typeof patch.summary === 'string' ? patch.summary.trim() : project.summary,
    type: isProjectType(patch.type) ? patch.type : project.type,
    status: isProjectStatus(patch.status) ? patch.status : project.status,
    visibility: patch.visibility === 'public' || patch.visibility === 'private' ? patch.visibility : project.visibility,
    target_words: typeof patch.target_words === 'number' ? Math.max(0, Math.floor(patch.target_words)) : project.target_words,
    due_date: typeof patch.due_date === 'string' ? patch.due_date.slice(0, 10) : project.due_date,
    cover_url: typeof patch.cover_url === 'string' ? patch.cover_url : project.cover_url,
    tags: Array.isArray(patch.tags) ? patch.tags.filter((t) => typeof t === 'string').slice(0, 12) : project.tags,
    updated_at: nowIso(),
  }
  await putJson(env.SITE_KV, KEYS.project(next.id), next)
  const chapters = await listChapterIndex(env, next.id)
  await upsertProjectIndex(env, toProjectIndexEntry(next, chapters))
  return next
}

export async function deleteProject(env: AppEnv, project: ProjectRecord): Promise<void> {
  const chapters = await listChapterIndex(env, project.id)
  for (const chapter of chapters) await removeKey(env.SITE_KV, KEYS.chapter(chapter.id))
  await removeKey(env.SITE_KV, KEYS.projectChapters(project.id))
  await removeKey(env.SITE_KV, KEYS.project(project.id))

  const ids = await listUserProjectIds(env, project.user_id)
  await putJson(env.SITE_KV, KEYS.userProjects(project.user_id), ids.filter((id) => id !== project.id))

  const all = await listAllProjectEntries(env)
  await putJson(env.SITE_KV, KEYS.projectIndex, all.filter((e) => e.id !== project.id))
}

// ─────────────────────────── 进度 ───────────────────────────

export interface ProjectProgress {
  words: number
  targetWords: number
  /** 0–1；未设目标时为 0。 */
  wordRatio: number
  chapterCount: number
  doneChapters: number
  chapterRatio: number
}

export function computeProgress(project: ProjectRecord, chapters: ChapterIndexEntry[]): ProjectProgress {
  const words = chapters.reduce((sum, c) => sum + c.words, 0)
  const doneChapters = chapters.filter((c) => c.status === 'done').length
  return {
    words,
    targetWords: project.target_words,
    wordRatio: project.target_words > 0 ? Math.min(1, words / project.target_words) : 0,
    chapterCount: chapters.length,
    doneChapters,
    chapterRatio: chapters.length > 0 ? doneChapters / chapters.length : 0,
  }
}
