import test from 'node:test'
import assert from 'node:assert/strict'
import { startGenerationPolling } from './generationPolling.js'
import { getGeneration, getTemplates, createGeneration } from './api.js'

const tick = () => new Promise((resolve) => setImmediate(resolve))

test('generation reads bypass caches, use distinct URLs, and preserve POST contracts', async () => {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return { ok: true, text: async () => '{}' } }
  try {
    await getGeneration('job-1'); await getGeneration('job-1'); await getTemplates()
    assert.notEqual(calls[0].url, calls[1].url)
    for (const call of calls) {
      assert.equal(call.options.cache, 'no-store')
      assert.equal(call.options.credentials, 'include')
      assert.ok(new URL(call.url, 'https://test.local').searchParams.get('_request'))
    }
    await createGeneration('upload-1', 'BASIC', 'framed-1')
    assert.equal(calls[3].url, '/api/generations')
    assert.equal(JSON.parse(calls[3].options.body).template_id, 'framed-1')
  } finally { globalThis.fetch = original }
})

test('serial polling reaches a completed Result and stops without extra requests', async () => {
  const states = ['QUEUED', 'PROCESSING', 'COMPLETED']
  const seen = []
  let next
  startGenerationPolling({ fetchStatus: async () => ({ state: states.shift(), result_id: 'result-1' }), onStatus: (status) => seen.push(status.state), onError: assert.fail, schedule: (callback) => { next = callback }, cancel: () => {} })
  await tick(); await next(); await tick(); await next(); await tick()
  assert.deepEqual(seen, ['QUEUED', 'PROCESSING', 'COMPLETED'])
  assert.deepEqual(states, [])
})

test('a disconnected poll retries and cannot strand Generate after a transient failure', async () => {
  let attempts = 0
  let next
  const seen = []
  startGenerationPolling({ fetchStatus: async () => { if (++attempts === 1) throw new Error('offline'); return { state: 'COMPLETED' } }, onStatus: (status) => seen.push(status.state), onError: (error) => seen.push(error.message), schedule: (callback) => { next = callback }, cancel: () => {} })
  await tick(); await next(); await tick()
  assert.deepEqual(seen, ['offline', 'COMPLETED'])
})

test('leaving a job ignores its late response and cancels future polls', async () => {
  let respond
  const stop = startGenerationPolling({ fetchStatus: () => new Promise((resolve) => { respond = resolve }), onStatus: assert.fail, onError: assert.fail, schedule: assert.fail, cancel: () => {} })
  stop(); respond({ state: 'COMPLETED' }); await tick()
})

test('a failed generation or inaccessible session stops polling honestly', async () => {
  for (const fail of [false, true]) {
    const seen = []
    startGenerationPolling({ fetchStatus: async () => { if (fail) throw Object.assign(new Error('not found'), { status: 404 }); return { state: 'FAILED' } }, onStatus: (value) => seen.push(value.state), onError: (error) => seen.push(error.status), schedule: assert.fail, cancel: () => {} })
    await tick(); assert.deepEqual(seen, [fail ? 404 : 'FAILED'])
  }
})
