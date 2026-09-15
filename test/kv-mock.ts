import type { KVListResult, KVNamespaceLike, KVPutOptions } from '../worker/types.ts'

interface Entry {
  value: string
  expiresAt: number | null
}

/**
 * 内存版 KV，用于在 Node 中离线验证 Worker 行为。
 * 语义对齐 Workers KV：字符串读写、json 读取、TTL 过期、前缀 list 与游标分页。
 */
export class MemoryKV implements KVNamespaceLike {
  private store = new Map<string, Entry>()

  private live(key: string): Entry | null {
    const entry = this.store.get(key)
    if (!entry) return null
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.store.delete(key)
      return null
    }
    return entry
  }

  async get(key: string, type?: 'text'): Promise<string | null>
  async get(key: string, type: 'json'): Promise<unknown | null>
  async get(key: string, type?: 'text' | 'json'): Promise<string | null | unknown> {
    const entry = this.live(key)
    if (!entry) return null
    if (type === 'json') return JSON.parse(entry.value) as unknown
    return entry.value
  }

  async put(key: string, value: string, options?: KVPutOptions): Promise<void> {
    const expiresAt = options?.expirationTtl ? Date.now() + options.expirationTtl * 1000 : null
    this.store.set(key, { value, expiresAt })
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key)
  }

  async list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<KVListResult> {
    const prefix = options?.prefix ?? ''
    const limit = options?.limit ?? 1000
    const offset = options?.cursor ? Number(options.cursor) : 0
    const names = [...this.store.keys()]
      .filter((name) => name.startsWith(prefix) && this.live(name) !== null)
      .sort()
    const page = names.slice(offset, offset + limit)
    const nextOffset = offset + page.length
    const complete = nextOffset >= names.length
    return {
      keys: page.map((name) => ({ name })),
      list_complete: complete,
      cursor: complete ? undefined : String(nextOffset),
    }
  }

  /** 测试辅助：直接写入而不经过业务代码。 */
  seed(key: string, value: string): void {
    this.store.set(key, { value, expiresAt: null })
  }

  size(): number {
    return this.store.size
  }

  keys(): string[] {
    return [...this.store.keys()]
  }
}
