// Run on stdin inside the deployed API container; reads routing only, no paid generation.
import assert from 'node:assert/strict'
import pg from 'pg'
import { GenerationApiRoutesService } from './dist/services/generation-api-routes.service.js'
const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
await client.connect()
try {
  const db = { $queryRaw: async (_strings, lane) => (await client.query('SELECT lane,enabled,encrypted_key,model FROM generation_api_routes WHERE lane=$1', [lane])).rows }
  const service = new GenerationApiRoutesService(db, { sessionSecret: process.env.SESSION_SECRET_KEY, baseUrl: process.env.NINEROUTER_BASE_URL, standardKey: process.env.NINEROUTER_API_KEY, timeoutMs: 10000, resultOrigins: [] })
  const routes = await service.list()
  const originalFetch = globalThis.fetch
  const captured = []
  let fastRequest
  try {
    globalThis.fetch = async (url, init) => {
      const body = JSON.parse(init.body)
      captured.push({ url, body })
      if (body.model.startsWith('openai/')) fastRequest = { url, headers: init.headers, body }
      return new Response('', { status: 400 })
    }
    for (const lane of ['standard', 'fast']) {
      const route = routes.find(row => row.lane === lane)
      assert.ok(route.ready, lane + ' must be enabled/configured')
      assert.equal(route.credits, lane === 'fast' ? 100 : 50)
      assert.equal(route.quality, 'low')
      await assert.rejects((await service.provider(lane)).generate(Buffer.from('synthetic'), 'routing smoke test', 'unused', { bytes: Buffer.from('synthetic'), width: 1024, height: 1536 }), { code: 'AI_PROVIDER_ERROR' })
      const sent = captured.at(-1)
      assert.equal(sent.url, process.env.NINEROUTER_BASE_URL.replace(/\/$/, '') + '/images/generations')
      assert.ok(sent.body.model.startsWith(lane === 'fast' ? 'openai/' : 'cx/'))
      assert.equal(sent.body.quality, 'low')
      assert.equal(sent.body.images.length, 2)
    }
  } finally { globalThis.fetch = originalFetch }
  // Invalid image must be rejected before the gateway calls OpenAI. This checks
  // that the live adapter processes references; the old adapter silently omitted them.
  const invalid = { ...fastRequest.body, quality: 'invalid-smoke-quality', images: ['data:image/png;base64,!invalid!'] }
  const response = await originalFetch(fastRequest.url, { method: 'POST', headers: fastRequest.headers, body: JSON.stringify(invalid), signal: AbortSignal.timeout(15000) })
  const detail = await response.text()
  assert.equal(response.status, 400, 'gateway must reject malformed reference locally')
  assert.match(detail, /Invalid image reference encoding/, 'live gateway must process the reference instead of dropping it')
  console.log(JSON.stringify({ status: 'PASS', lanes: routes.map(({ lane, model, credits, quality }) => ({ lane, model, credits, quality })), gatewayReferenceValidation: 'PASS', paidGeneration: false }))
} finally { await client.end() }
