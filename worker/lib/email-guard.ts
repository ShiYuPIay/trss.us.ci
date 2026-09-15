import type { KVNamespaceLike } from '../types.ts'
import {
  BLOCKED_LOCAL_PARTS,
  DISPOSABLE_DOMAINS,
  DISPOSABLE_KEYWORDS,
  MULTI_PART_SUFFIXES,
  RISKY_TLDS,
} from './disposable-domains.ts'

export type EmailVerdict =
  | { ok: true; email: string; domain: string; registrable: string; risk: 'low' }
  | { ok: false; email: string; domain: string; reason: string; code: string }

const DISPOSABLE_SET = new Set(DISPOSABLE_DOMAINS)
const RISKY_TLD_SET = new Set(RISKY_TLDS)
const BLOCKED_LOCAL_SET = new Set(BLOCKED_LOCAL_PARTS)

const EMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/

/** RFC 5321 上限：整体 254 字节，本地部分 64 字节。 */
export const MAX_EMAIL_LENGTH = 254
const MAX_LOCAL_LENGTH = 64

export function normalizeEmail(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : ''
}

/** 取可注册域（eTLD+1 的近似实现，覆盖常见多段公共后缀）。 */
export function registrableDomain(domain: string): string {
  const labels = domain.split('.').filter(Boolean)
  if (labels.length <= 2) return labels.join('.')
  const lastTwo = labels.slice(-2).join('.')
  if (MULTI_PART_SUFFIXES.includes(lastTwo)) return labels.slice(-3).join('.')
  return lastTwo
}

function heuristicHit(domain: string, local: string): string | null {
  const compact = domain.replace(/[^a-z0-9]/g, '')
  for (const keyword of DISPOSABLE_KEYWORDS) {
    if (compact.includes(keyword)) return `域名包含一次性邮箱特征词「${keyword}」`
  }
  const tld = domain.split('.').pop() || ''
  if (RISKY_TLD_SET.has(tld)) return `域名使用了高风险免费顶级域「.${tld}」`
  const label = local.split('+')[0]
  if (BLOCKED_LOCAL_SET.has(label)) return `邮箱前缀「${label}」属于测试/占位地址`
  // 连续 6 位以上纯数字前缀，常见于批量注册脚本。
  if (/^\d{6,}$/.test(label)) return '邮箱前缀为纯数字序列，疑似批量注册'
  return null
}

/**
 * 邮箱准入校验：内置清单 → 关键词启发式 → KV 动态覆盖（allow 优先）。
 *
 * KV 读取失败不阻断登录（降级为仅用内置规则），避免把 KV 抖动放大成全站不可登录。
 */
export async function checkEmail(raw: unknown, blocklist?: KVNamespaceLike): Promise<EmailVerdict> {
  const email = normalizeEmail(raw)

  if (!email) return { ok: false, email, domain: '', reason: '请输入邮箱地址', code: 'email_required' }
  if (email.length > MAX_EMAIL_LENGTH) {
    return { ok: false, email, domain: '', reason: '邮箱地址过长', code: 'email_too_long' }
  }
  if (!EMAIL_PATTERN.test(email)) {
    return { ok: false, email, domain: '', reason: '邮箱格式不正确', code: 'email_invalid' }
  }

  const [local, rawDomain] = email.split('@')
  if (local.length > MAX_LOCAL_LENGTH) {
    return { ok: false, email, domain: rawDomain, reason: '邮箱前缀过长', code: 'email_invalid' }
  }
  if (rawDomain.includes('..') || rawDomain.startsWith('.') || rawDomain.endsWith('.')) {
    return { ok: false, email, domain: rawDomain, reason: '邮箱域名格式不正确', code: 'email_invalid' }
  }

  const domain = rawDomain.replace(/\.$/, '')
  const registrable = registrableDomain(domain)

  // KV 覆盖层：管理员可热更新黑/白名单，无需重新部署。
  if (blocklist) {
    try {
      const allow = (await blocklist.get(`allow:${registrable}`)) ?? (await blocklist.get(`allow:${domain}`))
      if (allow === '1' || allow === 'true') {
        return { ok: true, email, domain, registrable, risk: 'low' }
      }
      const blocked = (await blocklist.get(`block:${registrable}`)) ?? (await blocklist.get(`block:${domain}`))
      if (blocked === '1' || blocked === 'true') {
        return { ok: false, email, domain, reason: '该邮箱域名已被列入拦截名单', code: 'email_blocked' }
      }
    } catch {
      // 忽略：KV 不可用时退回内置规则
    }
  }

  if (DISPOSABLE_SET.has(domain) || DISPOSABLE_SET.has(registrable)) {
    return {
      ok: false, email, domain,
      reason: '检测到一次性邮箱域名，请使用常用邮箱注册',
      code: 'email_disposable',
    }
  }

  const reason = heuristicHit(domain, local)
  if (reason) return { ok: false, email, domain, reason, code: 'email_disposable' }

  return { ok: true, email, domain, registrable, risk: 'low' }
}
