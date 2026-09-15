/**
 * 文件上传：走 Worker 的 /api/uploads，由 SITE_KV 承载对象本体。
 *
 * 与旧实现的差异：不再依赖腾讯 CloudBase 的匿名登录与临时链接，
 * 因此上传不再需要额外云环境凭据，登录后即可使用。
 */
export interface UploadedAsset {
  /** 服务端存储标识，形如 kv://<id>，用于溯源。 */
  storageId: string
  /** 可直接渲染/下载的相对地址，形如 /api/media/<id>。 */
  previewUrl: string
  name: string
  size: number
  type: string
}

/** 与 Worker 侧 MAX_UPLOAD_BYTES 保持一致，前端提前拦截，避免无谓上传。 */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024

export async function uploadAsset(file: File): Promise<UploadedAsset> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`文件不能超过 ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB`)
  }

  const response = await fetch('/api/uploads', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'content-type': file.type || 'application/octet-stream',
      'x-file-name': encodeURIComponent(file.name),
    },
    body: file,
  })

  const payload = (await response.json().catch(() => ({}))) as {
    status?: string
    data?: { id: string; url: string; name: string; size: number; type: string; storageId: string }
    message?: string
  }

  if (!response.ok || payload.status === 'error' || !payload.data) {
    throw new Error(payload.message || `上传失败（HTTP ${response.status}）`)
  }

  return {
    storageId: payload.data.storageId,
    previewUrl: payload.data.url,
    name: payload.data.name,
    size: payload.data.size,
    type: payload.data.type,
  }
}
