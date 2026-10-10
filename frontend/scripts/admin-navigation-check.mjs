import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

const appBase = process.env.PHOTOBOOTH_TEST_BASE_URL || 'http://127.0.0.1:3000'

const version = await (await fetch('http://127.0.0.1:9223/json/version')).json()
const socket = new WebSocket(version.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
let nextId = 0
const pending = new Map()
const errors = []
const requests = new Map()
socket.onmessage = ({ data }) => {
  const item = JSON.parse(data)
  if (item.id) { const task = pending.get(item.id); pending.delete(item.id); item.error ? task.reject(item.error) : task.resolve(item.result) }
  if (item.method === 'Runtime.exceptionThrown') errors.push(item.params.exceptionDetails.exception?.description || item.params.exceptionDetails.text)
  if (item.method === 'Network.requestWillBeSent') {
    const url = new URL(item.params.request.url)
    if (url.pathname.startsWith('/api/admin/')) requests.set(url.pathname, (requests.get(url.pathname) || 0) + 1)
  }
}
const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++nextId; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
})
const { browserContextId } = await call('Target.createBrowserContext')
try {
  const { targetId } = await call('Target.createTarget', { url: 'about:blank', browserContextId })
  const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true })
  await call('Runtime.enable', {}, sessionId)
  await call('Page.enable', {}, sessionId)
  await call('Network.enable', {}, sessionId)
  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId)
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    return result.result.value
  }
  const wait = async (expression) => {
    for (let attempt = 0; attempt < 150; attempt++) {
      if (await evaluate(expression)) return
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error('Timed out waiting for admin view')
  }
  await call('Page.navigate', { url: `${appBase}/admin` }, sessionId)
  await wait('!!document.querySelector(".admin-gate")')
  const env = await readFile('/opt/photobooth/.env', 'utf8')
  const token = env.match(/^ADMIN_TOKEN=(.*)$/m)[1].trim().replace(/^['"]|['"]$/g, '')
  assert.equal(await evaluate(`fetch('/api/admin/login', {method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body:JSON.stringify({token:${JSON.stringify(token)}})}).then(r=>r.status)`), 200)
  await call('Page.reload', {}, sessionId)
  await wait('!!document.querySelector(".admin-sidebar")')
  for (const name of ['Subscriptions', 'Generations', 'Advanced Experiences', 'Generations', 'Admin Users', 'Generations', 'Classic Layouts', 'Generations', 'Basic Templates', 'Generations', 'Provider Ops / Routing', 'Generations', 'Subscriptions', 'Generations']) {
    await evaluate(`Array.from(document.querySelectorAll('.admin-sidebar nav button')).find(b=>b.textContent===${JSON.stringify(name)}).click()`)
    await new Promise(resolve => setTimeout(resolve, 500))
    const state = await evaluate('({shell:!!document.querySelector(".admin-sidebar"), error:!!document.querySelector(".admin-error-boundary"), rootText:document.getElementById("root").textContent.slice(0,100)})')
    console.log(JSON.stringify({ menu: name, ...state }))
    assert.equal(state.shell, true, 'Admin shell became blank')
    assert.equal(state.error, false, 'Admin section failed')
  }
  assert.deepEqual(errors, [], 'Browser reported JavaScript exceptions')
  assert.equal(requests.get('/api/admin/plans'), 1, 'Returning to Subscriptions should reuse cached plans')
  assert.equal(requests.get('/api/admin/usage/generations'), 2, 'Generation requests should reuse cached data (two distinct filter URLs)')
  await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Refresh data').click()")
  await new Promise(resolve => setTimeout(resolve, 700))
  assert.equal(requests.get('/api/admin/usage/generations'), 3, 'Refresh must make a fresh request')
  const hasPhoto = await evaluate('!!document.querySelector("tr.clickable .admin-result-thumbnail")')
  if (hasPhoto) {
    await evaluate('document.querySelector("tr.clickable .admin-result-thumbnail").closest("tr").click()')
    await wait('!!document.querySelector(".admin-result-photo img")?.naturalWidth')
    assert.equal(await evaluate('Array.from(document.querySelectorAll(".admin-result-photo a")).some(a => a.pathname.endsWith("/download"))'), true)
    const imageUrl = await evaluate('document.querySelector(".admin-result-photo img").getAttribute("src")')
    assert.equal(await evaluate(`fetch(${JSON.stringify(imageUrl + '?thumbnail=true')}).then(r=>r.status)`), 200)
    // Exercise the UI with a mocked DELETE response. Never delete a production photo.
    await evaluate(`(() => {
      const originalFetch = window.fetch.bind(window)
      const deleteUrl = ${JSON.stringify(imageUrl.replace(/\/image$/, ''))}
      window.__photoDeleteCalls = 0
      window.fetch = (url, options = {}) => {
        if ((options.method || 'GET').toUpperCase() === 'DELETE') {
          if (String(url) !== deleteUrl) throw new Error('Unexpected deletion endpoint')
          window.__photoDeleteCalls++
          return Promise.resolve(new Response(JSON.stringify({deleted:true}), {status:200, headers:{'Content-Type':'application/json'}}))
        }
        return originalFetch(url, options)
      }
      window.confirm = () => false
    })()`)
    await evaluate("Array.from(document.querySelectorAll('.admin-result-photo button')).find(b=>b.textContent==='Hapus foto').click()")
    assert.equal(await evaluate('window.__photoDeleteCalls'), 0, 'Cancelling must not send DELETE')
    await evaluate("window.confirm = () => true; Array.from(document.querySelectorAll('.admin-result-photo button')).find(b=>b.textContent==='Hapus foto').click()")
    await wait('document.querySelector(".admin-result-photo [role=status]")?.textContent.includes("sudah dihapus")')
    assert.equal(await evaluate('window.__photoDeleteCalls'), 1)
    assert.equal(await evaluate('!!document.querySelector(".admin-result-photo img")'), false)
    console.log('Admin photo preview/download and mocked deletion confirmation PASS (no production photos deleted)')
  }
  await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Lock session').click()")
  await wait('!!document.querySelector(".admin-gate")')
  assert.deepEqual(errors, [], 'Refresh/logout caused browser exceptions')
  console.log('Memory cache, refresh and logout PASS')
  console.log('Admin navigation PASS')
} catch (error) {
  console.log('Browser exceptions:', JSON.stringify(errors))
  throw error
} finally {
  await call('Target.disposeBrowserContext', { browserContextId })
  socket.close()
}
