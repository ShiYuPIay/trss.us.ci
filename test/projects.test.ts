import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AppEnv } from '../worker/types.ts'
import { MemoryKV } from './kv-mock.ts'
import {
  computeProgress,
  countWords,
  createChapter,
  createProject,
  deleteChapter,
  deleteProject,
  getChapter,
  getProject,
  listChapterIndex,
  listUserProjectIds,
  reorderChapters,
  updateChapter,
  updateProject,
} from '../worker/lib/projects.ts'

function makeEnv(): AppEnv {
  return {
    AUTH_KV: new MemoryKV(),
    SITE_KV: new MemoryKV(),
    BLOCKLIST_KV: new MemoryKV(),
  } as AppEnv
}

describe('countWords', () => {
  it('中文按字计', () => {
    assert.equal(countWords('沿着云的方向'), 6)
  })

  it('英文按词计', () => {
    assert.equal(countWords('walking through the clouds'), 4)
  })

  it('中英混排分别统计', () => {
    // 3 个汉字（清/晨/点）+ 2 个英文词（five/thirty）
    assert.equal(countWords('清晨 five 点 thirty'), 3 + 2)
  })

  it('标点与空白不计入', () => {
    assert.equal(countWords('，。！？ \n\t'), 0)
  })

  it('空串为 0', () => {
    assert.equal(countWords(''), 0)
  })
})

describe('项目：创建与默认值', () => {
  it('默认私有、状态为构思、形态为长文', async () => {
    const env = makeEnv()
    const project = await createProject(env, 'u_1', { title: '  我的第一本书  ' })
    assert.equal(project.title, '我的第一本书', '标题应 trim')
    assert.equal(project.visibility, 'private', '默认必须私有')
    assert.equal(project.status, 'idea')
    assert.equal(project.type, 'longform')
    assert.equal(project.version, 0)
    assert.equal(project.published_at, '')
  })

  it('无标题时给出占位名而不是空串', async () => {
    const env = makeEnv()
    const project = await createProject(env, 'u_1', {})
    assert.equal(project.title, '未命名项目')
  })

  it('非法 type / target_words 被规整', async () => {
    const env = makeEnv()
    const project = await createProject(env, 'u_1', {
      type: 'nonsense' as never,
      target_words: -50,
    })
    assert.equal(project.type, 'longform')
    assert.equal(project.target_words, 0)
  })

  it('创建后出现在该用户的项目索引里，且最新的在前', async () => {
    const env = makeEnv()
    const a = await createProject(env, 'u_1', { title: 'A' })
    const b = await createProject(env, 'u_1', { title: 'B' })
    const ids = await listUserProjectIds(env, 'u_1')
    assert.deepEqual(ids, [b.id, a.id])
  })

  it('不同用户的项目互不可见', async () => {
    const env = makeEnv()
    await createProject(env, 'u_1', { title: 'A' })
    await createProject(env, 'u_2', { title: 'B' })
    assert.equal((await listUserProjectIds(env, 'u_1')).length, 1)
    assert.equal((await listUserProjectIds(env, 'u_2')).length, 1)
  })
})

describe('章节：创建、更新与字数', () => {
  it('首个章节默认标题为「第 1 章」，后续递增', async () => {
    const env = makeEnv()
    const project = await createProject(env, 'u_1', { title: 'P' })
    const c1 = await createChapter(env, project)
    const c2 = await createChapter(env, project)
    assert.equal(c1.title, '第 1 章')
    assert.equal(c2.title, '第 2 章')
  })

  it('空章节状态为 empty，带正文则为 drafting', async () => {
    const env = makeEnv()
    const project = await createProject(env, 'u_1', { title: 'P' })
    assert.equal((await createChapter(env, project)).status, 'empty')
    assert.equal((await createChapter(env, project, { content: '有内容' })).status, 'drafting')
  })

  it('写入正文后索引里的字数同步更新', async () => {
    const env = makeEnv()
    const project = await createProject(env, 'u_1', { title: 'P' })
    const chapter = await createChapter(env, project)
    await updateChapter(env, chapter, { content: '一二三四五' })
    const index = await listChapterIndex(env, project.id)
    assert.equal(index[0].words, 5)
  })

  it('正文从空变为非空时，状态自动从 empty 推进到 drafting', async () => {
    const env = makeEnv()
    const project = await createProject(env, 'u_1', { title: 'P' })
    const chapter = await createChapter(env, project)
    assert.equal(chapter.status, 'empty')
    const updated = await updateChapter(env, chapter, { content: '开始写了' })
    assert.equal(updated.status, 'drafting')
  })

  it('显式指定的状态不被自动推进覆盖', async () => {
    const env = makeEnv()
    const project = await createProject(env, 'u_1', { title: 'P' })
    const chapter = await createChapter(env, project)
    const updated = await updateChapter(env, chapter, { content: '写了', status: 'done' })
    assert.equal(updated.status, 'done')
  })

  it('删除章节后索引中不再包含它', async () => {
    const env = makeEnv()
    const project = await createProject(env, 'u_1', { title: 'P' })
    const a = await createChapter(env, project)
    const b = await createChapter(env, project)
    await deleteChapter(env, a)
    const index = await listChapterIndex(env, project.id)
    assert.equal(index.length, 1)
    assert.equal(index[0].id, b.id)
    assert.equal(await getChapter(env, a.id), null, '章节对象应已删除')
  })

  it('重排后顺序按传入 id 排列，未提及的保持在后', async () => {
    const env = makeEnv()
    const project = await createProject(env, 'u_1', { title: 'P' })
    const a = await createChapter(env, project, { title: 'A' })
    const b = await createChapter(env, project, { title: 'B' })
    const c = await createChapter(env, project, { title: 'C' })
    const reordered = await reorderChapters(env, project.id, [c.id, a.id])
    assert.deepEqual(
      reordered.map((e) => e.title),
      ['C', 'A', 'B'],
    )
    assert.equal(b.id, reordered[2].id)
  })
})

describe('进度计算', () => {
  it('未设目标时 wordRatio 为 0，不产生 NaN', async () => {
    const env = makeEnv()
    const project = await createProject(env, 'u_1', { title: 'P' })
    const chapter = await createChapter(env, project, { content: '一二三' })
    const index = await listChapterIndex(env, project.id)
    const progress = computeProgress(project, index)
    assert.equal(progress.words, 3)
    assert.equal(progress.wordRatio, 0)
    assert.equal(progress.chapterCount, 1)
    assert.equal(chapter.status, 'drafting')
  })

  it('设了目标时按比例计算且不超过 1', async () => {
    const env = makeEnv()
    const project = await createProject(env, 'u_1', { title: 'P', target_words: 4 })
    await createChapter(env, project, { content: '一二三四五六七八' })
    const index = await listChapterIndex(env, project.id)
    const progress = computeProgress(project, index)
    assert.equal(progress.words, 8)
    assert.equal(progress.wordRatio, 1, '超额完成应封顶为 1')
  })

  it('章节完成率按 done 统计', async () => {
    const env = makeEnv()
    const project = await createProject(env, 'u_1', { title: 'P' })
    // createChapter 不接受 status（状态由是否有正文推导），故建好后再标记完成
    const a = await createChapter(env, project, { content: 'a' })
    await updateChapter(env, a, { status: 'done' })
    await createChapter(env, project, { content: 'b' })
    const index = await listChapterIndex(env, project.id)
    const progress = computeProgress(project, index)
    assert.equal(progress.chapterCount, 2)
    assert.equal(progress.doneChapters, 1)
    assert.equal(progress.chapterRatio, 0.5)
  })
})

describe('更新与删除', () => {
  it('更新项目字段并刷新 updated_at', async () => {
    const env = makeEnv()
    const project = await createProject(env, 'u_1', { title: 'P' })
    const updated = await updateProject(env, project, {
      title: '改名了',
      status: 'drafting',
      visibility: 'public',
      target_words: 1000,
    })
    assert.equal(updated.title, '改名了')
    assert.equal(updated.status, 'drafting')
    assert.equal(updated.visibility, 'public')
    assert.equal(updated.target_words, 1000)
    assert.ok(updated.updated_at >= project.updated_at)
  })

  it('状态可以回退（已发布 → 迭代中）', async () => {
    const env = makeEnv()
    const project = await createProject(env, 'u_1', { title: 'P' })
    const published = await updateProject(env, project, { status: 'published' })
    const iterating = await updateProject(env, published, { status: 'iterating' })
    assert.equal(iterating.status, 'iterating', '状态机必须可回退，这是与博客的关键差别')
  })

  it('非法状态被忽略而不是写入', async () => {
    const env = makeEnv()
    const project = await createProject(env, 'u_1', { title: 'P' })
    const updated = await updateProject(env, project, { status: 'nonsense' as never })
    assert.equal(updated.status, 'idea')
  })

  it('删除项目会级联删除其全部章节', async () => {
    const env = makeEnv()
    const project = await createProject(env, 'u_1', { title: 'P' })
    const a = await createChapter(env, project, { content: 'x' })
    const b = await createChapter(env, project, { content: 'y' })
    await deleteProject(env, project)

    assert.equal(await getProject(env, project.id), null)
    assert.equal(await getChapter(env, a.id), null)
    assert.equal(await getChapter(env, b.id), null)
    assert.deepEqual(await listUserProjectIds(env, 'u_1'), [])
    assert.deepEqual(await listChapterIndex(env, project.id), [])
  })
})

describe('索引缺失时可重建', () => {
  it('章节索引被清掉后能按项目前缀重建', async () => {
    const env = makeEnv()
    const project = await createProject(env, 'u_1', { title: 'P' })
    await createChapter(env, project, { title: 'A', content: '一二三' })
    await createChapter(env, project, { title: 'B' })

    // 模拟索引键丢失（KV 的键可能因任何原因缺失）
    await env.SITE_KV.delete(`project:chapters:${project.id}`)

    const rebuilt = await listChapterIndex(env, project.id)
    assert.equal(rebuilt.length, 2)
    assert.deepEqual(
      rebuilt.map((e) => e.title).sort(),
      ['A', 'B'],
    )
    assert.equal(rebuilt.find((e) => e.title === 'A')?.words, 3)
  })

  it('用户项目索引被清掉后能重建', async () => {
    const env = makeEnv()
    const project = await createProject(env, 'u_1', { title: 'P' })
    await env.SITE_KV.delete('user:projects:u_1')
    const ids = await listUserProjectIds(env, 'u_1')
    assert.deepEqual(ids, [project.id])
  })

  it('重建时不会把 project:chapters: 前缀的键误当成项目', async () => {
    const env = makeEnv()
    const project = await createProject(env, 'u_1', { title: 'P' })
    await createChapter(env, project, { content: 'x' })

    await env.SITE_KV.delete('projects:index')
    await env.SITE_KV.delete('user:projects:u_1')

    const ids = await listUserProjectIds(env, 'u_1')
    assert.equal(ids.length, 1, 'project:chapters:<id> 不应被识别为项目')
    assert.equal(ids[0], project.id)
  })
})
