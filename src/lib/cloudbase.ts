import cloudbase from '@cloudbase/js-sdk'

const ENV_ID = import.meta.env.VITE_CLOUDBASE_ENV_ID || ''
const REGION = import.meta.env.VITE_CLOUDBASE_REGION || 'ap-shanghai'
const PUBLISH_KEY = import.meta.env.VITE_CLOUDBASE_PUBLISH_KEY || ''

export const isCloudConfigured = Boolean(ENV_ID && PUBLISH_KEY)
export const cloudApp = isCloudConfigured
  ? cloudbase.init({ env: ENV_ID, region: REGION, accessKey: PUBLISH_KEY, auth: { detectSessionInUrl: true } })
  : null

export const auth = cloudApp?.auth ?? null
export const db = cloudApp?.rdb({ database: 'public' }) ?? null

export type UploadedAsset = { storageId: string; previewUrl: string }

export async function getAccessToken(): Promise<string> {
  if (!auth) return ''
  try {
    const { data, error } = await auth.getSession()
    if (error || !data?.session?.access_token) return ''
    return data.session.access_token
  } catch {
    return ''
  }
}

export async function uploadAsset(file: File): Promise<UploadedAsset> {
  if (!cloudApp) throw new Error('云服务正在准备中，请稍后再试')
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-')
  const cloudPath = `huiyiziyuan/${new Date().toISOString().slice(0, 10)}/${Date.now()}-${safeName}`
  const bucket = cloudApp.storage.from()
  const upload = await bucket.upload(cloudPath, file, { contentType: file.type || undefined, upsert: false })
  if (upload.error || !upload.data) throw new Error(upload.error?.message || '文件上传失败')
  const signed = await bucket.createSignedUrl(upload.data.path, 60 * 60 * 24 * 7)
  if (signed.error || !signed.data) throw new Error(signed.error?.message || '文件预览地址生成失败')
  return { storageId: upload.data.fullPath, previewUrl: signed.data.signedUrl }
}
