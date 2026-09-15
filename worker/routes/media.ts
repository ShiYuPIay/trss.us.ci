import type { AppEnv } from '../types.ts'
import { ApiError, ok } from '../lib/http.ts'
import { randomToken } from '../lib/crypto.ts'
import { KEYS, getJson, putJson, removeKey } from '../lib/store.ts'
import { loadUser, readSession, toSessionUser } from '../lib/session.ts'

/** KV 单值上限 25 MiB，base64 膨胀约 33%，此处限制原始文件 2 MiB 留出余量。 */
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024

const ALLOWED_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/svg+xml',
  'application/pdf', 'text/plain', 'text/markdown', 'application/zip',
])

interface MediaMeta {
  id: string
  name: string
  type: string
  size: number
  owner: string
  created_at: string
}

async function requireUser(env: AppEnv, request: Request) {
  const session = await readSession(env, request)
  if (!session) throw new ApiError(401, 'unauthorized', '请先登录后再上传文件')
  const user = await loadUser(env, session.record.uid)
  if (!user) throw new ApiError(401, 'unauthorized', '登录状态已失效，请重新登录')
  return toSessionUser(user)
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/**
 * 媒体读写。
 *
 * 定位说明：该实现把文件本体以 base64 存入 SITE_KV，好处是「零额外基础设施即可跑通
 * 封面与附件上传」；KV 属于读多写少的存储，不适合大文件与高频写入场景。
 * 生产环境建议把本模块替换为 R2 绑定（见 docs/KV-绑定可行性评估.md 的升级路径）。
 */
export async function handleMedia(request: Request, env: AppEnv, url: URL): Promise<Response> {
  const method = request.method.toUpperCase()
  const path = url.pathname.replace(/\/+$/, '')

  if (path === '/api/uploads' && method === 'POST') {
    const user = await requireUser(env, request)
    const type = (request.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim()
    if (!ALLOWED_TYPES.has(type)) {
      throw new ApiError(415, 'unsupported_media_type', `不支持的文件类型：${type}`)
    }
    const declared = Number(request.headers.get('content-length') || '0')
    if (declared > MAX_UPLOAD_BYTES) {
      throw new ApiError(413, 'file_too_large', `文件不能超过 ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB`)
    }
    const buffer = new Uint8Array(await request.arrayBuffer())
    if (buffer.byteLength === 0) throw new ApiError(400, 'empty_file', '上传的文件为空')
    if (buffer.byteLength > MAX_UPLOAD_BYTES) {
      throw new ApiError(413, 'file_too_large', `文件不能超过 ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB`)
    }

    const rawName = request.headers.get('x-file-name') || 'asset'
    const name = decodeURIComponent(rawName).slice(0, 180)
    const id = randomToken(16)
    const meta: MediaMeta = {
      id, name, type,
      size: buffer.byteLength,
      owner: user.uid,
      created_at: new Date().toISOString(),
    }

    await putJson(env.SITE_KV, KEYS.media(id), toBase64(buffer))
    await putJson(env.SITE_KV, KEYS.mediaMeta(id), meta)

    return ok(
      { id, name, type, size: meta.size, storageId: `kv://${id}`, url: `/api/media/${id}` },
      { status: 201 },
    )
  }

  const mediaMatch = path.match(/^\/api\/media\/([A-Za-z0-9_-]+)$/)
  if (mediaMatch && (method === 'GET' || method === 'HEAD')) {
    const id = mediaMatch[1]
    const meta = await getJson<MediaMeta>(env.SITE_KV, KEYS.mediaMeta(id))
    if (!meta) throw new ApiError(404, 'media_not_found', '文件不存在或已被清理')
    if (method === 'HEAD') {
      return new Response(null, {
        headers: {
          'content-type': meta.type,
          'content-length': String(meta.size),
          'cache-control': 'public, max-age=31536000, immutable',
        },
      })
    }
    const encoded = await getJson<string>(env.SITE_KV, KEYS.media(id))
    if (!encoded) throw new ApiError(404, 'media_not_found', '文件内容不存在')
    return new Response(fromBase64(encoded), {
      headers: {
        'content-type': meta.type,
        'content-length': String(meta.size),
        'cache-control': 'public, max-age=31536000, immutable',
        'content-disposition': `inline; filename="${encodeURIComponent(meta.name)}"`,
        'x-content-type-options': 'nosniff',
      },
    })
  }

  if (mediaMatch && method === 'DELETE') {
    const user = await requireUser(env, request)
    const id = mediaMatch[1]
    const meta = await getJson<MediaMeta>(env.SITE_KV, KEYS.mediaMeta(id))
    if (!meta) throw new ApiError(404, 'media_not_found', '文件不存在')
    if (meta.owner !== user.uid) throw new ApiError(403, 'forbidden', '只能删除自己上传的文件')
    await removeKey(env.SITE_KV, KEYS.media(id))
    await removeKey(env.SITE_KV, KEYS.mediaMeta(id))
    return ok({ deleted: id })
  }

  throw new ApiError(404, 'not_found', `未知的媒体接口：${method} ${path}`)
}
