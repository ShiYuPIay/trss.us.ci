import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, BookOpen, CalendarDays, Loader2, Plus, Target, Trash2 } from 'lucide-react'
import { FadeIn, Stagger } from '@/components/MotionPrimitives'
import {
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  PROJECT_TYPE_LABELS,
  useCreateProject,
  useDeleteProject,
  useProjects,
  useUpdateProject,
  type Project,
  type ProjectStatus,
  type ProjectType,
} from '@/hooks/use-projects'

/**
 * 项目看板 —— 登录后的首页形态。
 *
 * 这一页决定产品是不是「应用」：它回答「我现在该做什么」，
 * 而不是「我写过什么」。所以**不出现按时间倒序的文章列表**。
 */
export default function Projects() {
  const { data: projects = [], isLoading, isError, error, refetch } = useProjects()
  const createProject = useCreateProject()
  const updateProject = useUpdateProject()
  const deleteProject = useDeleteProject()

  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState('')
  const [type, setType] = useState<ProjectType>('longform')
  const [targetWords, setTargetWords] = useState('')

  /** 按状态分组。看板列的顺序即状态机顺序，空列也保留——让流程可见。 */
  const columns = useMemo(() => {
    const map = new Map<ProjectStatus, Project[]>(PROJECT_STATUSES.map((s) => [s, []]))
    for (const project of projects) {
      const bucket = map.get(project.status)
      if (bucket) bucket.push(project)
      else map.get('idea')?.push(project)
    }
    return map
  }, [projects])

  /** 顶部统计：进行中、总字数、章节完成情况。这些是「关于你」的指标，不是内容列表。 */
  const stats = useMemo(() => {
    const active = projects.filter((p) => p.status !== 'published' && p.status !== 'iterating').length
    const words = projects.reduce((sum, p) => sum + p.progress.words, 0)
    const chapters = projects.reduce((sum, p) => sum + p.progress.chapterCount, 0)
    const done = projects.reduce((sum, p) => sum + p.progress.doneChapters, 0)
    return { active, words, chapters, done }
  }, [projects])

  const submit = async () => {
    const name = title.trim()
    if (!name) return
    await createProject.mutateAsync({
      title: name,
      type,
      target_words: Number(targetWords) || 0,
    })
    setTitle('')
    setTargetWords('')
    setType('longform')
    setShowForm(false)
  }

  return (
    <main className="page-main">
      <section className="page-hero container">
        <FadeIn>
          <span className="eyebrow dark">WORKSPACE · 写作工作台</span>
          <h1>我的写作项目</h1>
          <p>把「写一篇长文」当作项目来推进——有状态、有结构、有进度，而不是发完即止。</p>
        </FadeIn>
      </section>

      <section className="container workspace">
        {isError && (
          <div className="cloud-error-strip">
            <span>
              <AlertCircle size={16} /> {error instanceof Error && error.message === 'UNAUTHORIZED' ? '登录状态已失效，请重新登录。' : '项目加载失败。'}
            </span>
            <button onClick={() => refetch()}>重试</button>
          </div>
        )}

        <FadeIn className="workspace-stats">
          <div className="stat-cell">
            <span className="stat-label">进行中</span>
            <strong className="stat-value">{stats.active}</strong>
          </div>
          <div className="stat-cell">
            <span className="stat-label">累计字数</span>
            <strong className="stat-value">{stats.words.toLocaleString('zh-CN')}</strong>
          </div>
          <div className="stat-cell">
            <span className="stat-label">章节完成</span>
            <strong className="stat-value">
              {stats.done}
              <small> / {stats.chapters}</small>
            </strong>
          </div>
          <div className="stat-cell stat-action">
            <button className="button button-primary" onClick={() => setShowForm((v) => !v)}>
              <Plus size={16} /> 新建项目
            </button>
          </div>
        </FadeIn>

        {showForm && (
          <FadeIn className="project-form glass-light">
            <div className="form-row">
              <label className="form-field grow">
                <span>项目标题</span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="例如：一篇关于城市散步的长文"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void submit()
                  }}
                />
              </label>
              <label className="form-field">
                <span>形态</span>
                <select value={type} onChange={(e) => setType(e.target.value as ProjectType)}>
                  {(['longform', 'series', 'booklet'] as ProjectType[]).map((t) => (
                    <option key={t} value={t}>
                      {PROJECT_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span>目标字数</span>
                <input
                  value={targetWords}
                  onChange={(e) => setTargetWords(e.target.value.replace(/\D/g, ''))}
                  placeholder="可留空"
                  inputMode="numeric"
                />
              </label>
            </div>
            <div className="form-actions">
              <button className="button button-primary" onClick={() => void submit()} disabled={!title.trim() || createProject.isPending}>
                {createProject.isPending ? <Loader2 size={16} className="spin" /> : <Plus size={16} />} 创建
              </button>
              <button className="button button-ghost" onClick={() => setShowForm(false)}>
                取消
              </button>
              {createProject.isError && <span className="form-error">{(createProject.error as Error).message}</span>}
            </div>
          </FadeIn>
        )}

        {isLoading ? (
          <div className="empty-state">
            <Loader2 size={26} className="spin" />
            <h2>正在读取你的项目…</h2>
          </div>
        ) : projects.length === 0 ? (
          <FadeIn className="empty-state">
            <BookOpen size={28} />
            <h2>还没有写作项目</h2>
            <p>项目是这里的第一公民——先建一个，把它从构思推进到发布。</p>
            <button className="button button-primary" onClick={() => setShowForm(true)}>
              <Plus size={16} /> 创建第一个项目
            </button>
          </FadeIn>
        ) : (
          <div className="board">
            {PROJECT_STATUSES.map((status) => {
              const items = columns.get(status) ?? []
              return (
                <section className="board-column" key={status} aria-label={PROJECT_STATUS_LABELS[status]}>
                  <header className="board-column-head">
                    <span className={`board-dot status-${status}`} aria-hidden="true" />
                    <h2>{PROJECT_STATUS_LABELS[status]}</h2>
                    <span className="board-count">{items.length}</span>
                  </header>
                  <Stagger className="board-cards">
                    {items.map((project) => (
                      <ProjectCard
                        key={project.id}
                        project={project}
                        onAdvance={(next) => updateProject.mutate({ id: project.id, patch: { status: next } })}
                        onDelete={() => {
                          if (window.confirm(`删除项目「${project.title}」及其全部章节？此操作不可撤销。`)) {
                            deleteProject.mutate(project.id)
                          }
                        }}
                      />
                    ))}
                    {items.length === 0 && <p className="board-empty">暂无</p>}
                  </Stagger>
                </section>
              )
            })}
          </div>
        )}
      </section>
    </main>
  )
}

/** 项目卡片：进度是主角，不是封面图。 */
function ProjectCard({
  project,
  onAdvance,
  onDelete,
}: {
  project: Project
  onAdvance: (next: ProjectStatus) => void
  onDelete: () => void
}) {
  const ratio = project.progress.wordRatio
  const index = PROJECT_STATUSES.indexOf(project.status)
  const next = index >= 0 && index < PROJECT_STATUSES.length - 1 ? PROJECT_STATUSES[index + 1] : null

  return (
    <article className="project-card">
      <div className="project-card-head">
        <span className={`project-type type-${project.type}`}>{PROJECT_TYPE_LABELS[project.type]}</span>
        {project.visibility === 'public' && <span className="project-badge">公开</span>}
      </div>

      <h3 className="project-card-title">
        <Link to={`/projects/${project.id}`}>{project.title}</Link>
      </h3>

      {project.summary && <p className="project-card-summary">{project.summary}</p>}

      <div className="progress-bar" role="img" aria-label={`字数进度 ${Math.round(ratio * 100)}%`}>
        <span style={{ width: `${Math.round(ratio * 100)}%` }} />
      </div>

      <dl className="project-meta">
        <div>
          <dt>
            <Target size={13} /> 字数
          </dt>
          <dd>
            {project.progress.words.toLocaleString('zh-CN')}
            {project.target_words > 0 && <small> / {project.target_words.toLocaleString('zh-CN')}</small>}
          </dd>
        </div>
        <div>
          <dt>章节</dt>
          <dd>
            {project.progress.doneChapters} / {project.progress.chapterCount}
          </dd>
        </div>
        {project.due_date && (
          <div>
            <dt>
              <CalendarDays size={13} /> 截止
            </dt>
            <dd>{project.due_date}</dd>
          </div>
        )}
      </dl>

      <div className="project-card-actions">
        <Link className="button button-outline" to={`/projects/${project.id}`}>
          打开
        </Link>
        {next && (
          <button className="button button-ghost" onClick={() => onAdvance(next)} title={`推进到「${PROJECT_STATUS_LABELS[next]}」`}>
            → {PROJECT_STATUS_LABELS[next]}
          </button>
        )}
        <button className="icon-button danger" onClick={onDelete} aria-label={`删除项目 ${project.title}`}>
          <Trash2 size={15} />
        </button>
      </div>
    </article>
  )
}
