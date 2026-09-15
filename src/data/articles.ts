import type { Article } from '@/types/article'

export const sampleArticles: Article[] = [
  {
    id: 'journey',
    slug: 'walking-through-the-clouds',
    title: '沿着云的方向，重新理解远方',
    excerpt: '一次没有详细计划的山野徒步，让我重新思考速度、目的地，以及生活中那些被忽略的停顿。',
    content: `# 沿着云的方向，重新理解远方

清晨五点半，山谷还没有完全醒来。雾从林间慢慢升起，远处的山脊只剩下一条深蓝色的轮廓。

> 旅行不是为了抵达更多地方，而是让熟悉的生活重新变得清晰。

## 把计划留在山脚

我们常常习惯把每一天切成精确的刻度：几点出发、多久抵达、要拍到什么样的照片。但真正走进山里后，天气、光线和脚步都有自己的节奏。

- 在溪水边多停留十分钟
- 为一束穿过树林的光改变路线
- 接受看不到日出的清晨

这些没有写进计划的片段，后来反而成了记忆里最具体的部分。

## 一份轻量出行清单

\`\`\`text
相机或手机
一小瓶水
轻便雨衣
一本可以随手记录的册子
\`\`\`

回程时，我没有得到一张完美的日出照片，却带回了很多不急着解释的瞬间。远方也许并不提供答案，它只是给我们一个重新提问的空间。`,
    cover_url: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=1800&q=88',
    tags: ['旅行', '随笔', '摄影'],
    status: 'published',
    featured: true,
    author: 'huiyiziyuan',
    reading_time: '6 分钟阅读',
    attachments: [{ name: '山野轻装清单.pdf', url: '#', type: 'application/pdf' }],
    published_at: '2025-06-18',
  },
  {
    id: 'writing',
    slug: 'build-a-personal-writing-system',
    title: '建立一套不会半途而废的写作系统',
    excerpt: '不依赖灵感，用收集、孵化、成稿三个简单阶段，让想法稳定地变成可以分享的文字。',
    content: `# 建立一套不会半途而废的写作系统

写作最困难的部分，通常不是表达，而是从空白开始。我的解决方式，是不再把“想法”和“文章”当成同一种东西。

## 三个篮子

### 1. 收集

只记录一句话、一个场景或一个问题。不评价，不扩写。

### 2. 孵化

每周选择两三个想法，补充资料与个人经历。允许它保持凌乱。

### 3. 成稿

当素材足够时，再考虑结构、标题和读者。这个阶段只做取舍，不再无限搜索。

**稳定输出的关键不是更自律，而是让每一步都足够轻。**`,
    cover_url: 'https://images.unsplash.com/photo-1455390582262-044cdead277a?auto=format&fit=crop&w=1800&q=88',
    tags: ['写作', '方法', '成长'],
    status: 'published',
    featured: true,
    author: 'huiyiziyuan',
    reading_time: '5 分钟阅读',
    attachments: [],
    published_at: '2025-05-26',
  },
  {
    id: 'design',
    slug: 'designing-for-quiet-attention',
    title: '为安静的注意力而设计',
    excerpt: '好的界面不需要处处强调自己。留白、层级与恰到好处的动效，会让内容自然成为主角。',
    content: `# 为安静的注意力而设计

我们打开一个页面时，视觉会在很短的时间内判断：哪里最重要，下一步可以做什么，这里是否值得停留。

## 让内容先说话

设计并不是不断增加装饰，而是建立秩序。一个清楚的标题、一段舒服的行距、一次自然的页面过渡，往往比复杂特效更有效。

## 克制也需要细节

1. 保持明确的视觉层级
2. 给交互提供即时但不过度的反馈
3. 为长文保留足够的呼吸感
4. 在移动设备上重新审视阅读顺序

当界面不再争抢注意力，读者才有机会真正进入内容。`,
    cover_url: 'https://images.unsplash.com/photo-1494438639946-1ebd1d20bf85?auto=format&fit=crop&w=1800&q=88',
    tags: ['设计', '体验', '思考'],
    status: 'published',
    featured: false,
    author: 'huiyiziyuan',
    reading_time: '4 分钟阅读',
    attachments: [],
    published_at: '2025-04-12',
  },
  {
    id: 'memory',
    slug: 'the-sound-of-summer-rain',
    title: '夏日雨声里的旧时光',
    excerpt: '一场突如其来的午后雨，把城市的声音压低，也带回了关于老屋、蝉鸣与玻璃窗的记忆。',
    content: `# 夏日雨声里的旧时光

雨落下来之前，空气先安静了一会儿。树叶翻出浅色的背面，远处的风沿着街道一路赶来。

小时候的夏天总是很长。我们坐在老屋门口等雨停，看屋檐下的水连成透明的线。那时并不知道，记忆会把一些普通下午保存得如此完整。

后来住进更高的楼，雨声变得遥远。直到某个午后，我打开窗，才发现时间从来没有真正离开，它只是藏在熟悉的声音里。`,
    cover_url: 'https://images.unsplash.com/photo-1515694346937-94d85e41e6f0?auto=format&fit=crop&w=1800&q=88',
    tags: ['生活', '记忆', '随笔'],
    status: 'published',
    featured: false,
    author: 'huiyiziyuan',
    reading_time: '3 分钟阅读',
    attachments: [],
    published_at: '2025-03-08',
  },
  {
    id: 'reading',
    slug: 'notes-on-deep-reading',
    title: '深度阅读不是读得更慢',
    excerpt: '真正有效的阅读，是在合适的位置停下来，把书中的问题带回自己的经验。',
    content: `# 深度阅读不是读得更慢

读得慢不一定读得深。深度来自连接：一句话与过去经验的连接，一个观点与现实问题的连接。

## 我的阅读标记

- 惊讶：它改变了我原来的判断
- 反对：我能否说清不同意的原因
- 行动：它会改变接下来的一件小事

一本书不必被完整记住。只要有一个观点在此后持续参与生活，这次阅读就已经发生。`,
    cover_url: 'https://images.unsplash.com/photo-1495446815901-a7297e633e8d?auto=format&fit=crop&w=1800&q=88',
    tags: ['阅读', '方法', '思考'],
    status: 'published',
    featured: true,
    author: 'huiyiziyuan',
    reading_time: '5 分钟阅读',
    attachments: [],
    published_at: '2025-02-14',
  },
  {
    id: 'city',
    slug: 'city-walk-at-dusk',
    title: '黄昏以后，去城市里散步',
    excerpt: '不设目的地的城市漫步，是重新发现日常尺度最简单的方法。',
    content: `# 黄昏以后，去城市里散步

从熟悉的路口拐向另一边，城市会突然露出陌生的一面。灯刚亮，店铺开始忙碌，窗户里的生活像一格格安静的电影。

散步不要求结果。它只是把我们从明确的任务中短暂释放出来，让眼睛重新看见附近。`,
    cover_url: 'https://images.unsplash.com/photo-1519501025264-65ba15a82390?auto=format&fit=crop&w=1800&q=88',
    tags: ['城市', '摄影', '生活'],
    status: 'published',
    featured: false,
    author: 'huiyiziyuan',
    reading_time: '3 分钟阅读',
    attachments: [],
    published_at: '2025-01-21',
  },
]

export const allTags = Array.from(new Set(sampleArticles.flatMap((article) => article.tags)))
