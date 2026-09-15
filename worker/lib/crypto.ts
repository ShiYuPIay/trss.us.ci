/**
 * 密码学原语：全部基于 WebCrypto（Cloudflare Workers 与 Node 22+ 原生支持）。
 * 不引入第三方依赖，避免供应链风险并保持冷启动体积。
 */

const encoder = new TextEncoder()
const PBKDF2_ITERATIONS = 210_000
const PBKDF2_HASH = 'SHA-256'
const SALT_BYTES = 16
const KEY_BITS = 256

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

/** 生成 URL 安全的高熵随机串（会话令牌、OAuth state、PKCE verifier）。 */
export function randomToken(bytes = 32): string {
  return toBase64Url(randomBytes(bytes))
}

export function base64UrlEncode(bytes: Uint8Array): string {
  return toBase64Url(bytes)
}

export function base64UrlDecode(value: string): Uint8Array {
  return fromBase64Url(value)
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: PBKDF2_HASH },
    key,
    KEY_BITS,
  )
  return new Uint8Array(bits)
}

export interface PasswordRecord {
  algo: 'PBKDF2-SHA256'
  iterations: number
  salt: string
  hash: string
}

export async function hashPassword(password: string): Promise<PasswordRecord> {
  const salt = randomBytes(SALT_BYTES)
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS)
  return {
    algo: 'PBKDF2-SHA256',
    iterations: PBKDF2_ITERATIONS,
    salt: base64UrlEncode(salt),
    hash: base64UrlEncode(hash),
  }
}

export async function verifyPassword(password: string, record: PasswordRecord): Promise<boolean> {
  if (!record || record.algo !== 'PBKDF2-SHA256' || !record.salt || !record.hash) return false
  const iterations = Number.isFinite(record.iterations) ? record.iterations : PBKDF2_ITERATIONS
  const candidate = await pbkdf2(password, base64UrlDecode(record.salt), iterations)
  return timingSafeEqual(candidate, base64UrlDecode(record.hash))
}

/** 常量时间比较，避免通过响应耗时侧信道推断哈希前缀。 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let index = 0; index < a.length; index += 1) diff |= a[index] ^ b[index]
  return diff === 0
}

export function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index)
  return diff === 0
}

/** 生成定长数字验证码，使用拒绝采样避免取模偏置。 */
export function randomDigits(length = 6): string {
  let output = ''
  while (output.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte >= 250) continue
      output += String(byte % 10)
      if (output.length === length) break
    }
  }
  return output
}

/** 验证码只存哈希，泄漏 KV 也无法直接冒用。 */
export async function otpFingerprint(secret: string, email: string, code: string): Promise<string> {
  return hmacHex(secret, `otp:${email}:${code}`)
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(verifier))
  return toBase64Url(new Uint8Array(digest))
}
