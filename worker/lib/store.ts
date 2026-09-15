import type { KVNamespaceLike } from '../types.ts'

/**
 * KV 键空间规划（前缀集中在此，避免散落各处的字符串拼接）。
 *
 * AUTH_KV
 *   sess:<sha256(token)>       会话令牌（TTL 7 天，滑动续期）
 *   otp:<sha256(email)>        邮箱验证码（TTL 5 分钟）
 *   oauth:<state>              OAuth state + PKCE verifier（TTL 10 分钟）
 *   rl:<bucket>:<key>          限流计数（TTL 按窗口）
 *   user:<uid>                 用户档案
 *   email:<sha256(email)>      email → uid 索引
 *   ident:<provider>:<sub>     第三方身份 → uid 索引
 *
 * SITE_KV
 *   article:<slug>             文章对象
 *   articles:index             文章 slug 索引（列表页一次读取代替 N 次列举）
 *   project:<id>               写作项目对象（第一公民）
 *   chapter:<id>               项目下的章节对象
 *   project:chapters:<id>      项目 → 章节 id 有序索引
 *   user:projects:<uid>        用户 → 项目 id 索引（避免全表扫描）
 *   projects:index             全部项目索引（公开广场用，含可见性与状态）
 *   media:<id>                 媒体对象（base64，小文件）
 *   media:meta:<id>            media → content-type 元数据
 *   site:config                站点配置
 *   seed:articles              首次读取时的数据播种标记
 *
 * BLOCKLIST_KV
 *   block:<domain> / allow:<domain>   邮箱域名黑/白名单热更新
 */
export const KEYS = {
  session: (tokenHash: string) => `sess:${tokenHash}`,
  otp: (emailHash: string) => `otp:${emailHash}`,
  oauthState: (state: string) => `oauth:${state}`,
  rateLimit: (bucket: string, key: string) => `rl:${bucket}:${key}`,
  user: (uid: string) => `user:${uid}`,
  emailIndex: (emailHash: string) => `email:${emailHash}`,
  identity: (provider: string, subject: string) => `ident:${provider}:${subject}`,
  password: (emailHash: string) => `pass:${emailHash}`,
  article: (slug: string) => `article:${slug}`,
  articleIndex: 'articles:index',
  project: (id: string) => `project:${id}`,
  chapter: (id: string) => `chapter:${id}`,
  projectChapters: (projectId: string) => `project:chapters:${projectId}`,
  userProjects: (uid: string) => `user:projects:${uid}`,
  projectIndex: 'projects:index',
  media: (id: string) => `media:${id}`,
  mediaMeta: (id: string) => `media:meta:${id}`,
  siteConfig: 'site:config',
  seedFlag: 'seed:articles',
} as const

export async function getJson<T>(kv: KVNamespaceLike | undefined, key: string): Promise<T | null> {
  if (!kv) return null
  try {
    const value = await kv.get(key, 'json')
    return (value as T) ?? null
  } catch {
    return null
  }
}

export async function putJson(kv: KVNamespaceLike | undefined, key: string, value: unknown, ttlSeconds?: number): Promise<void> {
  if (!kv) throw new Error('KV 绑定缺失，无法写入数据')
  await kv.put(key, JSON.stringify(value), ttlSeconds ? { expirationTtl: Math.max(60, Math.floor(ttlSeconds)) } : undefined)
}

export async function getText(kv: KVNamespaceLike | undefined, key: string): Promise<string | null> {
  if (!kv) return null
  try {
    return await kv.get(key)
  } catch {
    return null
  }
}

export async function putText(kv: KVNamespaceLike | undefined, key: string, value: string, ttlSeconds?: number): Promise<void> {
  if (!kv) throw new Error('KV 绑定缺失，无法写入数据')
  await kv.put(key, value, ttlSeconds ? { expirationTtl: Math.max(60, Math.floor(ttlSeconds)) } : undefined)
}

export async function removeKey(kv: KVNamespaceLike | undefined, key: string): Promise<void> {
  if (!kv) return
  try {
    await kv.delete(key)
  } catch {
    // 删除失败不影响主流程（键本身带 TTL）
  }
}

/** 带游标的完整前缀遍历，规避 KV list 单次 1000 条上限。 */
export async function listKeys(kv: KVNamespaceLike | undefined, prefix: string): Promise<string[]> {
  if (!kv) return []
  const names: string[] = []
  let cursor: string | undefined
  for (let page = 0; page < 20; page += 1) {
    let result
    try {
      result = await kv.list({ prefix, limit: 1000, cursor })
    } catch {
      break
    }
    for (const item of result.keys) names.push(item.name)
    if (result.list_complete || !result.cursor) break
    cursor = result.cursor
  }
  return names
}
