# 深度 SEO 优化方案（零插件）

> 适用范围：`trss-site`（React 19 + Vite 7 SPA，Cloudflare Worker + KV，SPA 回退）
> 约束：不引入任何第三方 SEO 插件、SaaS 或外部服务；全部实现落在本仓库代码内
> 全部结论基于对本工程**生产产物与运行中服务**的实测，取证命令与输出见文中引用

---

## 0. 结论摘要

**一句话**：本工程的 SEO 问题不在「缺少 meta 标签」，而在**搜索引擎拿不到内容**——所有 URL 都返回同一份空壳 HTML。修复的正确位置是 Cloudflare Worker（它已在请求路径上），而不是前端；前端再怎么写 meta 都是无用功。

**关于 IE9 的诚实说明**：本方案能做到 IE9+ **可读**，但做不到 IE9 **可交互**。这不是实现取舍，是物理约束，依据见 §1.2。原因简述：

| 事实 | 实测值 | 对 IE 的影响 |
| --- | --- | --- |
| 产物脚本是 `<script type="module">` | 1 处 | IE 全系**直接忽略**该标签，一行 JS 都不执行 |
| 现代语法密度 | `?.` 267 处、`??` 70 处、`const/let` 2020 处、`class` 48 处、模板字符串 614 处、`async/await` 84 处 | IE9/10 解析即报错；IE11 也无法解析 `?.` `??` |
| CSS 自定义属性 | `var()` **755** 处、`--x:` 声明 **227** 处 | IE 全系**不支持 CSS 变量**，755 处引用全部失效 |
| Tailwind v4 依赖的 `@property` | 64 处 | IE 不支持 |
| 现代选择器 `:is()/:where()/:has()` | 24 处 | IE 不支持 |

结论：在 IE 里打开当前站点，得到的是**无 JS、无样式、无内容**的空白页。要让它「能看」，唯一可行路径是**让服务器直接返回成品 HTML**——而这恰好也是 SEO 最需要的。**两个需求在「边缘预渲染」这一点上汇合**，这是本方案的核心设计。

---

## 1. 现状实测取证

### 1.1 九项确凿缺陷

服务地址 `http://127.0.0.1:8787`（`wrangler dev` 托管 `dist/`，与线上拓扑一致）。

| # | 缺陷 | 实测证据 | 严重度 |
| --- | --- | --- | --- |
| 1 | **所有 URL 返回同一份空壳** | `/articles/walking-through-the-clouds` 的响应体是 `<div id="root"></div>`，正文长度为 0 | 🔴 致命 |
| 2 | **`robots.txt` 返回 HTML** | `GET /robots.txt` → `HTTP 200` + `content-type: text/html` | 🔴 致命 |
| 3 | **`sitemap.xml` 返回 HTML** | `GET /sitemap.xml` → `HTTP 200` + `content-type: text/html` | 🔴 致命 |
| 4 | **软 404** | `/articles/does-not-exist-xyz` 与 `/no-such-page-xyz` 均返回 `HTTP 200`，而非 404 | 🔴 致命 |
| 5 | **全站共用同一 `<title>`** | `index.html` 硬编码一个标题；`grep -rn "document.title" src/` **零命中** | 🟠 高 |
| 6 | **无 canonical** | 外壳 head 中无 `<link rel="canonical">` | 🟠 高 |
| 7 | **无 Open Graph / Twitter Card** | 外壳 head 中 `og:*` 与 `twitter:*` **零命中** | 🟠 高 |
| 8 | **结构化数据仅一个静态节点** | 只有一处 `Blog` JSON-LD，与具体页面无关；无 `Article` / `BreadcrumbList` | 🟡 中 |
| 9 | **HTML 无缓存策略** | `cache-control: public, max-age=0, must-revalidate` | 🟡 中 |

第 2、3 项值得特别说明：这不是「文件缺失」，而是 SPA 回退把**任何**未知路径都当作前端路由处理，于是爬虫请求 `robots.txt` 拿到一张 HTML 页面。**爬虫会把这份 HTML 当作 robots 规则解析，结果是规则完全失效**——等于向爬虫暴露了全站（包括 `/studio` 这类不该收录的页面）。

### 1.2 为什么 SPA 必须靠服务端

搜索引擎对 JS 的处理能力差异极大：

| 引擎 | 是否执行 JS | 对 SPA 的实际后果 |
| --- | --- | --- |
| Google | 是，但**进渲染队列**，非即时 | 收录延迟数天到数周；渲染失败则只有空壳 |
| Bing | 部分 | 不可靠 |
| **百度** | 极弱 | **基本只抓 HTML 源码**，SPA 内容几乎不被收录 |
| **360 搜索（so.com）** | 极弱 | 同百度 |
| 搜狗 | 弱 | 同百度 |
| 社交分享爬虫（微信 / Twitter / Facebook） | **完全不执行** | 分享卡片永远是默认标题与无图 |

国内场景（百度 + 360 + 搜狗）是**主要流量来源**，而这几个引擎恰恰都不执行 JS。因此「靠 Google 能渲染」不能作为不改造的理由。

---

## 2. 为什么是 Worker 而不是「插件」

传统 CMS 生态里 SEO 靠插件实现，因为它们能挂进渲染管线。本工程的渲染管线是：

```
浏览器 / 爬虫
      │
      ▼
Cloudflare Worker  ──[ /api/* ]──►  KV（文章、用户、媒体）
      │
      └──[ 其它 ]──►  env.ASSETS.fetch()  ──►  dist/ 静态文件（SPA 回退）
```

关键事实：`wrangler.jsonc` 已配置 `run_worker_first: ["/api/*"]`，**Worker 已经在请求路径上**。我们只需要把拦截范围从 `/api/*` 扩展到「HTML 文档请求」，就能在**边缘**完成注入与预渲染——不新增任何依赖，也不改变现有部署方式。

> 这也是本方案「零插件」的技术含义：所有逻辑都是仓库内的 Worker 代码 + 构建期生成的静态文件，没有外部服务调用、没有运行时第三方依赖。

---

## 3. 目标架构

```
请求进入 Worker
      │
      ├─ /api/*              → 现有 API 逻辑（不变）
      ├─ /robots.txt         → 动态生成（含 sitemap 地址、屏蔽规则）
      ├─ /sitemap.xml        → 从 KV 文章列表动态生成
      ├─ /sitemap-news.xml   → 可选，近期更新
      │
      └─ 其它（文档请求）
            │
            ├─ 判定是否可索引（/studio、/auth/* 不可索引）
            ├─ 取 SPA 外壳 HTML（env.ASSETS.fetch）
            ├─ 按路由注入 <head>（title / description / canonical / OG / JSON-LD）
            ├─ 内容路由追加 <body> 内的预渲染正文（爬虫与 IE 都能读）
            ├─ 未知路由改写状态码为 404
            └─ 返回
```

---

## 4. 分层实施

按「投入产出比」排序，L0 必须做，L1–L2 是主要收益，L3–L5 为加固。

### L0 · 可抓取性基线（必须，收益最大）

**L0-1 真实 `robots.txt`**

在 Worker 中优先拦截，返回 `text/plain`：

```ts
const ROBOTS = `User-agent: *
Allow: /
Disallow: /studio
Disallow: /auth/callback
Disallow: /api/

Sitemap: ${baseUrl}/sitemap.xml
`
```

要点：
- `Disallow: /studio` 与 `/auth/callback` —— 这两类页面无索引价值，且会稀释抓取预算
- 必须返回 `content-type: text/plain; charset=utf-8`，否则爬虫解析失败
- `Sitemap:` 用绝对 URL，域名取自 `env.PUBLIC_BASE_URL`（避免硬编码）

**L0-2 动态 `sitemap.xml`**

从 `SITE_KV` 读取文章索引（`articles:index` 或 `listKeys(SITE_KV, 'article:')`）生成：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://trss.us.ci/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>
  <url><loc>https://trss.us.ci/articles</loc><changefreq>daily</changefreq><priority>0.8</priority></url>
  <url>
    <loc>https://trss.us.ci/articles/walking-through-the-clouds</loc>
    <lastmod>2026-09-14</lastmod>       <!-- 取自记录的 updated_at -->
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>
  ...
</urlset>
```

要点：
- **只收录 `status === 'published'` 的文章**，草稿绝不进 sitemap
- `lastmod` 用文章记录的 `updated_at`（实测该字段存在）
- `lastmod` 必须是 W3C 日期格式；**不要写未来时间**，否则会被判为不可信
- 单文件 URL 上限 50000 条 / 50MB，超了再拆 `sitemap-index.xml`
- 缓存：`cache-control: public, max-age=3600`，避免每次爬取都打 KV

**L0-3 消灭软 404**

这是**当前最容易被忽略、影响却很大**的一项。现在的 SPA 回退让任意垃圾 URL 都返回 200，爬虫会持续索引这些不存在的页面。

实现：Worker 先判定路径是否属于已知路由白名单；未知路径返回 `404` + 站点自己的 404 页面（而不是 200 + 首页）。

```ts
const KNOWN = [/^\/$/, /^\/articles$/, /^\/articles\/[^/]+$/, /^\/tags$/, /^\/about$/, /^\/login$/, /^\/studio$/, /^\/auth\/callback$/]
const status = KNOWN.some((re) => re.test(pathname)) ? 200 : 404
```

更严谨的做法：`/articles/:slug` 命中白名单后，**再查一次 KV**确认该文章存在；不存在则返回 404。否则爬虫仍会索引「格式合法但内容不存在」的 URL。

**L0-4 canonical**

每个页面注入自指 canonical（绝对 URL）。要点：
- 统一域名与协议（`https://` + 无 `www` 或有 `www`，二选一并强制跳转）
- 统一尾斜杠策略（建议：**不带尾斜杠**）
- 带查询参数的 URL（如 `/articles?tag=旅行`）canonical 指回无参版本，避免重复内容

### L1 · 元数据边缘注入

**L1-1 路由级 `<title>` / `<meta name="description">`**

在 Worker 里按路由替换外壳 HTML 的对应标签。示例映射：

| 路由 | title | description |
| --- | --- | --- |
| `/` | `huiyiziyuan｜记录、分享与生长` | 站点定位描述 |
| `/articles` | `全部文章｜huiyiziyuan` | 归档页描述 |
| `/articles/:slug` | `{文章标题}｜huiyiziyuan` | 文章 `excerpt` |
| `/tags` | `标签分类｜huiyiziyuan` | 标签页描述 |
| `/about` | `关于我｜huiyiziyuan` | 关于页描述 |
| 其它 | 兜底 | 兜底 |

`/articles/:slug` 的 title 与 description 取自 KV 中的文章记录——**这是纯服务端行为，不依赖 JS**。

**L1-2 Open Graph / Twitter Card**

微信、微博、Twitter、Facebook 的分享爬虫**完全不执行 JS**，不注入就永远是默认卡片：

```html
<meta property="og:type" content="article" />
<meta property="og:title" content="..." />
<meta property="og:description" content="..." />
<meta property="og:url" content="https://trss.us.ci/articles/xxx" />
<meta property="og:image" content="https://trss.us.ci/api/media/<cover_id>" />
<meta property="og:site_name" content="huiyiziyuan" />
<meta name="twitter:card" content="summary_large_image" />
```

要点：`og:image` **必须是绝对 URL 且可公开访问**。本站封面存在 KV（`/api/media/<id>`），可直接用；建议顺手补上尺寸元信息（`og:image:width` / `height`）以避免首分享被裁切。

**L1-3 注入方式的技术要求**

不要用正则直接改 HTML 字符串（容易破坏标签）。建议：

1. 用 `HTMLRewriter`（Cloudflare Workers 内置，零依赖）逐元素改写 —— **推荐**
2. 或在 `</head>` 前插入，并确保原标签被移除（避免出现两个 `<title>`）

用 `HTMLRewriter` 的关键优势：流式处理、不解析整棵 DOM、对 Worker 内存友好。

### L2 · 内容预渲染（本方案的核心，同时解决 IE9 可读性）

**做法**：对内容型路由（`/`、`/articles`、`/articles/:slug`、`/tags`、`/about`），在 Worker 中把**完整正文 HTML 直接写进 `<div id="root">`**，再让 React 在客户端「接管」（hydration）。

这一步同时达成三件事：

| 目标 | 达成方式 |
| --- | --- |
| 不执行 JS 的爬虫（百度/360/搜狗/社交）拿到完整内容 | 正文已在初始 HTML 中 |
| IE9 用户能读到内容 | IE 忽略 `type="module"`，但 HTML 正文照常渲染 |
| 首屏可见时间（LCP）改善 | 不再等 JS 下载执行 |

**注意与 SSR 的区别**：这不是完整 SSR，不需要 React 服务端渲染（那会引入 `react-dom/server` 与流式渲染的复杂度）。**最务实的做法是「静态正文 + 客户端接管」**：

- 正文用文章 `content`（Markdown）在 Worker 侧转成 HTML。**约束是不能引入第三方依赖**，两个选项：
  - **方案 A（推荐）：Worker 内置极简 Markdown→HTML 转换器**，约 100–150 行，只支持实际用到的语法（标题 / 段落 / 引用 / 有序无序列表 / 代码块 / 行内代码 / 链接 / 加粗斜体）。运行时成本可忽略。
  - 方案 B：构建期预渲染。用现有的 `react-markdown` 在构建脚本里把种子文章转成 HTML 片段写进 `dist/`，Worker 只做拼接。

  **为什么推荐 A 而不是 B**：文章是通过 `/studio` **运行时发布**的（写入 `SITE_KV`），构建期产物无法覆盖它们。若走 B，则种子文章有预渲染、**新发布的文章没有**——而新文章恰恰是最需要被收录的内容，等于把 SEO 做反了。
  若坚持 B，必须补一条「发布后触发重新构建」的链路（Cloudflare Deploy Hook），复杂度和失败面都更大。
  A 的唯一代价是要自己维护那个小转换器；**务必为它写单元测试**（覆盖现有 6 篇文章的 `content`，断言转换结果与 `react-markdown` 的渲染结构一致），否则 Markdown 边界情况会导致正文渲染错乱。

  两个方案的**输出结构必须一致**，且都不含任何 CSS 变量（见下方 IE9 要求）。
- React 接管时，`root` 内已有内容。React 19 的 `hydrateRoot` 会对比并接管；若结构不匹配会告警。**若不想处理 hydration 复杂度，可让 React 清空 `root` 后正常挂载**——爬虫已拿到内容，用户体验不受影响。这是成本最低的折中。

**IE9 兼容的正文 HTML 要求**（这是 IE9 能「看见」的前提）：

预渲染正文必须**自带内联样式**，且样式**不得使用 CSS 变量**：

```html
<div id="root">
  <article class="legacy-post" style="max-width:680px;margin:0 auto;padding:24px;font:16px/1.8 -apple-system,'Microsoft YaHei',sans-serif;color:#333">
    <h1 style="font-size:28px;line-height:1.4;margin:0 0 16px">沿着云的方向，重新理解远方</h1>
    <p style="margin:0 0 16px">清晨五点半，山谷还没有完全醒来……</p>
  </article>
</div>
```

原因：IE 不支持 `var()`，`dist` 里那 68KB CSS 在 IE 中几乎全部失效。内联样式是唯一可靠路径。

> 更完整的 IE9 降级方案（独立的 legacy 样式表 + 条件注释）见 §5。

### L3 · 结构化数据

**L3-1 文章页 `Article` / `BlogPosting`**

```json
{
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  "headline": "沿着云的方向，重新理解远方",
  "description": "……",
  "image": "https://trss.us.ci/api/media/xxx",
  "datePublished": "2026-09-14",
  "dateModified": "2026-09-14",
  "author": { "@type": "Person", "name": "huiyiziyuan" },
  "publisher": { "@type": "Organization", "name": "huiyiziyuan" },
  "mainEntityOfPage": { "@type": "WebPage", "@id": "https://trss.us.ci/articles/xxx" }
}
```

**L3-2 面包屑 `BreadcrumbList`**

`/articles/:slug` 注入「首页 › 文章 › 当前文章」。国内引擎对面包屑的展示支持有限，但 Google 会据此改写搜索结果中的 URL 展示，收益明确。

**L3-3 要点**

- `datePublished` / `dateModified` 用 ISO 8601（可直接用记录的 `published_at` / `updated_at`）
- `image` 必须是绝对 URL 且能公开访问，否则富媒体结果不生效
- **一个页面一个主实体**，不要堆叠多个不相关的 JSON-LD 节点
- 现有那处静态 `Blog` JSON-LD 保留在首页即可，其余页面注入各自的

### L4 · 索引治理

**L4-1 不可索引页面的处理**

| 路由 | 处理 |
| --- | --- |
| `/studio` | `robots.txt` Disallow + `<meta name="robots" content="noindex, nofollow">` |
| `/auth/callback` | 同上 |
| `/login` | 视策略而定：若登录页有独立价值可保留；否则 noindex |
| `/api/*` | robots Disallow（已含在 L0-1） |

**双重保险的理由**：`Disallow` 阻止抓取但不阻止索引（若别处有链接，仍可能被索引成无描述条目）；`noindex` 才真正阻止索引。二者并用，且**注意 `noindex` 页面不能同时被 Disallow 抓取**，否则爬虫读不到 noindex 指令。因此对 `/studio` 这类页面，**只用 `noindex`，不要 Disallow**——这是常见错误。

**L4-2 分页与筛选页**

若后续文章增多需要分页，采用「可抓取的分页 + 自指 canonical」；筛选参数页（`?tag=xxx`）canonical 指回主列表页。

### L5 · 性能与 Core Web Vitals

爬虫的「体验」与用户一致，CWV 是排名因素之一。当前产物规模：

| 产物 | 大小 | 说明 |
| --- | --- | --- |
| `index-*.js` | 367 KB | 主包 |
| `vendor-motion-*.js` | 125 KB | framer-motion |
| `vendor-markdown-*.js` | 154 KB | react-markdown + remark-gfm |
| `vendor-react-*.js` | 50 KB | React + Router |
| `index-*.css` | 68.4 KB | 样式 |
| **合计** | **764.4 KB**（gzip 后 **243.2 KB**，压缩率 31.8%） | |

优化方向（按收益排序）：
1. **`vendor-markdown` 按需加载**：`react-markdown` 只在文章详情页需要，改为 `React.lazy` 动态引入，可从首屏移除 154 KB
2. **路由级代码分割**：当前所有页面在同一主包，改为每路由一个 chunk
3. **`vendor-motion` 评估**：125 KB 的动画库若仅用于页面过渡，可考虑用 CSS 过渡替代
4. 预渲染后首屏内容已在 HTML 中，LCP 自然改善——**这是 L2 的附带收益**

> 注意：IE9 下 `React.lazy` 与动态 `import()` 都不可用，但 IE9 用户拿到的是预渲染静态内容，不依赖这些。**两条路径互不干扰**，这正是分层设计的好处。

---

## 5. 兼容性实现要点

### 5.1 分层目标（务必与需求方对齐）

| 层级 | 浏览器 | 体验 | 可行性 |
| --- | --- | --- | --- |
| **Tier A** 内容浏览 | IE9 / IE10 / IE11 / 360 兼容模式 | 可读全文，排版正常，无交互 | ✅ 本方案可达成 |
| **Tier B** 完整交互 | Chrome / Firefox / Safari / Edge / Opera / 360 极速模式 | 完整 SPA 体验 | ✅ 现状已达成 |
| **Tier C** 登录 / 创作台 | 仅现代浏览器 | IE 用户看到明确提示 | ⚠️ **物理上不可达成**，见 §5.3 |

**关于 360 浏览器的重要说明**：360 浏览器有「极速模式」（Chromium 内核，属 Tier B）与「兼容模式」（IE 内核，**等价于 IE，属 Tier A**）。需求中列出的「360 浏览器」若指兼容模式，本质上就是 IE 要求，二者不重复计算。

### 5.2 Tier A 的实现要点

**① 内容必须来自服务端**（见 L2）。IE 不执行 `type="module"`，这是唯一入口。

**② 样式不得依赖 CSS 变量**。产物 CSS 中 755 处 `var()` 在 IE 中全部失效。做法：

- 为预渲染正文使用**内联样式**（最稳）
- 或额外输出一份 `legacy.css`，通过条件注释仅给 IE 加载：

```html
<!--[if lt IE 10]><link rel="stylesheet" href="/legacy.css" /><![endif]-->
```

`legacy.css` 的要求：
- 纯 CSS2.1 + IE 支持的 CSS3 子集（`border-radius`、`box-shadow`、`-ms-filter` 渐变）
- **不用** `var()`、`flex`、`grid`、`@supports`、`aspect-ratio`、`inset`、`clamp()`、`min()/max()`、`:is()`
- 布局用 `float` / `display: table` / 定宽（IE9 支持 `display:table` 布局）
- 中文字体栈加 `'Microsoft YaHei'`

> 注意：条件注释 `<!--[if lt IE 10]>` 在 IE10+ 已废弃，需为 IE10/11 用 `<!--[if IE]>` 或改用特性检测。更稳妥的做法是**把 legacy.css 通过 `@supports not (color: var(--x))` 反向引入**——但 IE 不支持 `@supports`，所以对 IE 只能靠条件注释。**结论：IE9/10/11 的条件注释需分别处理**。

**③ 视口与响应式**：IE9 支持 `@media`，基本响应式可行；但 IE9 不支持 `viewport` 的 `initial-scale` 之外的特性，移动端 IE 场景可忽略（Windows Phone 已退市）。

**④ 交互降级**：IE9 用户点击导航会走真实页面跳转（多页应用体验），这是**可接受的降级**——只要 Worker 对每个路由都返回对应 HTML，站内链接依然可用。**不要在 IE 里保留「点了没反应」的客户端路由**，那比多页跳转体验更差。

### 5.3 Tier C 为什么不可达成

`/login` 与 `/studio` 依赖：

- React 19（不支持 IE，React 18 起已移除 IE 支持）
- `fetch` / `Promise` / `async-await`（IE 全系无原生 `Promise`，需 polyfill 且无法覆盖全部语法）
- ES module、`?.`、`??`、`class`（IE 无法解析，**polyfill 也无法解决语法层面的问题**——polyfill 只能补 API，不能补语法）

要真正支持，必须：把 React 19 降级到 React 16 + 全量 `@babel/preset-env` 转 ES5 + 重写全部样式去掉 CSS 变量 + 替换 `framer-motion`（依赖现代 API）。**这等于把刚完成的视觉改造整体推翻重做**，而 IE9 在 2026 年的实际份额已接近零。

**建议**：对 IE 用户展示明确、友好的升级提示页（服务端判定 UA 即可，无需 JS），而不是白屏。这既诚实又比白屏好。

### 5.4 兼容性验收矩阵

| 浏览器 | 判定方式 | 通过标准 |
| --- | --- | --- |
| IE9 / IE10 / IE11 | 真实 IE 或 360 兼容模式 | 首页与文章页可读全文，无 JS 报错阻塞渲染 |
| Edge（Chromium） | 最新版 | 完整交互 |
| Chrome / Firefox / Opera | 最新版 + 前 2 个大版本 | 完整交互 |
| Safari | macOS / iOS 最新版 + 前 2 版 | 完整交互；注意 `backdrop-filter` 已有 `-webkit-` 前缀（实测 7/7） |
| 360 极速模式 | Chromium 内核 | 同 Chrome |
| 360 兼容模式 | IE 内核 | 同 Tier A |

---

## 6. 搜索引擎抓取实现要点

### 6.1 各引擎的抓取特性与对策

| 引擎 | 抓取行为 | 本方案对策 |
| --- | --- | --- |
| **Google** | 执行 JS 但有渲染队列；支持 canonical、JSON-LD、sitemap | L0–L3 全部生效；提交 Search Console 观察「已编入索引」 |
| **Bing** | JS 支持不完整 | 依赖 L2 预渲染 |
| **百度** | **基本不执行 JS**；对 sitemap 支持良好；有主动推送 API | **L2 是关键**；提交 sitemap；可考虑接入百度推送 |
| **360 搜索** | 基本不执行 JS | 同百度 |
| **搜狗** | 基本不执行 JS | 同百度 |
| 社交爬虫 | 完全不执行 JS | L1-2 的 OG 标签是唯一手段 |

**结论**：L2（预渲染）不是「优化项」，而是国内收录的**必要条件**。

### 6.2 实现层面的关键约束

1. **状态码必须真实**。爬虫以 HTTP 状态码为第一判据。200 的软 404 会被索引；404 才会被移除。
2. **首字节即含内容**。不要用「先返回空壳再 JS 填充」的方案应付国内引擎。
3. **`robots.txt` 的 MIME 必须是 `text/plain`**。返回 HTML 会导致规则被忽略（当前正是此问题）。
4. **canonical 必须绝对 URL**，且与 sitemap 中的 `loc` 完全一致（协议、域名、尾斜杠三者统一）。
5. **避免 UA 嗅探返回不同内容**（cloaking）。给爬虫和用户返回**同一份**预渲染 HTML，不要「对爬虫给 A、对用户给 B」——这会被判定为作弊并降权。本方案的预渲染对二者一致，安全。
6. **`lastmod` 不要伪造**。频繁无意义更新会降低 sitemap 可信度。
7. **KV 最终一致性**：Cloudflare KV 跨区域最终一致（≤60s）。发布文章后 sitemap 与详情页可能短暂不同步，属预期，**不要为此加轮询**。

### 6.3 验证方法（零插件）

```bash
BASE=https://trss.us.ci

# 1) robots.txt 必须是 text/plain 且含 Sitemap 行
curl -sI $BASE/robots.txt | grep -i content-type
curl -s  $BASE/robots.txt

# 2) sitemap 必须是合法 XML
curl -s $BASE/sitemap.xml | head -20
curl -s $BASE/sitemap.xml | xmllint --noout - && echo "XML 合法"

# 3) 状态码正确性
curl -s -o /dev/null -w '%{http_code}\n' $BASE/articles/walking-through-the-clouds   # 期望 200
curl -s -o /dev/null -w '%{http_code}\n' $BASE/articles/does-not-exist              # 期望 404
curl -s -o /dev/null -w '%{http_code}\n' $BASE/no-such-page                         # 期望 404

# 4) 爬虫视角：不带 JS 时能否读到正文
curl -s $BASE/articles/walking-through-the-clouds | grep -c "清晨五点半"   # 期望 ≥1

# 5) 元数据是否按路由变化
curl -s $BASE/articles/walking-through-the-clouds | grep -o '<title>[^<]*</title>'
curl -s $BASE/about | grep -o '<title>[^<]*</title>'
curl -s $BASE/articles/walking-through-the-clouds | grep -o 'rel="canonical" href="[^"]*"'
curl -s $BASE/articles/walking-through-the-clouds | grep -o 'property="og:title" content="[^"]*"'

# 6) noindex 页面
curl -s $BASE/studio | grep -o 'name="robots" content="[^"]*"'   # 期望含 noindex
```

> 本机环境的 `curl` 在部分场景下异常（曾出现 exit 23 / HTTP 000），可改用 `node -e "fetch(...)"` 等价验证。这一点在《部署与OAuth配置指南》的验证清单里同样适用。

**线上还需**（不属于代码，但属验收环节）：
- Google Search Console：提交 sitemap，用「网址检查」看渲染后的 HTML 是否含正文
- Bing Webmaster Tools：同上
- 百度搜索资源平台：提交 sitemap，用「抓取诊断」确认抓到的源码含正文
- 微信/微博分享调试工具：验证 OG 卡片

---

## 7. 实施顺序与工作量

| 阶段 | 内容 | 依赖 | 风险 |
| --- | --- | --- | --- |
| **P0** | L0（robots / sitemap / 404 / canonical） | 无 | 低。纯 Worker 新增分支，不动现有逻辑 |
| **P1** | L1（title / description / OG 注入） | P0 | 低。需注意用 `HTMLRewriter` 而非字符串替换 |
| **P2** | L2（内容预渲染 + legacy 内联样式） | P1 | 中。需决定「hydrate 还是清空重挂」；建议后者以规避 hydration 告警 |
| **P3** | L3（JSON-LD） | P1 | 低 |
| **P4** | L5（代码分割，减首屏） | 无 | 低，但会改动构建配置，需回归 e2e |
| **P5** | Tier A 完整 legacy 样式表 | P2 | 中。工作量集中在手写 IE 兼容 CSS |

**建议**：P0 + P1 就能解决 §1.1 中 9 项缺陷里的 8 项，投入产出比最高，建议优先落地并先上线观察收录变化，再决定 P2 的深度。

---

## 8. 取舍与风险

**必须明确记录的取舍**：

1. **预渲染正文与 React 接管的关系**：若选择「React 清空 `root` 后正常挂载」，则预渲染内容仅服务爬虫与 IE，现代浏览器用户会看到一次内容替换（可能闪烁）。若选择 `hydrateRoot`，则无闪烁但需保证结构与客户端渲染一致，维护成本更高。**建议先做前者，观察后再决定**。

2. **IE9 的投入产出**：Tier A 需要手写一份 legacy 样式表（约 200–400 行 CSS），且要长期维护两套样式。考虑到 IE9 的实际份额已接近零、且 360 兼容模式主要出现在特定机构环境，**建议先确认目标用户中是否真有 IE 流量**（可用服务端 UA 统计一周），再决定是否投入 P5。

3. **不做的事**：不引入任何第三方 SEO 插件、不做 UA 嗅探、不伪造 `lastmod`、不为爬虫单独准备一份内容（cloaking）。

4. **KV 最终一致性的影响**：新发布文章的最长 60s 内可能 sitemap 与详情页不同步。这是架构特性，不是缺陷，无需处理。

---

## 附录：与现有文档的关系

| 文档 | 关系 |
| --- | --- |
| `docs/视觉规范.md` | 本方案 L2 的 legacy 样式需与其令牌体系对齐；注意 legacy 样式**不能**用其中的 CSS 变量 |
| `docs/部署与OAuth配置指南.md` | 本方案的验证命令与其 §8 上线清单互补，可合并执行 |
| `docs/KV-绑定可行性评估.md` | sitemap 的数据来源（`SITE_KV` 文章索引）见其第四章 |
