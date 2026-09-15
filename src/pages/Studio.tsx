import { useState, type FormEvent } from 'react'
import { FileUp, ImagePlus, Save } from 'lucide-react'
import { toast } from 'sonner'
import { FadeIn } from '@/components/MotionPrimitives'
import { MarkdownContent } from '@/components/blog/MarkdownContent'
import { createArticle } from '@/hooks/use-articles'
import { uploadAsset } from '@/lib/uploads'
import type { ArticleAttachment } from '@/types/article'

export default function Studio() {
  const [title, setTitle] = useState('')
  const [excerpt, setExcerpt] = useState('')
  const [tags, setTags] = useState('')
  const [content, setContent] = useState('# 从这里开始\n\n写下你的第一段内容……')
  const [cover, setCover] = useState('')
  const [coverPreview, setCoverPreview] = useState('')
  const [attachments, setAttachments] = useState<ArticleAttachment[]>([])
  const [saving, setSaving] = useState(false)

  const upload = async (file: File, asCover = false) => {
    try {
      const asset = await uploadAsset(file)
      // previewUrl 为 /api/media/<id>，可直接渲染；storageId（kv://<id>）仅用于溯源。
      if (asCover) { setCover(asset.previewUrl); setCoverPreview(asset.previewUrl) }
      else setAttachments((items) => [...items, { name: asset.name, url: asset.previewUrl, size: asset.size, type: asset.type }])
      toast.success(asCover ? '封面已上传' : '附件已上传')
    } catch (error) { toast.error(error instanceof Error ? error.message : '上传失败') }
  }

  const submit = async (event: FormEvent, status: 'draft' | 'published') => {
    event.preventDefault()
    if (!title.trim()) return toast.error('请先填写文章标题')
    const normalizedSlug = title.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    const slug = normalizedSlug || `article-${new Date().getTime()}`
    setSaving(true)
    try {
      await createArticle({ slug, title, excerpt, content, cover_url: cover, tags: tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean), status, featured: false, author: 'huiyiziyuan', reading_time: `${Math.max(1, Math.ceil(content.length / 500))} 分钟阅读`, attachments, published_at: new Date().toISOString().slice(0, 10) })
      toast.success(status === 'published' ? '文章已发布' : '草稿已保存')
    } catch (error) { toast.error(error instanceof Error ? error.message : '保存失败') }
    finally { setSaving(false) }
  }

  return (
    <main className="page-main studio-page">
      <section className="container studio-heading"><FadeIn><span className="eyebrow dark">CREATOR STUDIO</span><h1>写作工作台</h1><p>在左侧编辑 Markdown，右侧会同步呈现最终阅读效果。</p></FadeIn></section>
      <form className="container studio-layout">
        <FadeIn className="editor-panel">
          <div className="editor-fields"><label><span>文章标题</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="给这篇文章一个好标题" /></label><label><span>文章摘要</span><textarea value={excerpt} onChange={(event) => setExcerpt(event.target.value)} placeholder="用一两句话概括文章" /></label><label><span>标签</span><input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="旅行, 随笔, 摄影" /></label><label><span>Markdown 正文</span><textarea className="markdown-editor" value={content} onChange={(event) => setContent(event.target.value)} /></label></div>
          <div className="upload-row"><label className="upload-button"><ImagePlus size={18} />上传封面<input type="file" accept="image/*" onChange={(event) => event.target.files?.[0] && upload(event.target.files[0], true)} /></label><label className="upload-button"><FileUp size={18} />添加附件<input type="file" onChange={(event) => event.target.files?.[0] && upload(event.target.files[0])} /></label></div>
          {cover && <div className="upload-success">封面已就绪</div>}{attachments.map((file) => <div key={file.url} className="upload-success">附件：{file.name}</div>)}
          <div className="studio-actions"><button type="button" className="button button-outline" disabled={saving} onClick={(event) => submit(event, 'draft')}><Save size={17} />保存草稿</button><button type="button" className="button button-primary" disabled={saving} onClick={(event) => submit(event, 'published')}>{saving ? '保存中…' : '发布文章'}</button></div>
        </FadeIn>
        <FadeIn className="preview-panel" delay={0.08}><span className="preview-label">实时预览</span>{coverPreview && <img src={coverPreview} alt="文章封面预览" className="preview-cover" />}<h1>{title || '文章标题'}</h1><p className="preview-excerpt">{excerpt || '文章摘要会显示在这里。'}</p><MarkdownContent content={content} /></FadeIn>
      </form>
    </main>
  )
}
