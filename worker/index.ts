import type { AppEnv, ExecutionContextLike } from './types.ts'
import { ApiError, corsHeaders, fail, fromError, json, ok, withSecurityHeaders } from './lib/http.ts'
import { handleAuth } from './routes/auth.ts'
import { handleArticles } from './routes/articles.ts'
import { handleMedia } from './routes/media.ts'
import { handleProjects } from './routes/projects.ts'

const API_PREFIX = '/api'

function handleApi(request: Request, env: AppEnv, url: URL): Promise<Response> {
  if (url.pathname === `${API_PREFIX}/health`) {
    return Promise.resolve(
      ok({
        status: 'healthy',
        time: new Date().toISOString(),
        bindings: {
          AUTH_KV: Boolean(env.AUTH_KV),
          SITE_KV: Boolean(env.SITE_KV),
          BLOCKLIST_KV: Boolean(env.BLOCKLIST_KV),
          ASSETS: Boolean(env.ASSETS),
        },
        secrets: {
          SESSION_SECRET: Boolean(env.SESSION_SECRET),
          GOOGLE: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
          GITHUB: Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
          MAIL: Boolean(env.RESEND_API_KEY || env.MAIL_WEBHOOK_URL),
        },
      }),
    )
  }

  if (url.pathname.startsWith(`${API_PREFIX}/auth`)) return handleAuth(request, env, url)
  if (url.pathname.startsWith(`${API_PREFIX}/articles`)) return handleArticles(request, env, url)
  // 项目与章节：第一公民的读写接口
  if (url.pathname.startsWith(`${API_PREFIX}/projects`) || url.pathname.startsWith(`${API_PREFIX}/chapters`)) {
    return handleProjects(request, env, url)
  }
  if (url.pathname === `${API_PREFIX}/uploads` || url.pathname.startsWith(`${API_PREFIX}/media`)) {
    return handleMedia(request, env, url)
  }

  return Promise.resolve(fail(404, 'not_found', `未知接口：${request.method} ${url.pathname}`))
}

export async function handleRequest(request: Request, env: AppEnv): Promise<Response> {
  const url = new URL(request.url)
  const cors = corsHeaders(request, env)

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors })
  }

  try {
    if (url.pathname === API_PREFIX || url.pathname.startsWith(`${API_PREFIX}/`)) {
      const response = await handleApi(request, env, url)
      const headers = new Headers(response.headers)
      for (const [key, value] of Object.entries(cors)) headers.set(key, value)
      return withSecurityHeaders(new Response(response.body, { status: response.status, headers }))
    }

    // 非 API 请求交给静态资源绑定；未绑定时给出可读的 JSON 说明，便于本地排障。
    if (!env.ASSETS) {
      return json(
        { status: 'error', code: 'assets_unbound', message: '静态资源绑定缺失：请确认 wrangler.jsonc 中已配置 assets.binding = "ASSETS"' },
        { status: 503 },
      )
    }
    const assetResponse = await env.ASSETS.fetch(request)
    return withSecurityHeaders(assetResponse)
  } catch (error) {
    if (error instanceof ApiError) {
      const response = fail(error.status, error.code, error.message)
      const headers = new Headers(response.headers)
      for (const [key, value] of Object.entries(cors)) headers.set(key, value)
      return withSecurityHeaders(new Response(response.body, { status: response.status, headers }))
    }
    return withSecurityHeaders(fromError(error))
  }
}

export default {
  async fetch(request: Request, env: AppEnv, _ctx: ExecutionContextLike): Promise<Response> {
    return handleRequest(request, env)
  },
}
