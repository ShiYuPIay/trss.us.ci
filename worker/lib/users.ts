import type { AppEnv, StoredUser } from '../types.ts'
import type { ProviderProfile } from './oauth.ts'
import { randomToken, sha256Hex } from './crypto.ts'
import { KEYS, getJson, putJson } from './store.ts'

async function emailHash(email: string): Promise<string> {
  return sha256Hex(email.toLowerCase())
}

export async function findUserByEmail(env: AppEnv, email: string): Promise<StoredUser | null> {
  const uid = await getJson<string>(env.AUTH_KV, KEYS.emailIndex(await emailHash(email)))
  if (!uid) return null
  return getJson<StoredUser>(env.AUTH_KV, KEYS.user(uid))
}

export async function findUserByIdentity(env: AppEnv, provider: string, subject: string): Promise<StoredUser | null> {
  const uid = await getJson<string>(env.AUTH_KV, KEYS.identity(provider, subject))
  if (!uid) return null
  return getJson<StoredUser>(env.AUTH_KV, KEYS.user(uid))
}

async function writeUser(env: AppEnv, user: StoredUser): Promise<StoredUser> {
  await putJson(env.AUTH_KV, KEYS.user(user.uid), user)
  await putJson(env.AUTH_KV, KEYS.emailIndex(await emailHash(user.email)), user.uid)
  return user
}

export async function createUser(
  env: AppEnv,
  input: { email: string; name?: string; avatarUrl?: string; provider: string; emailVerified: boolean },
): Promise<StoredUser> {
  const now = new Date().toISOString()
  const user: StoredUser = {
    uid: `u_${randomToken(12)}`,
    email: input.email.toLowerCase(),
    name: input.name?.trim() || input.email.split('@')[0],
    avatar_url: input.avatarUrl || '',
    provider: input.provider,
    email_verified: input.emailVerified,
    created_at: now,
    last_login_at: now,
  }
  return writeUser(env, user)
}

export async function touchLogin(env: AppEnv, user: StoredUser, patch: Partial<StoredUser> = {}): Promise<StoredUser> {
  const next: StoredUser = {
    ...user,
    ...patch,
    email: patch.email ? patch.email.toLowerCase() : user.email,
    last_login_at: new Date().toISOString(),
  }
  return writeUser(env, next)
}

/**
 * OAuth 登录的用户归并策略：
 *   1) 先按「第三方身份 ID」匹配，保证同一账号再次登录始终落到同一用户；
 *   2) 再按邮箱匹配，实现「先用邮箱注册、后用 Google 登录」的账号打通；
 *   3) 都没有则新建。
 */
export async function upsertOAuthUser(env: AppEnv, profile: ProviderProfile): Promise<StoredUser> {
  const identityKey = KEYS.identity(profile.provider, profile.subject)
  const byIdentity = await findUserByIdentity(env, profile.provider, profile.subject)

  if (byIdentity) {
    const updated = await touchLogin(env, byIdentity, {
      name: profile.name || byIdentity.name,
      avatar_url: profile.avatarUrl || byIdentity.avatar_url,
      provider: profile.provider,
      email_verified: profile.emailVerified || byIdentity.email_verified,
    })
    await putJson(env.AUTH_KV, identityKey, updated.uid)
    return updated
  }

  const byEmail = await findUserByEmail(env, profile.email)
  if (byEmail) {
    const updated = await touchLogin(env, byEmail, {
      name: byEmail.name || profile.name,
      avatar_url: profile.avatarUrl || byEmail.avatar_url,
      email_verified: profile.emailVerified || byEmail.email_verified,
    })
    await putJson(env.AUTH_KV, identityKey, updated.uid)
    return updated
  }

  const created = await createUser(env, {
    email: profile.email,
    name: profile.name,
    avatarUrl: profile.avatarUrl,
    provider: profile.provider,
    emailVerified: profile.emailVerified,
  })
  await putJson(env.AUTH_KV, identityKey, created.uid)
  return created
}

/** 邮箱验证码登录：未注册的邮箱在验证码校验通过后自动建号（免密注册即登录）。 */
export async function upsertEmailUser(env: AppEnv, email: string): Promise<StoredUser> {
  const existing = await findUserByEmail(env, email)
  if (existing) return touchLogin(env, existing, { email_verified: true })
  return createUser(env, { email, provider: 'email', emailVerified: true })
}
