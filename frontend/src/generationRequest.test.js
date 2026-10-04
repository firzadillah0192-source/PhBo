import test from 'node:test'
import assert from 'node:assert/strict'
import { generationRequestKey,associateGenerationRequest,settleGenerationRequest } from './generationRequest.js'

function fixture() { const entries = new Map(); return { getItem: key => entries.get(key) ?? null,setItem: (key,value) => entries.set(key,value),entries } }
test('blocked storage keeps retry keys in memory for the current page',() => {
  const storage = { getItem: () => null,setItem: () => { throw new Error('quota exceeded') } }
  const body = { mode: 'BASIC',upload_id: 'blocked-storage-photo',template_id: 'template' }
  const first = generationRequestKey(body,storage)
  assert.equal(generationRequestKey(body,storage),first)
  associateGenerationRequest(first,'blocked-job',storage)
  settleGenerationRequest('blocked-job','COMPLETED',storage)
  assert.notEqual(generationRequestKey(body,storage),first)
})
test('lost response and refresh preserve the request key while selection changes create new keys',() => {
  const storage = fixture(),body = { mode: 'ADVANCED',upload_id: 'photo',experience_id: 'world',ornament_ids: [] }
  const first = generationRequestKey(body,storage)
  assert.equal(generationRequestKey(JSON.parse(JSON.stringify(body)),storage),first)
  assert.equal(generationRequestKey({ ...body,frame_style_id: 'natural' },storage),first)
  assert.notEqual(generationRequestKey({ ...body,ornament_ids: ['sparkles'] },storage),first)
  assert.notEqual(generationRequestKey({ ...body,upload_id: 'other' },storage),first)
  associateGenerationRequest(first,'job',storage)
  settleGenerationRequest('job','PROCESSING',storage); assert.equal(generationRequestKey(body,storage),first)
  settleGenerationRequest('job','FAILED',storage); assert.notEqual(generationRequestKey(body,storage),first)
  assert.ok(!JSON.stringify([...storage.entries]).includes('image-bytes'))
})
test('Classic retries preserve ordered photos and successful jobs release their key',() => {
  const storage = fixture(),body = { mode: 'CLASSIC',upload_id: 'a',layout_id: 'frame',capture_upload_ids: ['a','b','c'] }
  const first = generationRequestKey(body,storage)
  assert.notEqual(generationRequestKey({ ...body,capture_upload_ids: ['a','c','b'] },storage),first)
  associateGenerationRequest(first,'classic',storage); settleGenerationRequest('classic','COMPLETED',storage)
  assert.notEqual(generationRequestKey(body,storage),first)
})
test('API sends the same key after a lost response and a new key after terminal status',async () => {
  const originalFetch = globalThis.fetch,originalStorage = globalThis.sessionStorage,keys = []
  globalThis.sessionStorage = fixture()
  let lose = true
  globalThis.fetch = async (url,options) => {
    if (options.method==='POST') {
      keys.push(options.headers['Idempotency-Key'])
      if (lose) { lose = false; throw new TypeError('connection lost') }
      return { ok: true,text: async () => JSON.stringify({ job_id: 'job',state: 'QUEUED' }) }
    }
    return { ok: true,text: async () => JSON.stringify({ job_id: 'job',state: 'FAILED' }) }
  }
  try {
    const api = await import('./api.js')
    await assert.rejects(api.createGeneration('photo','BASIC','template'))
    await api.createGeneration('photo','BASIC','template'); assert.equal(keys[0],keys[1])
    await api.getGeneration('job'); await api.createGeneration('photo','BASIC','template'); assert.notEqual(keys[1],keys[2])
  } finally { globalThis.fetch = originalFetch; globalThis.sessionStorage = originalStorage }
})
