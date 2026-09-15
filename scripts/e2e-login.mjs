/**
 * 浏览器端到端验证：登录 UI 完整链路。
 *
 * 覆盖：
 *   1. 登录页三页签与 OAuth 入口渲染
 *   2. 临时邮箱实时拦截 / 正常邮箱放行
 *   3. OAuth 弹窗授权地址（PKCE + 一次性 state）
 *   4. 邮箱验证码登录全链路（发码 → 校验 → 签发会话 → 登出）
 *   5. 密码注册并进入创作空间
 *   6. 封面上传（/api/uploads → SITE_KV）与媒体回读（/api/media/<id>）
 *   7. 发文写回 KV → 列表可见 → 详情页封面渲染
 *   8. 登录态持久与受保护路由重定向
 *
 * 前置：目标服务已启动。默认打服务器；本地联调用 --base-url 显式指定。
 *      前端既可以是 `vite` 开发服务器，也可以是生产产物。
 *      脚本会为每轮运行分配独立的限流桶，因此可连续重复执行。
 *
 * 用法：
 *   node scripts/e2e-login.mjs                                    # 服务器 https://47.106.222.26
 *   node scripts/e2e-login.mjs --base-url=http://127.0.0.1:5173   # 本地 vite 开发服务器
 *   node scripts/e2e-login.mjs --base-url=http://127.0.0.1:8787   # 本地生产产物（wrangler dev 托管 dist）
 * 环境变量：
 *   BASE_URL              默认 https://47.106.222.26
 *   CHROME_PATH           自定义 Chrome 可执行文件路径
 *   PLAYWRIGHT_CORE_PATH  自定义 playwright-core 模块路径
 *   ARTIFACT_DIR          截图输出目录，默认 .e2e-artifacts
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

// 支持 --base-url= 形式：Windows 的 cmd 不支持 `VAR=x cmd` 前缀写法，脚本层解析更稳妥。
const baseUrlArg = process.argv.find((arg) => arg.startsWith('--base-url='))
const BASE_URL = baseUrlArg ? baseUrlArg.slice('--base-url='.length) : process.env.BASE_URL || 'https://47.106.222.26'
const ARTIFACT_DIR = process.env.ARTIFACT_DIR || '.e2e-artifacts'

function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_CORE_PATH,
    'playwright-core',
    path.join(os.homedir(), '.workbuddy-ai/binaries/node/workspace/node_modules/playwright-core'),
  ].filter(Boolean)
  for (const candidate of candidates) {
    try {
      return require(candidate)
    } catch {
      // 尝试下一个候选路径
    }
  }
  throw new Error('未找到 playwright-core，请先安装：npm install playwright-core')
}

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  const root = path.join(os.homedir(), '.agent-browser', 'browsers')
  if (!fs.existsSync(root)) return undefined
  for (const entry of fs.readdirSync(root)) {
    const exe = path.join(root, entry, 'chrome.exe')
    if (fs.existsSync(exe)) return exe
  }
  return undefined
}

/**
 * 1×1 全透明 PNG（68 字节，像素 RGBA = 0,0,0,0），用于验证上传链路而不引入二进制夹具文件。
 * 注意：网上流传的若干「1×1 透明 PNG」片段实际是半透明彩色像素（例如 RGBA 255,0,0,127），
 * 用作文章封面时会在列表里显示成一块纯色。此处为程序生成并回读校验过的版本。
 */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=',
  'base64',
)

const checks = []
function record(name, passed, detail = '') {
  checks.push({ name, passed, detail })
  console.log(`${passed ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

/**
 * 等待 SPA 页面过渡结束，再截图取证。
 *
 * framer-motion 的 AnimatePresence 会让【上一页在退场动画期间仍留在 DOM 中】，
 * 而每个页面都渲染一个 <main>，因此过渡进行中 document.querySelectorAll('main').length === 2。
 * 若在此时整页截图，会把正在淡出的旧页面拍进去——
 * 03-studio.png 曾因此拍成登录页，与同处的断言结论相反，误导排查方向。
 */
async function settlePageTransition(page) {
  await page
    .waitForFunction(() => document.querySelectorAll('main').length <= 1, { timeout: 10000 })
    .catch(() => {})
  // 退场元素移除后，入场动画仍有约 0.2s，留一点余量避免拍到半透明的页面
  await page.waitForTimeout(300)
}

async function main() {
  const { chromium } = loadPlaywright()
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true })

  const executablePath = findChrome()
  console.log(`目标地址：${BASE_URL}`)
  console.log(`启动浏览器：${executablePath || '(playwright 内置)'}`)

  const browser = await chromium.launch({
    executablePath,
    headless: true,
    // 容器/沙箱环境下 Chrome 自带沙箱会静默退出，必须关闭。
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  })

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()

  // —— 测试隔离：每轮使用独立的客户端 IP 桶 ——
  // Worker 的限流按 IP 计数，而本地 KV 跨进程保留，连续多轮验证会把自己的桶打满（429）。
  // 这里只给本站 /api/** 附加一个每轮唯一的 CF-Connecting-IP，让每轮从空计数开始。
  // 生产环境由 Cloudflare 边缘覆盖该请求头，客户端无法伪造，因此这不是绕过限流的入口；
  // 限流器本身的正确性由集成测试覆盖。
  const appOrigin = new URL(BASE_URL).origin
  // 单轮内保持稳定（模拟同一个客户端），跨轮取值不同（避免累积计数）。
  const testIp = `198.51.100.${(Date.now() % 200) + 11}`
  await context.route(`${appOrigin}/api/**`, (route) => {
    void route.continue({ headers: { ...route.request().headers(), 'cf-connecting-ip': testIp } })
  })
  console.log(`限流桶标识：${testIp}`)

  const consoleErrors = []
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(`console: ${message.text()}`)
  })

  // 限流是「按 IP 累计」的：本地 KV 跨进程保留，连续多轮验证会把自己的桶打满。
  // 这里显式收集 429，避免失败时只看到一个语焉不详的等待超时。
  const rateLimited = []
  page.on('response', (response) => {
    if (response.status() === 429) rateLimited.push(response.url())
  })

  const email = `e2e-${Date.now()}@gmail.com`
  const password = 'Passw0rd123'

  try {
    // —— 1. 登录页渲染 ——
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('input[type="email"]', { timeout: 20000 })
    record('登录页渲染出邮箱输入框', true)

    const tabs = await page.locator('[role="tab"]').allInnerTexts()
    record(
      '三个登录页签齐备',
      tabs.length === 3 && tabs.join('').includes('邮箱验证码') && tabs.join('').includes('密码登录') && tabs.join('').includes('注册账号'),
      tabs.join(' / '),
    )

    // OAuth 入口依赖 /api/auth/providers 的异步结果，必须等待而不是立即断言
    const googleButton = page.locator('button:has-text("使用 Google 登录")')
    const githubButton = page.locator('button:has-text("使用 GitHub 登录")')
    await googleButton.waitFor({ state: 'visible', timeout: 15000 })
    record('Google 登录入口可见', true)
    await githubButton.waitFor({ state: 'visible', timeout: 15000 })
    record('GitHub 登录入口可见', true)
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '01-login.png'), fullPage: true })

    // —— 2. 临时邮箱实时拦截 ——
    await page.fill('input[type="email"]', 'tester@mailinator.com')
    await page.locator('input[type="email"]').blur()
    await page.waitForSelector('.field-hint.error', { timeout: 10000 })
    const blockHint = (await page.locator('.field-hint.error').innerText()).trim()
    record('临时邮箱被实时拦截', blockHint.includes('一次性邮箱'), blockHint)
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '02-temp-email-blocked.png'), fullPage: true })

    // —— 3. 正常邮箱放行 ——
    await page.fill('input[type="email"]', email)
    await page.locator('input[type="email"]').blur()
    await page.waitForSelector('.field-hint.ok', { timeout: 10000 })
    record('正常邮箱放行', true, email)

    // —— 4. OAuth 弹窗跳转正确（需在登录前检查，登录后 /login 会自动跳转） ——
    // 断言对象是弹窗发出的「首个授权请求」，而不是弹窗最终 URL：
    // 本项目用的是占位 client id，Google 会先接受请求再跳到错误页，最终 URL 不含我们的参数。
    const authorizeRequests = []
    context.on('request', (request) => {
      if (request.url().startsWith('https://accounts.google.com/o/oauth2')) authorizeRequests.push(request.url())
    })

    const [popup] = await Promise.all([
      page.waitForEvent('popup', { timeout: 20000 }),
      page.click('button:has-text("使用 Google 登录")'),
    ])
    await popup.waitForLoadState('domcontentloaded').catch(() => {})
    await page.waitForTimeout(500)

    const authorizeUrl = new URL(authorizeRequests[0] || 'https://invalid.local/')
    record('Google 登录弹窗发起 accounts.google.com 授权请求', authorizeUrl.hostname === 'accounts.google.com', authorizeRequests[0]?.slice(0, 100) || '未捕获到请求')
    record(
      '授权地址携带 PKCE 参数',
      authorizeUrl.searchParams.get('code_challenge_method') === 'S256' && Boolean(authorizeUrl.searchParams.get('code_challenge')),
      `code_challenge_method=${authorizeUrl.searchParams.get('code_challenge_method')}`,
    )
    record('授权地址携带一次性 state', (authorizeUrl.searchParams.get('state') || '').length > 20)
    await popup.close()

    // —— 5. 邮箱验证码登录（覆盖 OTP 全链路：发码 → 校验 → 签发会话） ——
    const otpEmail = `e2e-otp-${Date.now()}@outlook.com`
    await page.click('[role="tab"]:has-text("邮箱验证码")')
    await page.fill('input[type="email"]', otpEmail)
    await page.locator('input[type="email"]').blur()
    await page.waitForSelector('.field-hint.ok', { timeout: 10000 })
    await page.click('button[type="submit"]')
    // 本地调试模式下验证码会自动填入，按钮文案随之变为「进入创作空间」
    await page.waitForSelector('button[type="submit"]:has-text("进入创作空间")', { timeout: 20000 })
    const otpFilled = await page.locator('label:has-text("6 位验证码") input').inputValue()
    record('验证码已发送并自动填入（本地调试通道）', /^\d{6}$/.test(otpFilled), `长度 ${otpFilled.length}`)
    await page.click('button[type="submit"]')
    await page.waitForURL('**/studio', { timeout: 20000 })
    record('验证码登录成功并进入创作空间', true, otpEmail)

    // 登出，为后续密码注册流程让路
    await page.click('button[aria-label="退出登录"]')
    await page.waitForURL('**/login', { timeout: 20000 })
    record('验证码登录的会话可正常登出', true)

    // —— 6. 注册并进入创作空间 ——
    // 登出会卸载登录页，邮箱状态随之清空，此处必须重新填写。
    await page.click('[role="tab"]:has-text("注册账号")')
    await page.fill('input[type="email"]', email)
    await page.locator('input[type="email"]').blur()
    await page.waitForSelector('.field-hint.ok', { timeout: 10000 })
    await page.fill('input[type="password"]', password)
    await page.click('button[type="submit"]')
    await page.waitForURL('**/studio', { timeout: 20000 })
    await page.waitForSelector('text=写作工作台', { timeout: 20000 })
    record('注册成功并跳转创作空间', true, page.url())
    await settlePageTransition(page)
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '03-studio.png'), fullPage: true })

    // —— 7. 封面上传（浏览器 → Worker → SITE_KV） ——
    const uploadResponse = page.waitForResponse(
      (response) => response.url().includes('/api/uploads') && response.request().method() === 'POST',
      { timeout: 20000 },
    )
    await page.locator('.upload-button:has-text("上传封面") input[type="file"]').setInputFiles({
      name: 'e2e-cover.png',
      mimeType: 'image/png',
      buffer: TINY_PNG,
    })
    const uploaded = await uploadResponse
    record('封面上传接口返回 201', uploaded.status() === 201, `HTTP ${uploaded.status()}`)

    const uploadBody = await uploaded.json().catch(() => ({}))
    const mediaUrl = uploadBody?.data?.url || ''
    record('上传响应给出 /api/media 预览地址', /^\/api\/media\/[A-Za-z0-9_-]+$/.test(mediaUrl), mediaUrl || JSON.stringify(uploadBody).slice(0, 120))

    await page.waitForSelector('.upload-success:has-text("封面已就绪")', { timeout: 15000 })
    record('界面提示封面已就绪', true)
    await page.waitForSelector('img.preview-cover', { timeout: 15000 })
    record('实时预览渲染出封面图', true)

    // 直接回读媒体本体，确认数据确实落在 KV 而不是仅存在于前端状态
    const mediaResponse = await context.request.get(new URL(mediaUrl, BASE_URL).toString())
    const mediaType = mediaResponse.headers()['content-type'] || ''
    record('媒体可从 KV 回读（/api/media/<id>）', mediaResponse.ok() && mediaType.startsWith('image/png'), `HTTP ${mediaResponse.status()} ${mediaType}`)
    record(
      '回读内容与上传字节一致',
      Buffer.compare(Buffer.from(await mediaResponse.body()), TINY_PNG) === 0,
      `${(await mediaResponse.body()).length} bytes`,
    )

    // —— 8. 发文写回 KV ——
    const title = `端到端验证 ${new Date().toISOString().slice(11, 19)}`
    await page.locator('.editor-fields input').first().fill(title)
    await page.locator('.editor-fields textarea').first().fill('通过浏览器端到端验证写入 SITE_KV 的摘要。')
    await page.locator('textarea.markdown-editor').fill('# 端到端验证\n\n正文由浏览器写入，经 Worker 落盘至 KV。')
    // 先等上一条 toast 消失，避免读到注册/上传的提示
    await page.locator('[data-sonner-toast]').first().waitFor({ state: 'detached', timeout: 15000 }).catch(() => {})
    await page.click('button:has-text("发布文章")')
    const publishToast = page.locator('[data-sonner-toast]:has-text("已发布")').first()
    await publishToast.waitFor({ timeout: 20000 })
    record('发布文章成功', true, (await publishToast.innerText()).trim())
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '04-published.png'), fullPage: true })

    // —— 9. 文章列表可见（数据确实落到了 KV） ——
    await page.goto(`${BASE_URL}/articles`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector(`text=${title}`, { timeout: 20000 })
    record('新文章出现在列表中（KV 数据可见）', true)
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '05-articles.png'), fullPage: true })

    // —— 10. 详情页封面渲染（验证媒体链接在真实页面可用） ——
    await page.locator('.article-card-link', { hasText: title }).first().click()
    await page.waitForSelector('main.article-detail', { timeout: 20000 })
    record('点击列表项进入文章详情页', /\/articles\/.+/.test(page.url()), page.url())
    const coverImage = page.locator('.detail-cover img').first()
    await coverImage.waitFor({ timeout: 15000 })
    const coverSrc = await coverImage.getAttribute('src').catch(() => null)
    record('详情页渲染封面且指向 KV 媒体', Boolean(coverSrc && coverSrc.includes('/api/media/')), coverSrc || '未找到封面图')
    const coverNatural = await coverImage.evaluate((node) => node.naturalWidth).catch(() => 0)
    record('封面图在详情页成功解码', coverNatural > 0, `naturalWidth=${coverNatural}`)
    await settlePageTransition(page)
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '06-article-detail.png'), fullPage: true })

    // —— 11. 登录态持久（刷新后仍在登录） ——
    await page.goto(`${BASE_URL}/studio`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('text=写作工作台', { timeout: 20000 })
    record('刷新后登录态保持（HttpOnly Cookie 生效）', true)

    // —— 12. 登出 ——
    await page.waitForSelector('button[aria-label="退出登录"]', { timeout: 20000 })
    await page.click('button[aria-label="退出登录"]')
    await page.waitForURL('**/login', { timeout: 20000 })
    record('登出后回到登录页', true)

    await page.goto(`${BASE_URL}/studio`, { waitUntil: 'domcontentloaded' })
    await page.waitForURL('**/login', { timeout: 20000 })
    record('登出后受保护路由重定向到登录页', true)
  } finally {
    if (consoleErrors.length) {
      console.log('\n浏览器控制台错误：')
      for (const error of consoleErrors.slice(0, 10)) console.log(`  ! ${error}`)
    }
    await browser.close()
  }

  const failed = checks.filter((item) => !item.passed)
  console.log(`\n结果：${checks.length - failed.length}/${checks.length} 项通过`)
  if (rateLimited.length) {
    console.log(`\n检测到 ${rateLimited.length} 个 429 响应（限流器生效）：`)
    for (const url of [...new Set(rateLimited)].slice(0, 5)) console.log(`  ! ${url}`)
    console.log('  单轮运行内出现 429 说明阈值偏紧；跨轮累积则说明限流桶未按预期隔离。')
  }
  if (failed.length) {
    console.log('失败项：')
    for (const item of failed) console.log(`  ✗ ${item.name} ${item.detail}`)
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error('端到端验证异常终止：', error)
  process.exitCode = 1
})
