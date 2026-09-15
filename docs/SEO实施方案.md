# 深度 SEO 实施方案（七维度 · 含示例代码）

> 配套文档：`SEO优化方案.md` 记录了**实测取证与架构决策**（九项缺陷、边缘预渲染方案、浏览器分层结论）。
> 本文档是它的**实施层**：逐维度给出「现状 → 问题 → 改法 → 示例代码」，并单列兼容性与抓取的要点 / 限制 / 应对。
> 全部现状数据来自对 `dist/` 产物与运行中服务的实测，取证脚本见 `.scratch/probe-*.mjs`。

---

## 0. 实测现状总览

先给结论：**这个站的 URL 与内链质量已经不错，问题集中在「内容拿不到」与「图片太重」。**

| 维度 | 实测结果 | 判定 |
| --- | --- | --- |
| 页面结构 | 每页 h1 唯一 ✅；但首页 h1 是**轮播文章标题，约每 5s 变一次** ❌；`/articles` 有 h1→h3 层级跳跃 ❌ | 需修 |
| 语义化标签 | `<article>` **0 处** ❌；`<time>` **0 处**，而全站有 **17 处**纯文本日期 ❌；`<header>/<nav>/<main>/<section>/<aside>/<footer>` 已用 ✅；图片 alt **17/17** ✅ | 需修 |
| 元数据 | 全站共用同一 title（`document.title` 零命中）；canonical / og / twitter 全缺 ❌ | 需修 |
| 结构化数据 | 仅一处静态 `Blog` 节点，与页面无关 ❌ | 需修 |
| 加载性能 | 首页 **LCP 3368–4120ms（需改进～poor）** ❌；6 张外部图 **1900 KB**，最大单张 613 KB ❌；**CLS 0** ✅ | 需修 |
| URL | slug 全部语义化小写连字符（6/6）✅ | 良好 |
| 内链 | 空锚文本 0、无信息量锚文本 0、孤立页 **0/10** ✅；每页内链 9–36 条 ✅ | 良好 |
| 可访问性 | 键盘可达 / 聚焦可见 / 悬停反馈均 **0 缺陷**（前次审计）✅；但**无 skip link** ❌、**路由切换不更新 title 也不移焦点** ❌ | 需修 |

---

## 1. 页面结构优化

### 1.1 问题一：首页 h1 是轮播文章标题，且每 5 秒变一次

实测（首页连续采样 8 次，间隔 1.2s）：

```
第1–4 次  h1 = "沿着云的方向，重新理解远方"
第5–8 次  h1 = "建立一套不会半途而废的写作系统"
```

三重危害：

1. **不稳定**：爬虫在任意时刻快照，记录到的 h1 是随机的
2. **关键词蚕食**：首页 h1 与文章详情页的 h1 完全相同，两个页面争夺同一关键词，搜索引擎无法判断哪个更权威
3. **同页重复**：同一个标题在首页既是 `h1` 又是 `h3`（文章卡片），页内自我竞争

**改法**：h1 只用于**页面级主题**，轮播标题降为 `h2` 或用非标题元素。

```tsx
// components/blog/HeroSlider.tsx —— 轮播标题不再是 h1
// 轮播是「首页的一个区块」，不是「首页的主题」。
// 首页 h1 由页面自己给出（见下），这里降为 h2。
<h2 className="hero-title">
  <BlurText text={slide.title} />
</h2>
```

```tsx
// pages/Index.tsx —— 首页给出稳定的、描述站点主题的 h1
// 注意：h1 必须对爬虫稳定。不要用轮播内容、不要用「最新文章标题」。
<main>
  <h1 className="visually-hidden">huiyiziyuan｜记录、分享与生长的个人内容空间</h1>
  <HeroSlider articles={...} />
  ...
</main>
```

> `visually-hidden` 是**视觉隐藏但对读屏与爬虫可见**的写法，不是 `display: none`（后者会被爬虫忽略）。

```css
/* 视觉隐藏但对辅助技术与爬虫可见。
   不要用 display:none / visibility:hidden —— 那些会被搜索引擎当作不存在。 */
.visually-hidden {
  position: absolute;
  width: 1px; height: 1px;
  margin: -1px; padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
```

### 1.2 问题二：`/articles` 标题层级跳跃

实测标题序列：`h1「所有文章」→ h3「文章标题」→ h3 → …`，**缺 h2**。

**改法**：要么给卡片标题降为 h2，要么给列表加一个 h2 分组标题。后者更符合语义（列表是「全部文章」这个区块的内容）。

```tsx
// pages/Articles.tsx
<main className="page-main">
  <h1>所有文章</h1>
  <p className="page-lead">在旅行、设计、阅读与生活之间，收集值得被认真记住的片段。</p>

  {/* 加一层 h2 作为区块标题，消除 h1→h3 的跳跃 */}
  <section aria-labelledby="archive-list">
    <h2 id="archive-list" className="visually-hidden">文章列表</h2>
    <div className="article-grid">
      {articles.map((a) => <ArticleCard key={a.slug} article={a} />)}
    </div>
  </section>
</main>
```

### 1.3 内容优先的 DOM 顺序

CSS 可以让侧栏「看起来」在右侧，但 DOM 顺序决定爬虫读到正文的先后。**正文必须在 DOM 中先于侧栏出现**。

```tsx
// ✅ 正确：正文在前，侧栏在后
<div className="detail-layout">
  <article className="detail-main">{/* 正文 */}</article>
  <aside className="detail-sidebar">{/* 相关文章、作者卡 */}</aside>
</div>
```

若视觉上需要侧栏在左，用 `order` 或 `grid-area` 调整，**不要为此调换 DOM**。

---

## 2. 语义化标签

### 2.1 问题：`<article>` 完全未使用（0 处）

对一个博客站，`<article>` 是最核心的语义元素——它告诉搜索引擎「这是一篇独立、可独立分发的内容」。当前文章卡片与详情页正文都只是 `div`。

**改法**：

```tsx
// components/blog/ArticleCard.tsx —— 卡片用 <article>，日期用 <time>，封面用 <figure>
export function ArticleCard({ article }: { article: Article }) {
  return (
    <article className="article-card">
      <figure className="article-cover-wrap">
        <img
          src={coverUrl(article.cover_url, 640)}
          alt={article.title}
          width={640}
          height={400}
          loading="lazy"
          decoding="async"
        />
      </figure>

      <div className="article-card-body">
        <h3 className="article-card-title">
          <Link to={`/articles/${article.slug}`}>{article.title}</Link>
        </h3>
        <p className="article-card-excerpt">{article.excerpt}</p>

        {/* <time datetime> 让日期机器可读。display 用人类可读格式，datetime 用 ISO 8601 */}
        <div className="article-card-meta">
          <time dateTime={article.published_at}>{formatDate(article.published_at)}</time>
          <span>{article.reading_time}</span>
        </div>
      </div>
    </article>
  )
}
```

```tsx
// pages/ArticleDetail.tsx —— 正文用 <article>，作者用 <address>，时间用 <time>
<main className="page-main">
  <nav aria-label="面包屑" className="breadcrumb">
    <ol>
      <li><Link to="/">首页</Link></li>
      <li><Link to="/articles">文章</Link></li>
      <li aria-current="page">{article.title}</li>
    </ol>
  </nav>

  <article className="article-detail">
    <header className="detail-head">
      <h1>{article.title}</h1>
      <p className="article-lead">{article.excerpt}</p>

      <div className="detail-author-row">
        {/* <address> 的语义是「联系信息」，用于作者署名是正确的 */}
        <address className="detail-author">
          <span>{article.author}</span>
        </address>
        <time dateTime={article.published_at}>{formatDate(article.published_at)}</time>
        <span>{article.reading_time}</span>
      </div>
    </header>

    <figure className="detail-cover">
      <img src={coverUrl(article.cover_url, 1280)} alt={article.title} width={1280} height={696} decoding="async" />
      <figcaption>{article.title} 封面</figcaption>
    </figure>

    <div className="prose-blog">{/* 正文 */}</div>
  </article>

  <aside className="detail-sidebar" aria-label="相关文章">
    <h2>继续阅读</h2>
    {/* … */}
  </aside>
</main>
```

### 2.2 问题：`<time>` 零使用，17 处日期是纯文本

实测：首页 7 处、列表页 6 处、详情页 4 处形如 `2026-09-14` 的纯文本日期，**没有一处用 `<time>` 标注**。

`<time datetime="...">` 的价值：让搜索引擎与辅助技术拿到**机器可读**的时间（用于判断时效性、生成富摘要）。显示格式与 `datetime` 可以不同：

```tsx
// 显示「2026年9月14日」，机器读 2026-09-14
<time dateTime="2026-09-14">2026年9月14日</time>

// 带时间与时区（更严谨）
<time dateTime="2026-09-14T07:18:21+08:00">2026年9月14日</time>
```

工具函数（避免各处手写格式）：

```ts
// lib/format.ts
/** 把记录里的日期字符串规整为 ISO 8601，供 <time datetime> 使用 */
export function toDateTime(value?: string): string | undefined {
  if (!value) return undefined
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

/** 人类可读格式，用于 <time> 的可见文本 */
export function formatDate(value?: string): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}
```

> **注意**：`datetime` 缺失时 `<time>` 退化为普通 `<span>`，等于白写。必须两个都写。

### 2.3 已有的正确实践（保持）

- 图片 `alt`：实测 **17/17 全覆盖** ✅
- 表单 label：用「label 包裹 input」的隐式关联，符合规范 ✅（不强制 `htmlFor`）
- 站点框架：`<header>/<nav>/<main>/<section>/<aside>/<footer>` 均已使用 ✅
- `<html lang="zh-CN">` ✅

---

## 3. 元数据与结构化数据

### 3.1 现状

- `index.html` 硬编码**一个** title/description，全站共用
- `grep -rn "document.title" src/` **零命中** → 客户端也不更新
- canonical / `og:*` / `twitter:*` 全部缺失
- 仅一处静态 `Blog` JSON-LD

### 3.2 title 与 description 规范

| 项 | 规范 | 理由 |
| --- | --- | --- |
| title 长度 | 中文 **15–30 字**（约 30–60 字符） | 超出会被 SERP 截断 |
| title 结构 | `页面主题｜站点名` | 品牌后置，主题前置 |
| description | 中文 **60–120 字** | 太短无信息量，太长被截断 |
| description 内容 | 页面真实摘要，不是关键词堆砌 | 堆砌会被判低质 |

各路由模板：

| 路由 | title | description 来源 |
| --- | --- | --- |
| `/` | `huiyiziyuan｜记录、分享与生长` | 站点定位 |
| `/articles` | `全部文章｜huiyiziyuan` | 归档页说明 |
| `/articles/:slug` | `{title}｜huiyiziyuan` | `article.excerpt` |
| `/tags` | `标签分类｜huiyiziyuan` | 标签页说明 |
| `/about` | `关于我｜huiyiziyuan` | 关于页说明 |

### 3.3 边缘注入（Worker + HTMLRewriter）

**不要用正则改 HTML 字符串**——容易破坏标签、产生重复 `<title>`。用 Workers 内置的 `HTMLRewriter`（零依赖）：

```ts
// worker/seo/inject.ts
export interface PageMeta {
  title: string
  description: string
  canonical: string
  ogType?: 'website' | 'article'
  ogImage?: string
  publishedTime?: string
  modifiedTime?: string
  noindex?: boolean
  jsonLd?: unknown[]
}

/**
 * 用 HTMLRewriter 改写外壳 HTML 的 <head>。
 * 选择器会命中已存在的标签，先清空再写入 —— 避免出现两个 <title>。
 */
export function injectMeta(response: Response, meta: PageMeta): Response {
  const head = meta.jsonLd?.length
    ? `<script type="application/ld+json">${JSON.stringify(meta.jsonLd.length === 1 ? meta.jsonLd[0] : meta.jsonLd)}</script>`
    : ''

  const tags = [
    `<title>${escapeHtml(meta.title)}</title>`,
    `<meta name="description" content="${escapeAttr(meta.description)}" />`,
    `<link rel="canonical" href="${escapeAttr(meta.canonical)}" />`,
    meta.noindex ? '<meta name="robots" content="noindex, follow" />' : '',
    `<meta property="og:type" content="${meta.ogType || 'website'}" />`,
    `<meta property="og:title" content="${escapeAttr(meta.title)}" />`,
    `<meta property="og:description" content="${escapeAttr(meta.description)}" />`,
    `<meta property="og:url" content="${escapeAttr(meta.canonical)}" />`,
    `<meta property="og:site_name" content="huiyiziyuan" />`,
    meta.ogImage ? `<meta property="og:image" content="${escapeAttr(meta.ogImage)}" />` : '',
    meta.ogImage ? '<meta name="twitter:card" content="summary_large_image" />' : '<meta name="twitter:card" content="summary" />',
    meta.publishedTime ? `<meta property="article:published_time" content="${meta.publishedTime}" />` : '',
    meta.modifiedTime ? `<meta property="article:modified_time" content="${meta.modifiedTime}" />` : '',
    head,
  ]
    .filter(Boolean)
    .join('\n    ')

  return new HTMLRewriter()
    .on('title', { element: (el) => el.remove() })
    .on('meta[name="description"]', { element: (el) => el.remove() })
    .on('link[rel="canonical"]', { element: (el) => el.remove() })
    .on('head', {
      element: (el) => {
        el.append(tags, { html: true })
      },
    })
    .transform(response)
}

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
```

> **`HTMLRewriter` 不可用时**（如本地纯静态托管）的兜底：`response.text()` 后用 DOM 无关的字符串替换，但**必须先删除原有标签**，否则会出现两个 `<title>`（爬虫取第一个，你的注入等于无效）。

### 3.4 结构化数据

**文章页 `BlogPosting`**：

```ts
// worker/seo/jsonld.ts
export function articleJsonLd(a: ArticleRecord, baseUrl: string) {
  const url = `${baseUrl}/articles/${a.slug}`
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: a.title,
    description: a.excerpt,
    image: a.cover_url ? (a.cover_url.startsWith('/') ? baseUrl + a.cover_url : a.cover_url) : undefined,
    datePublished: toDateTime(a.published_at || a.created_at),
    dateModified: toDateTime(a.updated_at || a.published_at),
    author: { '@type': 'Person', name: a.author || 'huiyiziyuan' },
    publisher: { '@type': 'Organization', name: 'huiyiziyuan' },
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    inLanguage: 'zh-CN',
    url,
  }
}
```

**面包屑 `BreadcrumbList`**（Google 会据此改写 SERP 中的 URL 展示）：

```ts
export function breadcrumbJsonLd(items: { name: string; url: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: it.url,
    })),
  }
}
```

**站点级 `WebSite`**（首页，帮助建立站点实体）：

```ts
export function websiteJsonLd(baseUrl: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'huiyiziyuan',
    url: baseUrl,
    inLanguage: 'zh-CN',
    // 若将来做站内搜索，补 SearchAction 可让 Google 显示站内搜索框
    // potentialAction: { '@type': 'SearchAction', target: `${baseUrl}/articles?q={query}`, 'query-input': 'required name=query' },
  }
}
```

**要点**：
- `image` 与 `canonical` 必须是**绝对 URL**，否则富媒体结果不生效
- 一个页面**一个主实体**，不要堆不相关节点
- `dateModified` 不要伪造——频繁无意义更新会降低可信度

---

## 4. 页面加载性能

### 4.1 实测数据

| 指标 | 首页 | 文章详情页 | 阈值 |
| --- | --- | --- | --- |
| FCP | 1016 ms | 240 ms | 良好 < 1800 ms |
| **LCP** | **3368–4120 ms**（两次实测，见下） | 1912 ms | 良好 < 2500 ms，**≥ 4000 ms 为 poor** |
| **CLS** | **0** ✅ | **0** ✅ | 良好 < 0.1 |
| DOMContentLoaded | 872 ms | 94 ms | — |
| 图片请求 | 6 个 | 1 个 | — |
| **图片解码体积** | **1900 KB** | 407 KB | — |
| 最大单张 | **613 KB** | 407 KB | — |

> **LCP 是区间而非定值**：同一台机器上两次实测分别得到 **4120 ms** 与 **3368 ms**。
> 原因是首页 LCP 元素是**外部 Unsplash 图片**，其响应时间受公网波动影响。
> 两次都落在「需改进 / poor」区间，**结论不变**；但引用时不要写成单一数值。
> 这也从侧面说明外部图床既是性能问题也是**测量稳定性问题**——迁到自有 KV 后测量才可复现。

**根因**：首页 6 张封面全部来自外部 `images.unsplash.com`，以 **1800px 原始宽度**加载，合计 **1.9 MB**。LCP 元素就是其中最大那张。

**一处需要澄清的推断**：图片全部没有 `width`/`height` 属性，容易推断为「CLS 风险 100%」。**但实测 CLS 为 0**——因为容器用 `aspect-ratio`（`16/11`、`16/10`、`16/8.7`）+ `overflow: hidden` 预留了空间，图片以 `object-fit: cover` 撑满。**所以缺宽高不是当前缺陷**，补上只是防御性加固（防止将来改样式时失去保护）。

### 4.2 修复一：图片尺寸参数（收益最大）

Unsplash 支持按需缩放，当前完全没用上：

```ts
// lib/cover.ts
/**
 * 把封面 URL 规整为「按显示宽度缩放」的地址。
 *
 * 现状问题：封面以 1800px 原始尺寸加载，卡片实际显示宽度只有几百像素，
 * 首页 6 张合计 1.9 MB，直接把 LCP 推到 3.4–4.1 秒。
 *
 * 规则：
 *   - 本站 KV 媒体（/api/media/xxx）：原样返回，尺寸优化应在 Worker 侧做
 *   - Unsplash：追加 w / q / fm / fit 参数
 *   - 其它外链：原样返回（不猜测第三方参数）
 */
export function coverUrl(raw: string | undefined, displayWidth: number): string {
  if (!raw) return '/placeholder-cover.svg'

  // 2 倍图，兼顾高分屏
  const w = Math.min(1600, Math.ceil(displayWidth * 2))

  try {
    const u = new URL(raw)
    if (u.host === 'images.unsplash.com') {
      u.searchParams.set('w', String(w))
      u.searchParams.set('q', '72')
      u.searchParams.set('fm', 'webp')
      u.searchParams.set('fit', 'crop')
      return u.toString()
    }
  } catch {
    /* 相对路径会抛错，走下面的原样返回 */
  }
  return raw
}
```

调用处按**实际显示宽度**传参，而不是统一用一个大值：

```tsx
// 卡片：桌面 3 列，单卡约 400px
<img src={coverUrl(article.cover_url, 400)} … />

// 详情页首图：内容区约 1280px
<img src={coverUrl(article.cover_url, 1280)} … />

// 首屏 hero（LCP 元素）：给足尺寸，并标记高优先级
<img src={coverUrl(slide.cover_url, 900)} fetchPriority="high" decoding="async" … />
```

### 4.3 修复二：LCP 元素优先级

```tsx
// 首屏主图：不要 lazy，要 high 优先级
<img
  src={coverUrl(slide.cover_url, 900)}
  alt={slide.title}
  width={900}
  height={619}
  fetchPriority="high"
  decoding="async"
/>
// 其余图片：lazy + async
<img src={coverUrl(a.cover_url, 400)} alt={a.title} width={400} height={250} loading="lazy" decoding="async" />
```

> **规则**：`loading="lazy"` 只用于**视口外**的图。首屏主图加 `lazy` 会**推迟 LCP**，是常见反优化。

### 4.4 修复三：预连接外部图片域名

```html
<!-- index.html —— 提前完成 DNS + TLS，省掉 LCP 前的往返 -->
<link rel="preconnect" href="https://images.unsplash.com" crossorigin />
<link rel="dns-prefetch" href="https://images.unsplash.com" />
```

> 长期建议：把封面迁到本站 KV（`/api/media/`）或 R2，彻底去掉第三方依赖。外部图床还有**可用性风险**（对方限流或改策略会直接导致封面挂掉）。

### 4.5 修复四：JS 体积（当前 764.4 KB / gzip 243.2 KB）

| 产物 | 原始 | gzip |
| --- | --- | --- |
| `index-*.js` | 367 KB | 121.4 KB |
| `vendor-markdown-*.js` | 154 KB | 47.7 KB |
| `vendor-motion-*.js` | 125 KB | 42.1 KB |
| `vendor-react-*.js` | 50 KB | 18.2 KB |
| `index-*.css` | 68.4 KB | 13.8 KB |

按收益排序：

**① 路由级懒加载**——文章正文才需要 markdown 渲染器，把它从首屏移除：

```tsx
// pages/ArticleDetail.tsx
import { lazy, Suspense } from 'react'

// 154 KB 的 markdown 渲染器只在详情页加载
const MarkdownContent = lazy(() => import('@/components/blog/MarkdownContent'))

<Suspense fallback={<div className="reading-loading">正在打开文章…</div>}>
  <MarkdownContent content={article.content} />
</Suspense>
```

**② 路由级代码分割**——当前所有页面在同一主包，改为按路由切分：

```ts
// App.tsx
const Index = lazy(() => import('@/pages/Index'))
const Articles = lazy(() => import('@/pages/Articles'))
const ArticleDetail = lazy(() => import('@/pages/ArticleDetail'))
// …其余同理
```

**③ 关键 CSS 内联**——把首屏所需的少量样式内联进 HTML，其余异步加载，消除 CSS 阻塞渲染：

```html
<!-- 构建期把首屏关键样式内联，其余用 preload 异步取 -->
<style>/* 首屏关键样式（约 3–5 KB） */</style>
<link rel="preload" href="/assets/index-xxx.css" as="style" onload="this.rel='stylesheet'" />
<noscript><link rel="stylesheet" href="/assets/index-xxx.css" /></noscript>
```

> 注意 `onload` 换 `rel` 的写法在**老浏览器**下不执行 JS，故必须配 `<noscript>` 兜底——这也是 IE 场景下样式仍能生效的保障。

### 4.6 修复五：HTML 缓存策略

实测响应头：`cache-control: public, max-age=0, must-revalidate`。

对**带内容哈希**的静态资源（`/assets/index-B9uhFvAF.css`）应设长缓存；对 HTML 应设短缓存 + 协商：

```ts
// 带哈希的产物：一年不可变
if (/^\/assets\/.+-[A-Za-z0-9_-]{8,}\.(js|css|woff2?)$/.test(pathname)) {
  headers.set('cache-control', 'public, max-age=31536000, immutable')
}

// HTML 文档：短缓存 + 协商，保证内容更新能及时生效
if (contentType.includes('text/html')) {
  headers.set('cache-control', 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400')
}
```

---

## 5. URL 与内链策略

### 5.1 现状：这一维度已经做得不错

| 检查 | 实测 |
| --- | --- |
| slug 形态 | **6/6** 为语义化小写连字符（`walking-through-the-clouds` 等）✅ |
| 空锚文本 | **0** 条 ✅ |
| 无信息量锚文本（「点击这里」「更多」） | **0** 条 ✅ |
| 孤立页 | **0/10** ✅（预期可收录页面全部有内链指向） |
| 每页内链数 | 首页 36、详情 28、标签 22、列表 15、关于 9 ✅ |

**保持这套 slug 规范**，并在发布时校验：

```ts
// worker/lib/slug.ts
/**
 * slug 规范：小写字母、数字、连字符；不以连字符开头结尾；不含连续连字符。
 * 拒绝纯数字 —— 纯数字 slug 无关键词信息（如 /articles/071816）。
 */
export function normalizeSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
}

export function isValidSlug(slug: string): boolean {
  if (!slug || slug.length > 80) return false
  if (/^\d+$/.test(slug)) return false        // 纯数字，无关键词
  return /^[a-z0-9\u4e00-\u9fa5]+(-[a-z0-9\u4e00-\u9fa5]+)*$/.test(slug)
}
```

> 现有 6 篇文章的 slug 都是英文语义化，很好。但 e2e 测试创建的文章 slug 是纯数字（`071816`）——**发布路径应加校验**，否则将来手工发布的文章可能落成纯数字 URL。

### 5.2 需要补：URL 规范化策略

当前没有 canonical，意味着同一个页面可能有多种 URL 形态被当作不同页面：

| 变体 | 处理 |
| --- | --- |
| `https://` vs `http://` | 301 到 https |
| 有/无 `www` | 二选一，另一个 301 |
| 尾斜杠 `/articles/` vs `/articles` | **统一不带尾斜杠**，带尾斜杠 301 |
| 大小写 `/Articles` | 统一小写，其它 301 |
| 筛选参数 `/articles?tag=旅行` | canonical 指回 `/articles` |

```ts
// worker/seo/normalize.ts
/**
 * URL 规范化：把多种等价形态收敛到唯一 canonical，避免重复内容稀释权重。
 * 返回需要 301 的目标；已是规范形态则返回 null。
 */
export function canonicalRedirect(url: URL, baseUrl: string): string | null {
  const canonical = new URL(baseUrl)
  const problems: boolean[] = []

  if (url.protocol !== canonical.protocol) problems.push(true)
  if (url.host !== canonical.host) problems.push(true)
  // 尾斜杠：只允许根路径有
  if (url.pathname !== '/' && url.pathname.endsWith('/')) problems.push(true)
  // 大小写：路径必须全小写（slug 规范）
  if (url.pathname !== url.pathname.toLowerCase()) problems.push(true)
  // 索引类参数：tag / page 等筛选参数不进 canonical
  if (url.searchParams.has('tag') || url.searchParams.has('q')) problems.push(true)

  if (!problems.length) return null

  const target = new URL(canonical.origin)
  target.pathname = url.pathname.replace(/\/+$/, '') || '/'
  return target.toString()
}
```

### 5.3 内链策略要点

1. **每个可收录页面至少有一条内链指向**（当前已达成，需在新增页面时保持）
2. **锚文本描述目标内容**，不要「点击这里」——当前已达标
3. **相关文章区块**是详情页内链的主要来源（当前已有「继续阅读」）
4. **标签页是天然的聚合页**：每个标签页应链接到该标签下的全部文章，且文章页应回链到标签页（形成双向）
5. **面包屑同时服务 SEO 与可访问性**：既产出 `BreadcrumbList` 结构化数据，也是屏幕阅读器的导航线索

---

## 6. 可访问性

> 可访问性与 SEO 高度重叠：语义化结构、`alt`、标题层级、链接文本**同时**服务两者。前次审计已确认**键盘可达 0 缺陷、聚焦可见 0 缺陷、悬停反馈 0 缺陷**；对比度灰阶已修正（剩余 60 处为强调色，属已确认的取舍）。以下是尚未覆盖的部分。

### 6.1 问题：无 skip link

键盘用户每进一个页面都要 Tab 穿过整个导航才能到正文。

```tsx
// components/layout/SkipLink.tsx
/** 跳转到主内容。默认视觉隐藏，聚焦时显现。 */
export function SkipLink() {
  return (
    <a href="#main-content" className="skip-link">
      跳到主要内容
    </a>
  )
}
```

```css
.skip-link {
  position: absolute;
  left: -9999px;
  top: 0;
  z-index: 9999;
}
/* 键盘聚焦时显现 —— 必须可见，否则键盘用户看不到自己聚焦在哪 */
.skip-link:focus {
  left: 8px;
  top: 8px;
  padding: 10px 16px;
  background: var(--main-bg);
  color: var(--theme-color);
  border-radius: var(--radius);
  box-shadow: var(--main-shadow-hover);
}
```

配套：每个页面的 `<main>` 加 `id="main-content"`（并提供 `tabIndex={-1}` 以便聚焦）。

### 6.2 问题：路由切换不更新 title，也不移动焦点

实测：`App.tsx` 只在路由变化时 `scrollTo({ top: 0 })`，**没有更新 `document.title`，也没有移动焦点**。

后果：
- 读屏用户切换页面后**不知道页面已变**
- 浏览器标签页标题始终是同一句
- 浏览器历史记录里所有条目同名

```tsx
// components/layout/RouteAnnouncer.tsx
import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * 路由切换时：更新 document.title + 把焦点移到主内容 + 向读屏播报。
 *
 * 三件事必须一起做：
 *   1. document.title —— 浏览器标签、历史记录、以及爬虫执行 JS 时读到的标题
 *   2. 焦点移动 —— 否则读屏用户感知不到页面已切换
 *   3. aria-live 播报 —— 给读屏一个明确的「已到新页面」信号
 */
export function RouteAnnouncer({ titles }: { titles: Record<string, string> }) {
  const { pathname } = useLocation()

  useEffect(() => {
    const title = resolveTitle(pathname, titles)
    document.title = title

    // 焦点移到主内容容器：需 tabIndex={-1} 才能被聚焦
    const main = document.getElementById('main-content')
    if (main) {
      main.focus({ preventScroll: true })
    }

    // 播报（用 aria-live 区域，不要用 alert，避免打断）
    const live = document.getElementById('route-announcer')
    if (live) live.textContent = `已切换到：${title}`
  }, [pathname, titles])

  return <div id="route-announcer" role="status" aria-live="polite" className="visually-hidden" />
}

function resolveTitle(pathname: string, titles: Record<string, string>): string {
  if (titles[pathname]) return titles[pathname]
  if (/^\/articles\/[^/]+$/.test(pathname)) return titles['/articles/:slug'] || '文章详情'
  return titles['*'] || 'huiyiziyuan'
}
```

> 注意：这解决的是**执行 JS 的**浏览器与爬虫。**不执行 JS 的爬虫**（百度/360/搜狗）拿到的 title 必须由服务端注入——见 §3.3。两者是互补关系，都要做。

### 6.3 其它要点

- **`<main>` 唯一**：每页只能有一个 `<main>`（实测各页均满足 ✅）
- **地标数量合理**：首页 `nav=2`（主导航 + 快捷入口）合理；详情页 `header=2`、`footer=2`（站点级 + 文章级）符合规范 ✅
- **图片 `alt`**：17/17 已覆盖 ✅。装饰性图片应写 `alt=""`（空值表示「跳过」），不要省略 `alt`
- **对比度**：灰阶已修正达标；剩余 60 处强调色为已确认取舍，若要进一步处理，最小改动量见《视觉规范.md》
- **动效**：已支持 `prefers-reduced-motion`（实测产物含该媒体查询 ✅）

---

## 7. 跨浏览器兼容性：要点 · 限制 · 应对

### 7.1 硬事实（实测产物）

| 事实 | 实测值 | 对 IE 的影响 |
| --- | --- | --- |
| `<script type="module">` | 1 处 | **IE 全系直接忽略该标签**，一行 JS 不执行 |
| `?.` / `??` | 267 / 70 处 | IE 无法**解析**（polyfill 只能补 API，不能补语法） |
| `const/let` | 2020 处 | IE10 及以下不支持 |
| `class` 语法 | 48 处 | IE10 及以下不支持 |
| `async/await` | 84 处 | IE 全系不支持 |
| CSS `var()` 引用 | **755 处** | IE 全系**不支持 CSS 变量**，全部失效 |
| 自定义属性声明 | 227 处 | 同上 |
| `@property` | 64 处 | IE 不支持 |
| `:is()/:where()/:has()` | 24 处 | IE 不支持 |
| `grid` / `aspect-ratio` / `clamp()` | 54 / 8 / 5 处 | IE 不支持或仅旧语法 |

**结论**：当前产物在 IE 中打开得到的是**无 JS、无样式、无内容**的空白页。

### 7.2 分层目标与应对

| 层级 | 范围 | 目标 | 应对措施 |
| --- | --- | --- | --- |
| **Tier A** 内容浏览 | IE9 / IE10 / IE11 / 360 兼容模式 | **可读全文，排版正常** | ① 服务端返回成品 HTML（§8.2）② 内联样式，不用 `var()` ③ 必要时加条件注释加载 `legacy.css` |
| **Tier B** 完整交互 | Chrome / Firefox / Safari / Edge / Opera / 360 极速模式 | 完整 SPA | 现状已达成；注意 `backdrop-filter` 已有 `-webkit-` 前缀（实测 7/7 ✅） |
| **Tier C** 登录 / 创作台 | 仅现代浏览器 | IE 看到友好提示 | **物理不可达成**，见 §7.4 |

### 7.3 Tier A 的实现要点

**① 内容必须来自服务端。** IE 不执行 `type="module"`，这是唯一入口。

**② 预渲染正文自带内联样式，且不含 `var()`：**

```html
<div id="root">
  <article style="max-width:680px;margin:0 auto;padding:24px;font:16px/1.8 -apple-system,'Microsoft YaHei',sans-serif;color:#333">
    <h1 style="font-size:28px;line-height:1.4;margin:0 0 16px">沿着云的方向，重新理解远方</h1>
    <p style="margin:0 0 16px">清晨五点半，山谷还没有完全醒来……</p>
    <p style="margin:0 0 16px;color:#636363;font-size:14px">
      <time datetime="2026-09-14">2026年9月14日</time> · 6 分钟阅读
    </p>
  </article>
</div>
```

**③ IE 专用的降级样式表**（仅当需要还原完整视觉时）：

```css
/* public/legacy.css —— IE9/10/11 专用
   约束：不用 var()、flex、grid、@supports、aspect-ratio、clamp()、:is()
   布局用 float / display:table / 定宽 */
.legacy-wrap { max-width: 960px; margin: 0 auto; padding: 0 16px; }
.legacy-card {
  display: block;
  float: left;
  width: 31.33%;
  margin: 0 1% 20px;
  padding: 12px;
  background: #fff;
  border: 1px solid rgba(50, 50, 50, .08);
  border-radius: 12px;          /* IE9 支持 border-radius */
  box-shadow: 0 0 10px rgba(116, 116, 116, .08);  /* IE9 支持 box-shadow */
}
.legacy-card img { display: block; width: 100%; height: auto; }
.legacy-title { margin: 0 0 8px; font-size: 18px; font-weight: 600; color: #333; }
.legacy-meta { color: #636363; font-size: 13px; }
.legacy-clearfix:after { content: ""; display: table; clear: both; }  /* IE8+ 支持 */
```

条件注释引入（注意 IE10+ 已废弃 `lt IE 10` 之外的写法，需分别处理）：

```html
<!--[if lt IE 9]><link rel="stylesheet" href="/legacy.css" /><![endif]-->
<!--[if IE 9]><link rel="stylesheet" href="/legacy.css" /><![endif]-->
<!--[if gt IE 9]><!--><link rel="stylesheet" href="/legacy.css" /><!--<![endif]-->
```

> 更稳的做法是**不区分版本**，只要 UA 含 `MSIE` 或 `Trident` 就由服务端注入 `legacy.css`——服务端判定比条件注释可靠。

### 7.4 Tier C 为什么不可达成

`/login` 与 `/studio` 依赖 React 19（React 18 起已移除 IE 支持）、`Promise`/`async-await`、ES module、`?.`/`??`。要真支持必须：

1. React 19 → React 16
2. 全量 `@babel/preset-env` 转 ES5
3. 重写全部样式去掉 CSS 变量（755 处引用）
4. 替换 `framer-motion`（依赖现代 API）

**这等于推翻已完成的视觉改造**，而 IE9 在 2026 年的实际份额已接近零。

**应对**：对 IE 用户返回一个**服务端渲染的友好提示页**（无需 JS）：

```ts
// worker/seo/legacy-notice.ts
/**
 * 判定旧版 IE。
 *
 * UA 特征：
 *   - IE ≤ 10 的 UA 含 "MSIE "
 *   - IE 11 的 UA 改为含 "Trident/"，不再有 MSIE
 *   - EdgeHTML（旧 Edge）含 "Edge/"，但**不含** "Trident/"
 *   - Chromium Edge 含 "Edg/"，也不含 "Trident/"
 * 所以只需匹配这两个标记，无需额外排除 Edge。
 */
const IE_RE = /MSIE |Trident\//

export function isLegacyIE(ua: string): boolean {
  return IE_RE.test(ua)
}

export function legacyNoticeHtml(baseUrl: string): string {
  return `<!doctype html><html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>浏览器版本过低｜huiyiziyuan</title>
<meta name="robots" content="noindex,follow">
<style>body{margin:0;padding:48px 20px;font:16px/1.8 'Microsoft YaHei',sans-serif;color:#333;text-align:center}
a{color:#ff3f9f}</style>
</head><body>
<h1 style="font-size:22px">你的浏览器版本过低</h1>
<p>本站的完整功能需要较新的浏览器。<br>你可以继续浏览<a href="${baseUrl}/articles">文章列表</a>，或升级到 Edge / Chrome / Firefox 后再访问。</p>
</body></html>`
}
```

> 这个提示页**必须 `noindex`**，否则会被搜索引擎收录成一个空页面。

---

## 8. 搜索引擎抓取：要点 · 限制 · 应对

### 8.1 各引擎能力与对策

| 引擎 | JS 执行能力 | 对策 |
| --- | --- | --- |
| Google | 执行，但进**渲染队列**（延迟数天到数周） | 依赖服务端注入即可，无需等待渲染 |
| Bing | 部分执行 | 依赖服务端注入 |
| **百度** | **基本不执行** | **必须服务端渲染内容**；提交 sitemap；可用主动推送 API |
| **360 搜索** | **基本不执行** | 同上 |
| **搜狗** | 基本不执行 | 同上 |
| 社交分享爬虫（微信 / Twitter / Facebook） | **完全不执行** | 只能靠服务端注入 OG 标签 |

**核心判断**：国内流量主要来自**不执行 JS** 的引擎，因此服务端渲染内容不是「优化项」而是**必要条件**。

### 8.2 实现要点

**① `robots.txt` 必须返回 `text/plain`**

实测当前返回 `text/html`——**爬虫会把 HTML 当规则解析，规则完全失效**，等于向爬虫暴露 `/studio`。

```ts
// worker/seo/robots.ts
export function robotsTxt(baseUrl: string): Response {
  const body = [
    'User-agent: *',
    'Allow: /',
    // 注意：这里只 Disallow 无索引价值的接口与处理中页面。
    // /studio 用 noindex（见下），不要 Disallow —— 否则爬虫读不到 noindex 指令。
    'Disallow: /api/',
    'Disallow: /auth/',
    '',
    `Sitemap: ${baseUrl}/sitemap.xml`,
    '',
  ].join('\n')

  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  })
}
```

**② `sitemap.xml` 动态生成，只收录已发布文章**

```ts
// worker/seo/sitemap.ts
export async function sitemapXml(env: AppEnv, baseUrl: string): Promise<Response> {
  const articles = (await listArticles(env)).filter((a) => a.status === 'published')

  const urls = [
    { loc: `${baseUrl}/`, priority: '1.0', changefreq: 'daily' },
    { loc: `${baseUrl}/articles`, priority: '0.8', changefreq: 'daily' },
    { loc: `${baseUrl}/tags`, priority: '0.5', changefreq: 'weekly' },
    { loc: `${baseUrl}/about`, priority: '0.5', changefreq: 'monthly' },
    ...articles.map((a) => ({
      loc: `${baseUrl}/articles/${a.slug}`,
      // lastmod 取 updated_at；不要写未来时间，会被判为不可信
      lastmod: (a.updated_at || a.published_at || '').slice(0, 10),
      priority: '0.6',
      changefreq: 'monthly',
    })),
  ]

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) => `  <url>
    <loc>${escapeXml(u.loc)}</loc>${u.lastmod ? `\n    <lastmod>${u.lastmod}</lastmod>` : ''}
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`,
  )
  .join('\n')}
</urlset>`

  return new Response(body, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  })
}

const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
```

**③ 消灭软 404**——这是当前最容易被忽略的一项

实测：任意不存在的路径都返回 `HTTP 200`（SPA 回退）。爬虫会持续索引这些不存在的页面。

```ts
// worker/seo/routes.ts
const STATIC_ROUTES = new Set(['/', '/articles', '/tags', '/about', '/login', '/studio', '/auth/callback'])

export async function resolveRoute(pathname: string, env: AppEnv) {
  if (STATIC_ROUTES.has(pathname)) {
    // 私有页面：靠 noindex 而非 Disallow
    const noindex = pathname === '/studio' || pathname === '/auth/callback'
    return { status: 200, noindex }
  }

  const m = pathname.match(/^\/articles\/([^/]+)$/)
  if (m) {
    const slug = decodeURIComponent(m[1])
    // 关键：格式合法不代表内容存在，必须查数据源。
    // 只做路由白名单匹配会漏掉这一类软 404。
    const article = await getJson<ArticleRecord>(env.SITE_KV, KEYS.article(slug))
    if (!article || article.status !== 'published') return { status: 404, noindex: true }
    return { status: 200, noindex: false, article }
  }

  return { status: 404, noindex: true }
}
```

**④ `Disallow` 与 `noindex` 的区别（易错点）**

| | 作用 | 能否阻止索引 |
| --- | --- | --- |
| `Disallow` | 阻止**抓取** | ❌ 不能（别处有链接仍可能被索引成无描述条目） |
| `noindex` | 阻止**索引** | ✅ 能 |

**两者不能同时用于同一路径**——`Disallow` 会让爬虫读不到 `noindex` 指令，等于白写。所以：`/studio` 只用 `noindex`，**不要**加进 `Disallow`。

**⑤ 内容预渲染（同时解决 Tier A）**

把正文写进 `<div id="root">`，让不执行 JS 的爬虫与 IE 都能读到。**注意与完整 SSR 的区别**：这不是 React 服务端渲染，而是「静态正文 + 客户端接管」。

关于「React 接管」的两种选择：

| 方案 | 优点 | 代价 |
| --- | --- | --- |
| `hydrateRoot` | 无闪烁，复用 DOM | 需保证服务端 HTML 与客户端渲染**完全一致**，否则报 hydration 警告，维护成本高 |
| React 清空 `root` 后正常挂载 | 实现简单，无一致性负担 | 现代浏览器会看到一次内容替换（可能闪烁） |

**建议先做后者**，观察真实体验后再决定是否升级为 hydration。

### 8.3 潜在限制与应对

| 限制 | 说明 | 应对 |
| --- | --- | --- |
| **KV 最终一致性** | Cloudflare KV 跨区域最终一致（≤60s），新发布文章可能短暂不出现在 sitemap | 属架构特性，**不要加轮询**；接受 60s 延迟 |
| **`HTMLRewriter` 不可用于纯静态托管** | 无边缘运行时则无法注入 | 改用构建期预渲染 + 发布后触发重新构建（Deploy Hook） |
| **构建期预渲染覆盖不到运行时发布的内容** | 后台发布的文章不会进产物 | **这是把 SEO 做反的陷阱**——新文章最需要被收录。必须用边缘渲染，或补发布→重建链路 |
| **百度对 sitemap 的解析较严** | XML 格式错误会整份失效 | 上线前用 `xmllint --noout` 校验；`loc` 必须绝对 URL |
| **UA 嗅探有作弊风险** | 对爬虫给 A、对用户给 B 属 cloaking | 预渲染对二者返回**同一份** HTML，不做内容差异化 |
| **无 JS 环境下轮播/懒加载失效** | 预渲染内容必须是**静态最终态**，不能依赖 JS 才显示 | 预渲染时输出全部内容，不依赖 `whileInView` 之类的入场动画 |

### 8.4 验证方法（零插件）

```bash
BASE=https://trss.us.ci

# 1) robots.txt 必须是 text/plain 且含 Sitemap
curl -sI $BASE/robots.txt | grep -i content-type
curl -s  $BASE/robots.txt

# 2) sitemap 合法性
curl -s $BASE/sitemap.xml | xmllint --noout - && echo "XML 合法"

# 3) 状态码：内容页 200、未知路径 404
curl -s -o /dev/null -w '%{http_code}\n' $BASE/articles/walking-through-the-clouds   # 200
curl -s -o /dev/null -w '%{http_code}\n' $BASE/articles/does-not-exist              # 404
curl -s -o /dev/null -w '%{http_code}\n' $BASE/no-such-page                         # 404

# 4) 爬虫视角：不执行 JS 能否读到正文（最关键）
curl -s $BASE/articles/walking-through-the-clouds | grep -c "清晨五点半"            # ≥1

# 5) 元数据按路由变化
curl -s $BASE/articles/walking-through-the-clouds | grep -o '<title>[^<]*</title>'
curl -s $BASE/about | grep -o '<title>[^<]*</title>'
curl -s $BASE/articles/walking-through-the-clouds | grep -o 'rel="canonical" href="[^"]*"'
curl -s $BASE/articles/walking-through-the-clouds | grep -o 'property="og:image" content="[^"]*"'

# 6) noindex
curl -s $BASE/studio | grep -o 'name="robots" content="[^"]*"'
```

> `curl` 在部分环境会异常（曾出现 exit 23 / HTTP 000）。改用 `node -e "fetch(...)"` 等价验证。

**线上平台**（不属代码，属验收）：Google Search Console / Bing Webmaster / 百度搜索资源平台提交 sitemap 并用「抓取诊断」确认抓到的源码含正文；微信、微博分享调试工具验证 OG 卡片。

---

## 9. 验收清单

### 9.1 可抓取性

- [ ] `/robots.txt` 返回 `text/plain`，含 `Sitemap:` 行
- [ ] `/sitemap.xml` 为合法 XML，只含已发布文章，`loc` 全为绝对 URL，`lastmod` 无未来时间
- [ ] 未知路径返回 **404**（含「格式合法但文章不存在」这一类）
- [ ] `/studio`、`/auth/callback` 含 `noindex`，且**不在** `Disallow` 中

### 9.2 内容可达

- [ ] 不执行 JS 时，每个内容页的初始 HTML 含正文（`grep` 能命中正文关键词）
- [ ] 初始 HTML 含 `h1` 与全部正文段落（不依赖 JS 才显示）

### 9.3 元数据

- [ ] 各路由 `title` **互不相同**且与页面主题一致
- [ ] 各路由 `description` 互不相同
- [ ] `canonical` 存在且为绝对 URL，与 sitemap 的 `loc` 一致
- [ ] `og:title` / `og:image` 存在，`og:image` 为绝对 URL 且可公开访问

### 9.4 页面结构

- [ ] 每页**恰好一个** `h1`，且**不随时间变化**
- [ ] 标题层级不跳跃（无 h1→h3）
- [ ] 正文在 DOM 中先于侧栏

### 9.5 语义化

- [ ] 文章卡片与详情正文使用 `<article>`
- [ ] 所有日期使用 `<time datetime="...">`（显示文本可不同）
- [ ] 封面使用 `<figure>` + `<figcaption>`
- [ ] 图片 `alt` 全覆盖（装饰图用 `alt=""`）

### 9.6 性能

- [ ] 首页 LCP < 2500 ms（当前 3368–4120 ms）
- [ ] CLS < 0.1（当前 0，保持）
- [ ] 图片按显示宽度缩放（不加载 1800px 原图）
- [ ] LCP 图片 `fetchPriority="high"` 且**不加** `loading="lazy"`
- [ ] 已 `preconnect` 外部图片域名
- [ ] 带哈希的静态资源长缓存，HTML 短缓存

### 9.7 URL 与内链

- [ ] 新发布文章的 slug 通过 `isValidSlug`（拒绝纯数字）
- [ ] URL 规范化 301 生效（尾斜杠、大小写、www、筛选参数）
- [ ] 无孤立页（每个可收录页面至少一条内链）

### 9.8 可访问性

- [ ] skip link 存在且聚焦时可见
- [ ] `<main id="main-content" tabIndex={-1}>` 存在
- [ ] 路由切换时 `document.title` 更新且焦点移到主内容
- [ ] 键盘可达 / 聚焦可见 / 悬停反馈无回归（前次基线：0 缺陷）

### 9.9 跨浏览器

- [ ] IE9/10/11 或 360 兼容模式：内容页可读全文，无白屏
- [ ] IE 用户访问交互页看到友好提示（非白屏），且该提示页 `noindex`
- [ ] Chrome / Firefox / Safari / Edge / Opera / 360 极速：完整交互无回归

---

## 10. 实施顺序建议

| 优先级 | 内容 | 依赖 | 风险 |
| --- | --- | --- | --- |
| **P0** | §8.2 robots / sitemap / 真 404 / canonical | 无 | 低，纯新增 Worker 分支 |
| **P0** | §4.2 图片尺寸参数 | 无 | 低，改一个工具函数 + 调用处 |
| **P0** | §6.1 skip link、§6.2 路由标题与焦点 | 无 | 低，纯前端 |
| **P1** | §3.3 元数据边缘注入、§3.4 JSON-LD | P0 | 低，用 `HTMLRewriter` |
| **P1** | §1 首页 h1 稳定化、§2 语义化标签 | 无 | 低，改组件 |
| **P2** | §8.2 内容预渲染（含 Tier A 内联样式） | P1 | 中，需定 hydration 策略 |
| **P2** | §4.5 代码分割 | 无 | 低，需回归 e2e |
| **P3** | §7.3 完整 `legacy.css` | P2 | 中，需长期维护两套样式 |

**P0 三项即可解决首页 LCP 3.4–4.1 秒、软 404、无 skip link 这三个最直观的问题**，且互不耦合，可并行。
