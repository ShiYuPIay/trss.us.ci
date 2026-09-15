import type { KVNamespaceLike } from '../types.ts'
import { KEYS } from './store.ts'

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  retryAfter: number
}

/**
 * 基于 KV 的滑动窗口限流（计数式）。
 *
 * 已知限制（在评估文档中同步说明）：Workers KV 为最终一致存储，读-改-写不是原子操作，
 * 因此并发突发场景下计数可能偏低。定位为「削弱暴力破解与批量注册」的第一道闸门，
 * 而不是强一致配额。若需要严格配额，应升级为 Durable Object 或 Rate Limiting Binding。
 */
export async function hitRateLimit(
  kv: KVNamespaceLike | undefined,
  bucket: string,
  identifier: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  if (!kv) return { allowed: true, remaining: limit, retryAfter: 0 }

  const key = KEYS.rateLimit(bucket, identifier)
  let current = 0
  try {
    current = Number((await kv.get(key)) || '0') || 0
  } catch {
    return { allowed: true, remaining: limit, retryAfter: 0 }
  }

  if (current >= limit) {
    return { allowed: false, remaining: 0, retryAfter: windowSeconds }
  }

  try {
    await kv.put(key, String(current + 1), { expirationTtl: Math.max(60, windowSeconds) })
  } catch {
    // 写入失败时放行，避免因 KV 抖动导致正常用户被拒。
  }

  return { allowed: true, remaining: Math.max(0, limit - current - 1), retryAfter: 0 }
}

/** 登录成功等场景下清零计数，避免正常用户被历史失败次数拖累。 */
export async function resetRateLimit(kv: KVNamespaceLike | undefined, bucket: string, identifier: string): Promise<void> {
  if (!kv) return
  try {
    await kv.delete(KEYS.rateLimit(bucket, identifier))
  } catch {
    // 忽略
  }
}
