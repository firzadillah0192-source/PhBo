// Isolated UI contract tests: fixture API only. No production mutations or AI calls.
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import http from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'

const root = fileURLToPath(new URL('../', import.meta.url))
const artifacts = '/tmp/nxbooth-v2-ui-check'
await mkdir(artifacts, { recursive: true })
const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://local').pathname
    const app = pathname.startsWith('/v2/admin/') ? 'admin' : pathname.startsWith('/v2/kiosk/') ? 'kiosk' : 'customer'
    const prefix = app === 'customer' ? '/v2/' : `/v2/${app}/`
    const path = pathname.slice(prefix.length)
    let file = resolve(root, app, 'dist', path || 'index.html')
    if (!file.startsWith(resolve(root, app, 'dist') + '/')) throw new Error('Invalid path')
    let data
    try { data = await readFile(file) } catch { file = resolve(root, app, 'dist/index.html'); data = await readFile(file) }
    res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' })[extname(file)] || 'application/octet-stream'); res.end(data)
  } catch { res.writeHead(404); res.end() }
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const origin = `http://127.0.0.1:${server.address().port}`
const installed = '/home/mahez/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell'
const executablePath = process.env.PHBO_V2_CHROMIUM || (existsSync(installed) ? installed : undefined)
const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] })
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOZ0AAAAASUVORK5CYII=', 'base64')
const failures = []
let assertions = 0
async function session({ adminRole = null, kioskAllowed = false, authenticated = false, balance = 50 } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['camera'] })
  const page = await context.newPage(); const errors = []; const requests = []
  let chargeStatus = 'PAID'; const wallet = () => ({ ai_remaining: balance, ai_used: 2, used_this_period: 2, ai_reserved: 0, credit_wallet: {free_remaining: Math.min(balance, 50), top_up_remaining: Math.max(balance - 50, 0), free_allocation: 50, reset_every_days: 14, next_reset_at: '2026-10-25T00:00:00Z'} });
  let uploadCount = 0; let state = 'QUEUED'; let failed = false; let account = authenticated; let role = adminRole; let resultDeleted = false; let lastBody = null; let profile = 'Fixture account'; const adjustmentKeys = []
  page.on('pageerror', e => errors.push(e.message))
  await context.route('**/api/**', async route => {
    const request = route.request(); const url = new URL(request.url()); const method = request.method(); let path = url.pathname.replace('/api', '')
    requests.push({ path, method })
    if (path.includes('/kiosk/web/')) path = path.replace('/kiosk/web', '')
    const body = request.postDataJSON?.bind(request)
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    const error = (code, status) => json({ detail: { error_code: code, message: code } }, status)
    if (/\/(image|preview|thumbnail|download)$/.test(path)) return route.fulfill({ contentType: 'image/png', body: image })
    if (path === '/kiosk/access') return kioskAllowed ? json({ allowed: true }) : error('KIOSK_FORBIDDEN', 403)
    if (path === '/account/me') return json({ authenticated: account, email: account ? 'fixture@example.invalid' : null, display_name: profile })
    if (path === '/account/usage') return json(wallet())
    if (path === '/account/login' || path === '/account/signup') { const data = body(); if (data.password === 'incorrect') return error('INVALID_CREDENTIALS', 401); account = true; return json({ authenticated: true }) }
    if (path === '/account/logout') { account = false; return json({ authenticated: false }) }
    if (path === '/account/profile') { profile = body().display_name; return json({ authenticated: true, display_name: profile }) }
    if (path === '/account/center') return account ? json({ account: { email: 'fixture@example.invalid', display_name: profile }, usage: wallet(), creations: [], sessions: [{ id: 'test-session', is_current: false, created_at: '2026-10-11T00:00:00Z' }], current_plan: { id: 'free', code: 'free', name: 'Free' }, plans: [{ id: 'free', code: 'free', name: 'Free' }], privacy: { retention_message: 'Fixture retention policy', export_available: false, deletion_available: false }, billing: { enabled: false, message: 'Billing is unavailable.' } }) : error('AUTHENTICATION_REQUIRED', 401)
    if (/^\/account\/sessions\/.+\/revoke$/.test(path)) return json({ revoked: true })
    if (path === '/templates') return json({ templates: [{ id: 'theme', name: 'Fixture theme', enabled: true, basic_available: true, preview_url: '/api/templates/theme/preview' }] })
    if (path === '/experiences') return json({ experiences: [{ id: 'experience', name: 'Fixture experience', category: 'Design', thumbnail: '/api/experiences/experience/thumbnail', compatible_frame_style_ids: ['frame'], compatible_ornament_ids: ['stars'], max_ornaments: 1 }] })
    if (path === '/classic/layouts') return json([{ id: 'four', name: 'Four shot fixture', shot_count: 4, requires_event_name: true, preview_url: '/api/classic/layouts/four/preview' }])
    if (path === '/advanced/frame-styles') return json([{ id: 'frame', name: 'Fixture frame', enabled: true }])
    if (path === '/advanced/ornaments') return json([{ id: 'stars', name: 'Stars', enabled: true }])
    if (path === '/uploads') return json({ upload_id: 'synthetic-' + ++uploadCount, width: 640, height: 480 })
    if (path === '/generations' && method === 'POST') { lastBody = body(); assert.ok(request.headers()['idempotency-key']); state = 'QUEUED'; return json({ job_id: 'fixture-job', state }, 202) }
    if (path === '/generations/fixture-job') return json({ job_id: 'fixture-job', state: failed ? 'FAILED' : state, result_id: state === 'COMPLETED' ? 'fixture-result' : null, error_code: failed ? 'AI_PROVIDER_NOT_CONNECTED' : null, credit_charge: { credits: state === 'COMPLETED' ? 23 : null, status: failed ? 'REFUNDED' : state === 'COMPLETED' ? chargeStatus : 'PENDING_RESULT' } })
    if (path === '/results/fixture-result' && method === 'DELETE') { assert.equal(body().confirm, true); resultDeleted = true; return json({ deleted: true }) }
    if (path === '/results/fixture-result') return json({ result_id: 'fixture-result', width: 1200, height: 3600, created_at: '2026-10-11T00:00:00Z', print_download_url: '/api/results/fixture-result/download?rendition=print' })
    if (path === '/results/fixture-result/claim') return json({ claim_url: origin + '/r/' + 'test'.repeat(12), qr_payload: origin + '/r/' + 'test'.repeat(12), expires_at: '2026-10-12T00:00:00Z' })
    if (path.startsWith('/public/results/')) return error('CLAIM_UNAVAILABLE', 404)
    if (path === '/kiosk/session') return json({ session_id: 'fixture-session' })
    if (path === '/admin/me') return role ? json({ authenticated: true, role }) : error('ADMIN_AUTH_REQUIRED', 401)
    if (path === '/admin/login') { if (body().password === 'incorrect') return error('INVALID_CREDENTIALS', 401); role = 'operator'; return json({ authenticated: true }) }
    if (path === '/admin/logout') { role = null; return json({ authenticated: false }) }
    if (path === '/admin/overview') return json({ total_users: 42, successful_generations: 12, failed_generations: 1 })
    if (path === '/admin/users/fixture-user') return json({ user: { id: 'fixture-user', name: 'Fixture user', email: 'fixture@example.invalid', status: 'active' } })
    if (path === '/admin/users/fixture-user/credits' && method === 'POST') { adjustmentKeys.push(body().idempotency_key); if (adjustmentKeys.length === 1) return route.abort('connectionfailed'); return json({ changed: true }) }
    if (path === '/admin/users/fixture-user/credits') return json({ balance: { ai_remaining: 7 }, entries: [] })
    if (['/admin/users/fixture-user/sessions', '/admin/users/fixture-user/generations', '/admin/users/fixture-user/audit', '/admin/plans'].includes(path)) return json([])
    if (path === '/admin/advanced/frame-styles' || path === '/admin/advanced/ornaments') return json([])
    if (path === '/admin/experiences') return json([{ id: 'experience', name: 'Fixture experience', internal_prompt: 'Staff-only fixture prompt', status: 'draft', max_ornaments: 1, preview_missing: true }])
    if (path === '/admin/experiences/experience' && method === 'PATCH') { assert.equal(body().name, 'Edited fixture experience'); return json({ id: 'experience' }) }
    failures.push('Unexpected API request: ' + method + ' ' + path); return error('UNEXPECTED_FIXTURE_REQUEST', 500)
  })
  return { context, page, errors, requests, adjustmentKeys, get body() { return lastBody }, get deleted() { return resultDeleted }, setBalance(value) { balance = value }, complete(status = 'PAID') { state = 'COMPLETED'; chargeStatus = status }, processing() { state = 'PROCESSING' }, fail() { failed = true } }
}
try {
  const s = await session(); const p = s.page
  await p.goto(origin + '/v2/app'); await p.getByRole('heading', { name: 'Make your photobooth moment' }).waitFor()
  await p.screenshot({ path: artifacts + '/customer-desktop.png' })
  await p.getByRole('button', { name: /Classic.*1 credit/ }).click(); await p.getByRole('button', { name: /Four shot fixture/ }).click(); await p.getByRole('button', { name: 'Continue', exact: true }).click()
  assert.equal(await p.locator('input[type=file]').count(), 1); assertions++
  assert.equal(await p.getByRole('button', { name: 'Continue', exact: true }).isDisabled(), true); assertions++
  for (let i = 0; i < 4; i++) { await p.locator('input[type=file]').first().setInputFiles({ name: `synthetic-${i}.png`, mimeType: 'image/png', buffer: image }); await p.getByAltText('Photo ' + (i + 1)).waitFor() }
  await p.getByLabel('Event name').fill('Fixture event'); await p.screenshot({ path: artifacts + '/customer-classic-photos.png' }); await p.getByRole('button', { name: 'Continue', exact: true }).click(); await p.getByRole('button', { name: 'Create my strip' }).click()
  await p.getByRole('heading', { name: 'In line…' }).waitFor(); await p.screenshot({ path: artifacts + '/customer-processing.png' }); assert.equal(s.body.capture_upload_ids.length, 4); assert.equal(s.body.event_name, 'Fixture event'); assertions += 2
  await new Promise(r => setTimeout(r, 4500)); assert.ok(p.url().includes('processing')); assertions++
  s.processing(); await p.getByRole('heading', { name: 'Creating your photo…' }).waitFor(); s.setBalance(49); s.complete(); await p.getByRole('heading', { name: 'Your photo is ready' }).waitFor(); await p.screenshot({ path: artifacts + '/customer-result.png' })
  await p.getByRole('button', { name: 'Share via QR' }).click(); await p.locator('svg[aria-label="Scan to open your photo"]').waitFor(); assertions++
  await p.getByRole('button', { name: 'Close', exact: true }).click(); await p.getByRole('button', { name: 'Delete this photo' }).click(); await p.getByRole('button', { name: 'Delete', exact: true }).click(); await p.waitForURL('**/app/signin'); assert.equal(s.deleted, true); assertions++
  assert.deepEqual(s.errors, []); await s.context.close()

  for (const mode of ['Basic', 'Advanced']) {
    const s = await session(); const p = s.page; await p.goto(origin + '/v2/app'); await p.getByRole('button', { name: new RegExp(mode + '.*Minimum 10 credits') }).click()
    await p.getByRole('button', { name: 'Take photo', exact: true }).click(); await p.waitForFunction(() => document.querySelector('video')?.videoWidth > 0); await p.getByRole('button', { name: 'Capture photo' }).click(); await p.getByAltText('Your photo').waitFor(); await p.getByRole('button', { name: 'Continue', exact: true }).click()
    await p.getByRole('button', { name: mode === 'Basic' ? /Fixture theme/ : /Fixture experience/ }).click()
    if (mode === 'Advanced') { await p.getByRole('radio', { name: 'Fixture frame', exact: true }).click(); await p.getByRole('button', { name: 'Stars', exact: true }).click(); await p.screenshot({ path: artifacts + '/customer-style-advanced.png' }) }
    await p.getByRole('button', { name: 'Continue', exact: true }).click(); await p.getByRole('button', { name: 'Create my photo' }).click(); await p.getByRole('heading', { name: 'In line…' }).waitFor()
    assert.equal(s.body.mode, mode.toUpperCase()); if (mode === 'Advanced') assert.deepEqual(s.body.ornament_ids, ['stars']); assertions++
    s.fail(); await p.getByRole('heading', { name: "We couldn't create this photo" }).waitFor(); if (mode === 'Basic') await p.screenshot({ path: artifacts + '/customer-failed.png' }); assert.ok(p.url().includes('processing')); assert.equal(await p.getByText('Credit returned').count(), 1); assertions += 2
    assert.deepEqual(s.errors, []); await s.context.close()
  }
  const auth = await session(); await auth.page.goto(origin + '/v2/app/signin'); await auth.page.getByLabel('Email', { exact: true }).fill('fixture@example.invalid'); await auth.page.getByLabel('Password', { exact: true }).fill('incorrect'); await auth.page.getByRole('button', { name: 'Sign in', exact: true }).click(); await auth.page.getByText('INVALID_CREDENTIALS', { exact: true }).waitFor(); await auth.page.getByLabel('Password', { exact: true }).fill('correct-password'); await auth.page.getByRole('button', { name: 'Sign in', exact: true }).click(); await auth.page.getByRole('heading', { name: 'My Creations' }).waitFor(); await auth.page.getByRole('link', { name: 'Profile', exact: true }).click(); await auth.page.getByLabel('Display name').fill('Saved fixture'); await auth.page.getByRole('button', { name: 'Save changes' }).click(); await auth.page.getByText('Saved fixture', { exact: true }).waitFor(); assertions += 2; assert.deepEqual(auth.errors, []); await auth.context.close()
  const denied = await session(); await denied.page.goto(origin + '/v2/admin/overview'); await denied.page.getByRole('heading', { name: 'Admin console' }).waitFor(); await denied.page.getByLabel('Email', { exact: true }).fill('admin@example.invalid'); await denied.page.getByLabel('Password', { exact: true }).fill('incorrect'); await denied.page.getByRole('button', { name: 'Sign in', exact: true }).click(); await denied.page.getByText('INVALID_CREDENTIALS', { exact: true }).waitFor(); assertions++; assert.deepEqual(denied.errors, []); await denied.context.close()
  const staff = await session({ adminRole: 'content_manager' }); await staff.page.goto(origin + '/v2/admin/experiences'); await staff.page.getByText('Fixture experience', { exact: true }).waitFor(); assert.equal(await staff.page.getByRole('link', { name: 'Overview', exact: true }).count(), 0); assert.equal(await staff.page.getByLabel('Preview as role').count(), 0); assertions += 2; await staff.page.getByText('Fixture experience', { exact: true }).click(); await staff.page.getByLabel('Name', { exact: true }).waitFor(); await staff.page.getByLabel('Name', { exact: true }).fill('Edited fixture experience'); await staff.page.getByRole('button', { name: 'Save', exact: true }).click(); await staff.page.getByRole('button', { name: 'Save', exact: true }).waitFor({ state: 'detached' }); assertions++; await staff.page.screenshot({ path: artifacts + '/admin-desktop.png' }); assert.deepEqual(staff.errors, []); await staff.context.close()
  const credits = await session({ adminRole: 'operator' }); credits.page.on('dialog', dialog => dialog.accept()); await credits.page.goto(origin + '/v2/admin/users/fixture-user'); await credits.page.getByRole('heading', { name: 'Fixture user' }).waitFor(); await credits.page.screenshot({ path: artifacts + '/admin-user.png' }); await credits.page.getByRole('button', { name: 'Adjust credits' }).click(); await credits.page.screenshot({ path: artifacts + '/admin-dialog.png' }); await credits.page.getByLabel('Reason (required)').fill('Fixture adjustment'); await credits.page.getByLabel('I confirm this credit adjustment').check(); await credits.page.getByRole('button', { name: 'Apply adjustment' }).click(); await credits.page.getByRole('alert').waitFor(); await credits.page.getByRole('button', { name: 'Apply adjustment' }).click(); await credits.page.getByText('Credits updated', { exact: true }).waitFor(); assert.equal(credits.adjustmentKeys.length, 2); assert.equal(credits.adjustmentKeys[0], credits.adjustmentKeys[1]); assertions += 2; assert.deepEqual(credits.errors, []); await credits.context.close()
  const gate = await session(); await gate.page.goto(origin + '/v2/kiosk/kiosk?step=result'); await gate.page.getByRole('heading', { name: 'Kiosk sign-in' }).waitFor(); assert.equal(await gate.page.getByRole('heading', { name: 'Your photo is ready' }).count(), 0); assertions++; assert.deepEqual(gate.errors, []); await gate.context.close()
  const k = await session({ kioskAllowed: true }); await k.page.goto(origin + '/v2/kiosk/kiosk'); await k.page.getByRole('button', { name: 'Tap to start' }).waitFor(); await k.page.screenshot({ path: artifacts + '/kiosk-attract.png' }); await k.page.getByRole('button', { name: 'Tap to start' }).click(); await k.page.getByRole('button', { name: /BASIC.*Minimum 10 credits/ }).waitFor(); await k.page.screenshot({ path: artifacts + '/kiosk-mode.png' }); await k.page.getByRole('button', { name: /BASIC.*Minimum 10 credits/ }).click(); await k.page.locator('input[type=file]').setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: image }); await k.page.getByRole('button', { name: 'Fixture theme' }).waitFor(); await k.page.screenshot({ path: artifacts + '/kiosk-style.png' }); await k.page.getByRole('button', { name: 'Fixture theme' }).click(); await k.page.getByRole('button', { name: 'Create my photo' }).click(); await k.page.getByRole('heading', { name: 'You are in line…' }).waitFor(); assert.equal(k.body.mode, 'BASIC'); assertions++; k.complete(); await k.page.getByRole('heading', { name: 'Your photo is ready' }).waitFor(); await k.page.locator('svg[aria-label="Scan to open your photo"]').waitFor(); assertions++; await k.page.screenshot({ path: artifacts + '/kiosk.png' });
  await k.page.clock.install(); await k.page.clock.fastForward(119_000); assert.equal(await k.page.getByRole('alertdialog', {name:'Still there?'}).count(), 0); assertions++;
  await k.page.clock.fastForward(2_000); await k.page.getByRole('alertdialog', {name:'Still there?'}).waitFor(); assertions++;
  await k.page.getByRole('button', {name:/I'm still here/}).click(); await k.page.getByRole('alertdialog', {name:'Still there?'}).waitFor({state:'detached'});
  await k.page.clock.fastForward(119_000); assert.equal(await k.page.getByRole('alertdialog', {name:'Still there?'}).count(), 0); assertions++;
  await k.page.clock.fastForward(2_000); await k.page.getByRole('alertdialog', {name:'Still there?'}).waitFor();
  await k.page.clock.fastForward(59_000); assert.equal(await k.page.getByRole('alertdialog', {name:'Still there?'}).count(), 1); assertions++;
  await k.page.clock.fastForward(2_000); await k.page.getByRole('button', {name:'Tap to start'}).waitFor(); assertions++;
  assert.deepEqual(k.errors, []); await k.context.close()
  for (const balance of [0, 1, 9, 10]) {
    const low = await session({balance}); await low.page.goto(origin + '/v2/app'); await low.page.getByRole('heading', {name:'Make your photobooth moment'}).waitFor();
    assert.equal(await low.page.getByRole('button', {name:/Classic.*1 credit/}).isDisabled(), balance < 1);
    assert.equal(await low.page.getByRole('button', {name:/Basic.*Minimum 10 credits/}).isDisabled(), balance < 10); assertions += 2; await low.context.close();
  }
  const walletCheck = await session({authenticated:true, balance:63}); await walletCheck.page.goto(origin+'/v2/app/account/credits'); await walletCheck.page.getByRole('heading', {name:'Credits',exact:true}).waitFor();
  await walletCheck.page.getByText(/Free: 50 · Top-up: 13/).waitFor(); await walletCheck.page.getByText('50 free credits, reset every 14 days.').waitFor();
  await walletCheck.page.getByText(/AI requires at least 10 credits to start/).waitFor(); assertions += 3; assert.deepEqual(walletCheck.errors, []); await walletCheck.context.close();
  const pending = await session(); await pending.page.goto(origin+'/v2/app/processing?job=fixture-job'); await pending.page.getByRole('heading',{name:'In line…'}).waitFor(); pending.complete('NEEDS_TOP_UP');
  await pending.page.getByRole('heading',{name:'More credits needed'}).waitFor(); await pending.page.getByText(/This result costs 23 credits/).waitFor(); assert.ok(pending.page.url().includes('processing')); assertions += 2;
  pending.complete('PAID'); pending.setBalance(27); await pending.page.getByRole('heading',{name:'Your photo is ready'}).waitFor(); await pending.page.getByText('27 credits', {exact:true}).waitFor(); assertions++; assert.deepEqual(pending.errors, []); await pending.context.close();
  const mobile = await session(); await mobile.page.setViewportSize({ width: 390, height: 844 }); await mobile.page.goto(origin + '/v2/app'); await mobile.page.getByRole('heading', { name: 'Make your photobooth moment' }).waitFor(); assert.equal(await mobile.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); assertions++; await mobile.page.screenshot({ path: artifacts + '/customer-mobile.png' }); await mobile.page.goto(origin + '/v2/r/' + 'invalid'.repeat(8)); await mobile.page.getByRole('heading', { name: 'This photo is no longer available' }).waitFor(); assertions++; assert.deepEqual(mobile.errors, []); await mobile.context.close()
  assert.deepEqual(failures, [])
  console.log(JSON.stringify({ status: 'PASS', assertions, api: 'isolated fixtures only', production_writes: 0, screenshots: artifacts }))
} finally { await browser.close(); await new Promise(done => server.close(done)) }
