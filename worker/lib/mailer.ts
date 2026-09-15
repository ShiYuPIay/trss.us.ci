import type { AppEnv } from '../types.ts'
import { ApiError } from './http.ts'

export interface MailResult {
  delivered: boolean
  channel: 'resend' | 'webhook' | 'dev-echo'
}

export function isDevEchoEnabled(env: AppEnv): boolean {
  const enabled = (env.ALLOW_OTP_DEV_ECHO || '').toLowerCase() === 'true'
  const isProduction = (env.ENVIRONMENT || '').toLowerCase() === 'production'
  return enabled && !isProduction
}

function renderOtpHtml(code: string, expiresMinutes: number): string {
  return `<!doctype html><html><body style="margin:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:32px 0">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;padding:36px 32px;box-shadow:0 8px 28px rgba(15,23,42,.08)">
    <p style="margin:0 0 6px;font-size:12px;letter-spacing:.14em;color:#7c7f96">HUIYIZIYUAN</p>
    <h1 style="margin:0 0 18px;font-size:20px;color:#181a2e">登录验证码</h1>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.7;color:#4a4d63">你正在登录创作空间，请在页面中输入以下验证码完成验证：</p>
    <div style="font-size:32px;font-weight:700;letter-spacing:.28em;color:#3b2fbe;background:#f2f1fd;border-radius:12px;padding:18px;text-align:center">${code}</div>
    <p style="margin:22px 0 0;font-size:13px;line-height:1.7;color:#7c7f96">验证码 ${expiresMinutes} 分钟内有效，请勿转发给他人。若非本人操作，可忽略本邮件。</p>
  </div>
</body></html>`
}

/**
 * 验证码投递通道，按可用性依次降级：
 *   1) Resend API（推荐，配置 RESEND_API_KEY + MAIL_FROM）
 *   2) 通用邮件 Webhook（配置 MAIL_WEBHOOK_URL，转发给自建/第三方邮件服务）
 *   3) 开发态回显（仅 ENVIRONMENT !== production 且显式开启 ALLOW_OTP_DEV_ECHO）
 */
export async function sendOtpMail(env: AppEnv, email: string, code: string, expiresMinutes: number): Promise<MailResult> {
  if (env.RESEND_API_KEY && env.MAIL_FROM) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: env.MAIL_FROM,
        to: [email],
        subject: `${code} 是你的登录验证码`,
        html: renderOtpHtml(code, expiresMinutes),
      }),
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new ApiError(502, 'mail_delivery_failed', `验证码邮件发送失败（Resend ${response.status}）${detail.slice(0, 160)}`)
    }
    return { delivered: true, channel: 'resend' }
  }

  if (env.MAIL_WEBHOOK_URL) {
    const response = await fetch(env.MAIL_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: email, subject: '登录验证码', code, expiresMinutes, html: renderOtpHtml(code, expiresMinutes) }),
    })
    if (!response.ok) {
      throw new ApiError(502, 'mail_delivery_failed', `验证码邮件发送失败（Webhook ${response.status}）`)
    }
    return { delivered: true, channel: 'webhook' }
  }

  if (isDevEchoEnabled(env)) return { delivered: false, channel: 'dev-echo' }

  throw new ApiError(
    503,
    'mail_channel_unconfigured',
    '邮件通道尚未配置，暂时无法发送验证码。可改用 Google / GitHub 登录，或联系管理员配置 RESEND_API_KEY。',
  )
}
