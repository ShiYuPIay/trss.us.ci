/**
 * 写作项目与章节的 API。
 *
 * 路由：
 *   POST   /api/projects                      创建项目
 *   GET    /api/projects                      当前用户的项目列表（支持 ?status= &visibility=）
 *   GET    /api/projects/:id                  项目详情（含章节索引与进度）
 *   PATCH  /api/projects/:id                  更新项目
 *   DELETE /api/projects/:id                  删除项目（级联删除章节）
 *   POST   /api/projects/:id/chapters         新增章节
 *   POST   /api/projects/:id/chapters/reorder 章节重排
 *   GET    /api/chapters/:id                  章节详情（含正文）
 *   PATCH  /api/chapters/:id                  更新章节
 *   DELETE /api/chapters/:id                  删除章节
 *
 * 权限：所有接口都要求登录，且**只能操作自己的项目**（越权返回 403 而非 404，
 * 便于前端区分「不存在」与「不是你的」）。
 */

import type { AppEnv, SessionUser } from '../types.ts'
import { ApiError, ok, readJson } from '../lib/http.ts'
import { loadUser, readSession, toSessionUser } from '../lib/session.ts'
import {
  computeProgress,
  createChapter,
  createProject,
  deleteChapter,
  deleteProject,
  getChapter,
  getProject,
  isProjectStatus,
  listChapterIndex,
  listUserProjectIds,
  reorderChapters,
  updateChapter,
  updateProject,
  type ChapterRecord,
  type ProjectRecord,
} from '../lib/projects.ts'

/** 单次请求体上限：正文可能较长，放宽到 1 MB。 */
const MAX_BODY = 1024 * 1024

async function requireUser(env: AppEnv, request: Request): Promise<SessionUser> {
  const session = await readSession(env, request)
  if (!session) throw new ApiError(401, 'unauthorized', '请先登录后再进行此操作')
  const user = await loadUser(env, session.record.uid)
  if (!user) throw new ApiError(401, 'unauthorized', '登录状态已失效，请重新登录')
  return toSessionUser(user)
}

/** 取项目并校验归属。 */
async function requireOwnedProject(env: AppEnv, id: string, uid: string): Promise<ProjectRecord> {
  const project = await getProject(env, id)
  if (!project) throw new ApiError(404, 'project_not_found', '项目不存在')
  if (project.user_id !== uid) throw new ApiError(403, 'forbidden', '只能操作自己的项目')
  return project
}

/** 取章节并校验归属（通过其所属项目）。 */
async function requireOwnedChapter(env: AppEnv, id: string, uid: string): Promise<ChapterRecord> {
  const chapter = await getChapter(env, id)
  if (!chapter) throw new ApiError(404, 'chapter_not_found', '章节不存在')
  if (chapter.user_id !== uid) throw new ApiError(403, 'forbidden', '只能操作自己的章节')
  return chapter
}

export async function handleProjects(request: Request, env: AppEnv, url: URL): Promise<Response> {
  const method = request.method.toUpperCase()
  const path = url.pathname.replace(/\/+$/, '') || '/api/projects'
  const user = await requireUser(env, request)

  // ── 项目集合 ─────────────────────────────────────────────
  if (path === '/api/projects') {
    if (method === 'POST') {
      const body = await readJson<Record<string, unknown>>(request, MAX_BODY).catch(() => ({}) as Record<string, unknown>)
      const project = await createProject(env, user.uid, {
        title: typeof body.title === 'string' ? body.title : undefined,
        summary: typeof body.summary === 'string' ? body.summary : undefined,
        type: body.type as never,
        target_words: typeof body.target_words === 'number' ? body.target_words : undefined,
        due_date: typeof body.due_date === 'string' ? body.due_date : undefined,
        visibility: body.visibility as never,
      })
      return ok({ project: withProgress(project, []) }, { status: 201 })
    }

    if (method === 'GET') {
      const statusFilter = url.searchParams.get('status')
      const visibilityFilter = url.searchParams.get('visibility')
      const ids = await listUserProjectIds(env, user.uid)

      const items = []
      for (const id of ids) {
        const project = await getProject(env, id)
        if (!project) continue
        if (isProjectStatus(statusFilter) && project.status !== statusFilter) continue
        if (visibilityFilter === 'public' || visibilityFilter === 'private') {
          if (project.visibility !== visibilityFilter) continue
        }
        const chapters = await listChapterIndex(env, project.id)
        items.push(withProgress(project, chapters))
      }
      // 按更新时间倒序，与「进行中」的语义一致
      items.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
      return ok({ projects: items })
    }

    throw new ApiError(405, 'method_not_allowed', `项目集合不支持 ${method}`)
  }

  // ── 章节重排（需在 /:id/chapters 之前匹配，避免被 :chapterId 吃掉）──
  const reorderMatch = path.match(/^\/api\/projects\/([^/]+)\/chapters\/reorder$/)
  if (reorderMatch) {
    if (method !== 'POST') throw new ApiError(405, 'method_not_allowed', `章节重排不支持 ${method}`)
    const project = await requireOwnedProject(env, decodeURIComponent(reorderMatch[1]), user.uid)
    const body = await readJson<{ ids?: unknown }>(request, MAX_BODY).catch(() => ({}) as { ids?: unknown })
    const ids = Array.isArray(body.ids) ? body.ids.filter((v): v is string => typeof v === 'string') : []
    const chapters = await reorderChapters(env, project.id, ids)
    return ok({ chapters })
  }

  // ── 项目下的章节集合 ─────────────────────────────────────
  const chaptersMatch = path.match(/^\/api\/projects\/([^/]+)\/chapters$/)
  if (chaptersMatch) {
    const project = await requireOwnedProject(env, decodeURIComponent(chaptersMatch[1]), user.uid)

    if (method === 'POST') {
      const body = await readJson<Record<string, unknown>>(request, MAX_BODY).catch(() => ({}) as Record<string, unknown>)
      const chapter = await createChapter(env, project, {
        title: typeof body.title === 'string' ? body.title : undefined,
        content: typeof body.content === 'string' ? body.content : undefined,
        target_words: typeof body.target_words === 'number' ? body.target_words : undefined,
      })
      return ok({ chapter }, { status: 201 })
    }

    if (method === 'GET') {
      return ok({ chapters: await listChapterIndex(env, project.id) })
    }

    throw new ApiError(405, 'method_not_allowed', `章节集合不支持 ${method}`)
  }

  // ── 单个项目 ─────────────────────────────────────────────
  const projectMatch = path.match(/^\/api\/projects\/([^/]+)$/)
  if (projectMatch) {
    const id = decodeURIComponent(projectMatch[1])

    if (method === 'GET') {
      const project = await requireOwnedProject(env, id, user.uid)
      const chapters = await listChapterIndex(env, project.id)
      return ok({ project: withProgress(project, chapters), chapters })
    }

    if (method === 'PATCH' || method === 'PUT') {
      const project = await requireOwnedProject(env, id, user.uid)
      const body = await readJson<Record<string, unknown>>(request, MAX_BODY).catch(() => ({}) as Record<string, unknown>)
      const updated = await updateProject(env, project, {
        title: typeof body.title === 'string' ? body.title : undefined,
        summary: typeof body.summary === 'string' ? body.summary : undefined,
        type: body.type as never,
        status: body.status as never,
        visibility: body.visibility as never,
        target_words: typeof body.target_words === 'number' ? body.target_words : undefined,
        due_date: typeof body.due_date === 'string' ? body.due_date : undefined,
        cover_url: typeof body.cover_url === 'string' ? body.cover_url : undefined,
        tags: Array.isArray(body.tags) ? (body.tags as string[]) : undefined,
      })
      const chapters = await listChapterIndex(env, updated.id)
      return ok({ project: withProgress(updated, chapters) })
    }

    if (method === 'DELETE') {
      const project = await requireOwnedProject(env, id, user.uid)
      await deleteProject(env, project)
      return ok({ deleted: project.id })
    }

    throw new ApiError(405, 'method_not_allowed', `项目不支持 ${method}`)
  }

  // ── 单个章节 ─────────────────────────────────────────────
  const chapterMatch = path.match(/^\/api\/chapters\/([^/]+)$/)
  if (chapterMatch) {
    const id = decodeURIComponent(chapterMatch[1])

    if (method === 'GET') {
      const chapter = await requireOwnedChapter(env, id, user.uid)
      return ok({ chapter })
    }

    if (method === 'PATCH' || method === 'PUT') {
      const chapter = await requireOwnedChapter(env, id, user.uid)
      const body = await readJson<Record<string, unknown>>(request, MAX_BODY).catch(() => ({}) as Record<string, unknown>)
      const updated = await updateChapter(env, chapter, {
        title: typeof body.title === 'string' ? body.title : undefined,
        content: typeof body.content === 'string' ? body.content : undefined,
        status: body.status as never,
        target_words: typeof body.target_words === 'number' ? body.target_words : undefined,
      })
      return ok({ chapter: updated })
    }

    if (method === 'DELETE') {
      const chapter = await requireOwnedChapter(env, id, user.uid)
      await deleteChapter(env, chapter)
      return ok({ deleted: chapter.id })
    }

    throw new ApiError(405, 'method_not_allowed', `章节不支持 ${method}`)
  }

  throw new ApiError(404, 'not_found', `未知的项目接口：${method} ${path}`)
}

/** 项目详情里附带进度，避免前端重复计算。 */
function withProgress(project: ProjectRecord, chapters: Awaited<ReturnType<typeof listChapterIndex>>) {
  return { ...project, progress: computeProgress(project, chapters) }
}
