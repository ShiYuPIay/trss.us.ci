import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { handleRequest } from '../worker/index.ts'
import type { AppEnv } from '../worker/types.ts'
import { MemoryKV } from './kv-mock.ts'

const BASE = 'https://trss.us.ci'
const SESSION_SECRET = 'test-secret-0123456789abcdef0123456789abcdef'

function newEnv(): AppEnv {
  return {
    AUTH_KV: new MemoryKV(),
    SITE_KV: new MemoryKV(),
    BLOCKLIST_KV: new MemoryKV(),
    PUBLIC_BASE_URL: BASE,
    SESSION_SECRET,
    ENVIRONMENT: 'development',
    ALLOW_OTP_DEV_ECHO: 'true',
  } as AppEnv
}

async function call(env: AppEnv, path: string, init: RequestInit = {}): Promise<Response> {
  return handleRequest(new Request(`${BASE}${path}`, init), env)
}

async function send(env: AppEnv, method: string, path: string, body?: unknown, cookie?: string): Promise<Response> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (cookie) headers.cookie = cookie
  return call(env, path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
}

async function jsonOf<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

/** 注册一个用户并返回其会话 cookie。 */
async function signUp(env: AppEnv, email: string): Promise<string> {
  const response = await send(env, 'POST', '/api/auth/register', { email, password: 'Passw0rd123' })
  assert.equal(response.status, 200, `注册应成功，实际 ${response.status}`)
  return (response.headers.get('set-cookie') || '').split(';')[0]
}

type ProjectPayload = {
  data: {
    project: {
      id: string
      user_id: string
      title: string
      status: string
      visibility: string
      type: string
      version: number
      progress: { words: number; wordRatio: number; chapterCount: number; doneChapters: number }
    }
  }
}
type ChapterPayload = {
  data: { chapter: { id: string; project_id: string; title: string; content: string; status: string } }
}

describe('项目 API：鉴权', () => {
  it('未登录访问任一项目接口都返回 401', async () => {
    const env = newEnv()
    for (const [method, path] of [
      ['GET', '/api/projects'],
      ['POST', '/api/projects'],
      ['GET', '/api/projects/p_1'],
      ['PATCH', '/api/projects/p_1'],
      ['DELETE', '/api/projects/p_1'],
      ['GET', '/api/chapters/c_1'],
    ] as const) {
      const response = await send(env, method, path, method === 'POST' || method === 'PATCH' ? {} : undefined)
      assert.equal(response.status, 401, `${method} ${path} 应返回 401，实际 ${response.status}`)
    }
  })
})

describe('项目 API：创建与列表', () => {
  it('创建返回 201 且默认私有、状态为构思', async () => {
    const env = newEnv()
    const cookie = await signUp(env, 'creator@gmail.com')
    const response = await send(env, 'POST', '/api/projects', { title: '我的第一本书' }, cookie)
    assert.equal(response.status, 201)
    const { data } = await jsonOf<ProjectPayload>(response)
    assert.equal(data.project.title, '我的第一本书')
    assert.equal(data.project.visibility, 'private')
    assert.equal(data.project.status, 'idea')
    assert.equal(data.project.type, 'longform')
    assert.equal(data.project.progress.chapterCount, 0)
  })

  it('列表只返回自己的项目', async () => {
    const env = newEnv()
    const alice = await signUp(env, 'alice@gmail.com')
    const bob = await signUp(env, 'bob@gmail.com')
    await send(env, 'POST', '/api/projects', { title: 'A 的项目' }, alice)
    await send(env, 'POST', '/api/projects', { title: 'B 的项目' }, bob)

    const mine = await jsonOf<{ data: { projects: { title: string }[] } }>(await send(env, 'GET', '/api/projects', undefined, alice))
    assert.equal(mine.data.projects.length, 1)
    assert.equal(mine.data.projects[0].title, 'A 的项目')
  })

  it('列表支持按 status 过滤', async () => {
    const env = newEnv()
    const cookie = await signUp(env, 'filter@gmail.com')
    const created = await jsonOf<ProjectPayload>(await send(env, 'POST', '/api/projects', { title: 'P1' }, cookie))
    await send(env, 'POST', '/api/projects', { title: 'P2' }, cookie)
    await send(env, 'PATCH', `/api/projects/${created.data.project.id}`, { status: 'drafting' }, cookie)

    const filtered = await jsonOf<{ data: { projects: { title: string; status: string }[] } }>(
      await send(env, 'GET', '/api/projects?status=drafting', undefined, cookie),
    )
    assert.equal(filtered.data.projects.length, 1)
    assert.equal(filtered.data.projects[0].status, 'drafting')
  })

  it('空标题用占位名而不是空串', async () => {
    const env = newEnv()
    const cookie = await signUp(env, 'noname@gmail.com')
    const { data } = await jsonOf<ProjectPayload>(await send(env, 'POST', '/api/projects', {}, cookie))
    assert.equal(data.project.title, '未命名项目')
  })
})

describe('项目 API：详情、更新与删除', () => {
  it('详情附带进度与章节索引', async () => {
    const env = newEnv()
    const cookie = await signUp(env, 'detail@gmail.com')
    const created = await jsonOf<ProjectPayload>(await send(env, 'POST', '/api/projects', { title: 'P', target_words: 100 }, cookie))
    const pid = created.data.project.id
    await send(env, 'POST', `/api/projects/${pid}/chapters`, { content: '一二三四五' }, cookie)

    const detail = await jsonOf<{ data: { project: ProjectPayload['data']['project']; chapters: unknown[] } }>(
      await send(env, 'GET', `/api/projects/${pid}`, undefined, cookie),
    )
    assert.equal(detail.data.chapters.length, 1)
    assert.equal(detail.data.project.progress.words, 5)
    assert.equal(detail.data.project.progress.wordRatio, 0.05)
  })

  it('PATCH 可更新状态并支持回退', async () => {
    const env = newEnv()
    const cookie = await signUp(env, 'patch@gmail.com')
    const created = await jsonOf<ProjectPayload>(await send(env, 'POST', '/api/projects', { title: 'P' }, cookie))
    const pid = created.data.project.id

    const published = await jsonOf<ProjectPayload>(await send(env, 'PATCH', `/api/projects/${pid}`, { status: 'published', visibility: 'public' }, cookie))
    assert.equal(published.data.project.status, 'published')
    assert.equal(published.data.project.visibility, 'public')

    const iterating = await jsonOf<ProjectPayload>(await send(env, 'PATCH', `/api/projects/${pid}`, { status: 'iterating' }, cookie))
    assert.equal(iterating.data.project.status, 'iterating', '状态必须可回退')
  })

  it('删除项目后列表为空，且章节一并消失', async () => {
    const env = newEnv()
    const cookie = await signUp(env, 'del@gmail.com')
    const created = await jsonOf<ProjectPayload>(await send(env, 'POST', '/api/projects', { title: 'P' }, cookie))
    const pid = created.data.project.id
    const chapter = await jsonOf<ChapterPayload>(await send(env, 'POST', `/api/projects/${pid}/chapters`, { content: 'x' }, cookie))

    assert.equal((await send(env, 'DELETE', `/api/projects/${pid}`, undefined, cookie)).status, 200)
    assert.equal((await send(env, 'GET', `/api/projects/${pid}`, undefined, cookie)).status, 404)
    assert.equal((await send(env, 'GET', `/api/chapters/${chapter.data.chapter.id}`, undefined, cookie)).status, 404)

    const list = await jsonOf<{ data: { projects: unknown[] } }>(await send(env, 'GET', '/api/projects', undefined, cookie))
    assert.equal(list.data.projects.length, 0)
  })
})

describe('项目 API：越权与不存在', () => {
  it('访问他人项目返回 403（而非 404，便于前端区分）', async () => {
    const env = newEnv()
    const alice = await signUp(env, 'a2@gmail.com')
    const bob = await signUp(env, 'b2@gmail.com')
    const created = await jsonOf<ProjectPayload>(await send(env, 'POST', '/api/projects', { title: 'A 的' }, alice))
    const pid = created.data.project.id

    assert.equal((await send(env, 'GET', `/api/projects/${pid}`, undefined, bob)).status, 403)
    assert.equal((await send(env, 'PATCH', `/api/projects/${pid}`, { title: 'hack' }, bob)).status, 403)
    assert.equal((await send(env, 'DELETE', `/api/projects/${pid}`, undefined, bob)).status, 403)
    assert.equal((await send(env, 'POST', `/api/projects/${pid}/chapters`, {}, bob)).status, 403)
  })

  it('访问他人章节返回 403', async () => {
    const env = newEnv()
    const alice = await signUp(env, 'a3@gmail.com')
    const bob = await signUp(env, 'b3@gmail.com')
    const created = await jsonOf<ProjectPayload>(await send(env, 'POST', '/api/projects', { title: 'P' }, alice))
    const chapter = await jsonOf<ChapterPayload>(await send(env, 'POST', `/api/projects/${created.data.project.id}/chapters`, { content: 'x' }, alice))

    assert.equal((await send(env, 'GET', `/api/chapters/${chapter.data.chapter.id}`, undefined, bob)).status, 403)
  })

  it('不存在的项目返回 404', async () => {
    const env = newEnv()
    const cookie = await signUp(env, 'nf@gmail.com')
    assert.equal((await send(env, 'GET', '/api/projects/p_does_not_exist', undefined, cookie)).status, 404)
    assert.equal((await send(env, 'GET', '/api/chapters/c_does_not_exist', undefined, cookie)).status, 404)
  })
})

describe('章节 API', () => {
  it('新增章节默认标题递增，并自动进入 drafting', async () => {
    const env = newEnv()
    const cookie = await signUp(env, 'ch@gmail.com')
    const created = await jsonOf<ProjectPayload>(await send(env, 'POST', '/api/projects', { title: 'P' }, cookie))
    const pid = created.data.project.id

    const c1 = await jsonOf<ChapterPayload>(await send(env, 'POST', `/api/projects/${pid}/chapters`, {}, cookie))
    assert.equal(c1.data.chapter.title, '第 1 章')
    assert.equal(c1.data.chapter.status, 'empty')

    const c2 = await jsonOf<ChapterPayload>(await send(env, 'POST', `/api/projects/${pid}/chapters`, { content: '有内容' }, cookie))
    assert.equal(c2.data.chapter.title, '第 2 章')
    assert.equal(c2.data.chapter.status, 'drafting')
  })

  it('PATCH 章节正文后索引里的字数同步', async () => {
    const env = newEnv()
    const cookie = await signUp(env, 'chw@gmail.com')
    const created = await jsonOf<ProjectPayload>(await send(env, 'POST', '/api/projects', { title: 'P', target_words: 10 }, cookie))
    const pid = created.data.project.id
    const chapter = await jsonOf<ChapterPayload>(await send(env, 'POST', `/api/projects/${pid}/chapters`, {}, cookie))

    await send(env, 'PATCH', `/api/chapters/${chapter.data.chapter.id}`, { content: '一二三四五六七八九十' }, cookie)
    const detail = await jsonOf<{ data: { project: ProjectPayload['data']['project'] } }>(
      await send(env, 'GET', `/api/projects/${pid}`, undefined, cookie),
    )
    assert.equal(detail.data.project.progress.words, 10)
    assert.equal(detail.data.project.progress.wordRatio, 1)
  })

  it('章节重排按传入顺序生效', async () => {
    const env = newEnv()
    const cookie = await signUp(env, 'reorder@gmail.com')
    const created = await jsonOf<ProjectPayload>(await send(env, 'POST', '/api/projects', { title: 'P' }, cookie))
    const pid = created.data.project.id
    const a = await jsonOf<ChapterPayload>(await send(env, 'POST', `/api/projects/${pid}/chapters`, { title: 'A' }, cookie))
    const b = await jsonOf<ChapterPayload>(await send(env, 'POST', `/api/projects/${pid}/chapters`, { title: 'B' }, cookie))
    const c = await jsonOf<ChapterPayload>(await send(env, 'POST', `/api/projects/${pid}/chapters`, { title: 'C' }, cookie))

    const response = await send(
      env,
      'POST',
      `/api/projects/${pid}/chapters/reorder`,
      { ids: [c.data.chapter.id, a.data.chapter.id, b.data.chapter.id] },
      cookie,
    )
    assert.equal(response.status, 200)
    const { data } = await jsonOf<{ data: { chapters: { title: string }[] } }>(response)
    assert.deepEqual(
      data.chapters.map((x) => x.title),
      ['C', 'A', 'B'],
    )
  })

  it('删除章节返回 200 且再取为 404', async () => {
    const env = newEnv()
    const cookie = await signUp(env, 'chd@gmail.com')
    const created = await jsonOf<ProjectPayload>(await send(env, 'POST', '/api/projects', { title: 'P' }, cookie))
    const chapter = await jsonOf<ChapterPayload>(await send(env, 'POST', `/api/projects/${created.data.project.id}/chapters`, { content: 'x' }, cookie))
    const cid = chapter.data.chapter.id

    assert.equal((await send(env, 'DELETE', `/api/chapters/${cid}`, undefined, cookie)).status, 200)
    assert.equal((await send(env, 'GET', `/api/chapters/${cid}`, undefined, cookie)).status, 404)
  })
})

describe('项目 API：路由边界', () => {
  it('不支持的方法返回 405', async () => {
    const env = newEnv()
    const cookie = await signUp(env, 'm@gmail.com')
    const created = await jsonOf<ProjectPayload>(await send(env, 'POST', '/api/projects', { title: 'P' }, cookie))
    const pid = created.data.project.id
    assert.equal((await send(env, 'PUT', '/api/projects', {}, cookie)).status, 405)
    assert.equal((await send(env, 'DELETE', '/api/projects', undefined, cookie)).status, 405)
    // reorder 只接受 POST
    assert.equal((await send(env, 'GET', `/api/projects/${pid}/chapters/reorder`, undefined, cookie)).status, 405)
  })

  it('未知的项目子路径返回 404', async () => {
    const env = newEnv()
    const cookie = await signUp(env, 'u@gmail.com')
    assert.equal((await send(env, 'GET', '/api/projects/p_1/nonsense', undefined, cookie)).status, 404)
  })

  it('reorder 不会被 :chapterId 路由吃掉', async () => {
    const env = newEnv()
    const cookie = await signUp(env, 'r@gmail.com')
    const created = await jsonOf<ProjectPayload>(await send(env, 'POST', '/api/projects', { title: 'P' }, cookie))
    const pid = created.data.project.id
    // 若路由顺序写错，reorder 会被当作 chapterId 而返回 405/404
    const response = await send(env, 'POST', `/api/projects/${pid}/chapters/reorder`, { ids: [] }, cookie)
    assert.equal(response.status, 200)
  })
})
