import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  Loader2,
  Plus,
  Save,
  Trash2,
} from 'lucide-react'
import { FadeIn } from '@/components/MotionPrimitives'
import {
  CHAPTER_STATUS_LABELS,
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  PROJECT_TYPE_LABELS,
  useChapter,
  useCreateChapter,
  useDeleteChapter,
  useDeleteProject,
  useProject,
  useReorderChapters,
  useUpdateChapter,
  useUpdateProject,
  type ChapterStatus,
} from '@/hooks/use-projects'

/** 自动保存延迟：足够短以免丢字，足够长以免每敲一个字都发请求。 */
const AUTOSAVE_MS = 1200

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data, isLoading, isError, error } = useProject(id)
  const updateProject = useUpdateProject()
  const createChapter = useCreateChapter(id)
  const deleteChapter = useDeleteChapter(id)
  const deleteProject = useDeleteProject()
  const reorder = useReorderChapters(id)

  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null)

  const project = data?.project
  const chapters = useMemo(() => data?.chapters ?? [], [data])

  /**
   * 当前选中章节用「派生」而不是 effect 同步：
   * 选中项不存在（首次进入、或它被删除）时回退到第一章。
   * 用 effect + setState 同步会多一次渲染，且被 react-hooks/set-state-in-effect 判为反模式。
   */
  const activeChapterId = useMemo(() => {
    if (selectedChapterId && chapters.some((c) => c.id === selectedChapterId)) return selectedChapterId
    return chapters[0]?.id ?? null
  }, [selectedChapterId, chapters])

  if (isLoading) {
    return (
      <main className="page-main">
        <div className="container empty-state">
          <Loader2 size={26} className="spin" />
          <h2>正在打开项目…</h2>
        </div>
      </main>
    )
  }

  if (isError || !project) {
    const unauthorized = error instanceof Error && error.message === 'UNAUTHORIZED'
    return (
      <main className="page-main">
        <div className="container empty-state">
          <AlertCircle size={26} />
          <h2>{unauthorized ? '登录状态已失效' : '项目不存在或无权访问'}</h2>
          <Link className="button button-primary" to={unauthorized ? '/login' : '/projects'}>
            {unauthorized ? '去登录' : '返回项目列表'}
          </Link>
        </div>
      </main>
    )
  }

  const move = (chapterId: string, delta: number) => {
    const ids = chapters.map((c) => c.id)
    const from = ids.indexOf(chapterId)
    const to = from + delta
    if (from < 0 || to < 0 || to >= ids.length) return
    const next = [...ids]
    ;[next[from], next[to]] = [next[to], next[from]]
    reorder.mutate(next)
  }

  return (
    <main className="page-main">
      <nav className="breadcrumb container" aria-label="面包屑">
        <ol>
          <li>
            <Link to="/projects">写作项目</Link>
          </li>
          <li aria-current="page">{project.title}</li>
        </ol>
      </nav>

      <section className="container project-head">
        <FadeIn>
          <span className="eyebrow dark">
            {PROJECT_TYPE_LABELS[project.type]} · {PROJECT_STATUS_LABELS[project.status]}
          </span>
          <h1>{project.title}</h1>
          {project.summary && <p>{project.summary}</p>}
        </FadeIn>

        <FadeIn className="project-head-meta">
          <div className="progress-block">
            <div className="progress-bar large" role="img" aria-label={`字数进度 ${Math.round(project.progress.wordRatio * 100)}%`}>
              <span style={{ width: `${Math.round(project.progress.wordRatio * 100)}%` }} />
            </div>
            <p className="progress-caption">
              {project.progress.words.toLocaleString('zh-CN')}
              {project.target_words > 0 && ` / ${project.target_words.toLocaleString('zh-CN')}`} 字 · 章节{' '}
              {project.progress.doneChapters}/{project.progress.chapterCount} 已完成
            </p>
          </div>

          <div className="project-controls">
            <label className="form-field">
              <span>状态</span>
              <select
                value={project.status}
                onChange={(e) => updateProject.mutate({ id: project.id, patch: { status: e.target.value as never } })}
              >
                {PROJECT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {PROJECT_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>可见性</span>
              <select
                value={project.visibility}
                onChange={(e) => updateProject.mutate({ id: project.id, patch: { visibility: e.target.value as never } })}
              >
                <option value="private">私有</option>
                <option value="public">公开</option>
              </select>
            </label>
            <label className="form-field">
              <span>目标字数</span>
              <input
                type="number"
                min={0}
                defaultValue={project.target_words || ''}
                onBlur={(e) => {
                  const value = Number(e.target.value) || 0
                  if (value !== project.target_words) updateProject.mutate({ id: project.id, patch: { target_words: value } })
                }}
              />
            </label>
          </div>
        </FadeIn>
      </section>

      <section className="container project-workspace">
        <aside className="outline-panel" aria-label="章节大纲">
          <header className="outline-head">
            <h2>大纲</h2>
            <button
              className="icon-button"
              onClick={() => createChapter.mutate({})}
              disabled={createChapter.isPending}
              aria-label="新增章节"
            >
              {createChapter.isPending ? <Loader2 size={15} className="spin" /> : <Plus size={15} />}
            </button>
          </header>

          {chapters.length === 0 ? (
            <p className="outline-empty">还没有章节。先加一章，把想法落下来。</p>
          ) : (
            <ol className="outline-list">
              {chapters.map((chapter, index) => (
                <li key={chapter.id} className={chapter.id === activeChapterId ? 'active' : ''}>
                  <button className="outline-item" onClick={() => setSelectedChapterId(chapter.id)}>
                    <span className="outline-index">{index + 1}</span>
                    <span className="outline-body">
                      <span className="outline-title">{chapter.title}</span>
                      <span className={`chapter-status status-${chapter.status}`}>
                        {CHAPTER_STATUS_LABELS[chapter.status]} · {chapter.words} 字
                      </span>
                    </span>
                    <ChevronRight size={14} aria-hidden="true" />
                  </button>
                  <div className="outline-tools">
                    <button className="icon-button" onClick={() => move(chapter.id, -1)} disabled={index === 0} aria-label="上移">
                      <ArrowUp size={13} />
                    </button>
                    <button
                      className="icon-button"
                      onClick={() => move(chapter.id, 1)}
                      disabled={index === chapters.length - 1}
                      aria-label="下移"
                    >
                      <ArrowDown size={13} />
                    </button>
                    <button
                      className="icon-button danger"
                      onClick={() => {
                        if (window.confirm(`删除章节「${chapter.title}」？`)) deleteChapter.mutate(chapter.id)
                      }}
                      aria-label={`删除章节 ${chapter.title}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </aside>

        <div className="chapter-editor">
          {activeChapterId ? (
            <ChapterEditor key={activeChapterId} chapterId={activeChapterId} />
          ) : (
            <div className="empty-state">
              <p>从左侧选择或新建一个章节开始写作。</p>
            </div>
          )}
        </div>
      </section>

      <div className="container project-foot">
        <button
          className="button button-ghost danger"
          onClick={() => {
            if (window.confirm(`删除项目「${project.title}」及其全部章节？此操作不可撤销。`)) {
              deleteProject.mutate(project.id, { onSuccess: () => navigate('/projects') })
            }
          }}
          disabled={deleteProject.isPending}
        >
          {deleteProject.isPending ? <Loader2 size={15} className="spin" /> : <Trash2 size={15} />} 删除项目
        </button>
      </div>
    </main>
  )
}

/**
 * 章节编辑器：带防抖自动保存。
 *
 * 为什么用自动保存而不是「保存按钮」：写作工具里手动保存是失败来源——
 * 用户会忘记点。这里 1.2s 无输入后自动落盘，并把状态显示出来。
 */
function ChapterEditor({ chapterId }: { chapterId: string }) {
  const { data: chapter, isLoading } = useChapter(chapterId)
  const updateChapter = useUpdateChapter()

  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const loadedRef = useRef<string | null>(null)

  // 载入远端数据（仅在切换章节或首次到达时）
  useEffect(() => {
    if (!chapter) return
    if (loadedRef.current === chapter.id) return
    loadedRef.current = chapter.id
    setTitle(chapter.title)
    setContent(chapter.content)
    setDirty(false)
    setSavedAt(null)
  }, [chapter])

  // 防抖自动保存
  useEffect(() => {
    if (!dirty) return
    const timer = setTimeout(() => {
      updateChapter.mutate(
        { id: chapterId, patch: { title, content } },
        { onSuccess: () => setSavedAt(new Date()) },
      )
      setDirty(false)
    }, AUTOSAVE_MS)
    return () => clearTimeout(timer)
    // updateChapter 是稳定引用，故意不入依赖，避免每次渲染重排定时器
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, title, content, chapterId])

  // Cmd/Ctrl + S 立即保存
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        updateChapter.mutate({ id: chapterId, patch: { title, content } }, { onSuccess: () => setSavedAt(new Date()) })
        setDirty(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [chapterId, title, content, updateChapter])

  if (isLoading || !chapter) {
    return (
      <div className="empty-state">
        <Loader2 size={22} className="spin" />
        <p>正在打开章节…</p>
      </div>
    )
  }

  const saveState = updateChapter.isPending ? '保存中…' : dirty ? '未保存' : savedAt ? `已保存 ${savedAt.toLocaleTimeString('zh-CN')}` : '已同步'

  return (
    <div className="editor-shell">
      <header className="editor-head">
        <input
          className="editor-title"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value)
            setDirty(true)
          }}
          placeholder="章节标题"
          aria-label="章节标题"
        />
        <div className="editor-status">
          <span className={dirty ? 'dirty' : 'saved'}>{saveState}</span>
          <button
            className="button button-outline"
            onClick={() => {
              updateChapter.mutate({ id: chapterId, patch: { title, content } }, { onSuccess: () => setSavedAt(new Date()) })
              setDirty(false)
            }}
          >
            <Save size={15} /> 保存
          </button>
        </div>
      </header>

      <textarea
        className="editor-body"
        value={content}
        onChange={(e) => {
          setContent(e.target.value)
          setDirty(true)
        }}
        placeholder="用 Markdown 写正文…"
        aria-label="章节正文"
      />

      <footer className="editor-foot">
        <span>{countChars(content)} 字</span>
        <div className="editor-status-actions">
          {(['empty', 'drafting', 'done'] as ChapterStatus[]).map((s) => (
            <button
              key={s}
              className={`button button-ghost ${chapter.status === s ? 'is-active' : ''}`}
              onClick={() => updateChapter.mutate({ id: chapterId, patch: { status: s } })}
            >
              {chapter.status === s && <Check size={14} />} {CHAPTER_STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </footer>
    </div>
  )
}

/** 与后端 countWords 保持一致的口径：CJK 按字、拉丁按词。 */
function countChars(text: string): number {
  if (!text) return 0
  const cjk = text.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g)?.length ?? 0
  const latin = text
    .replace(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g, ' ')
    .split(/\s+/)
    .filter((w) => /[a-zA-Z0-9]/.test(w)).length
  return cjk + latin
}
