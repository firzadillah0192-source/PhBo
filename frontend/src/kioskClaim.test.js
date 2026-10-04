import test from 'node:test'
import assert from 'node:assert/strict'
import { parseCustomerRoute } from './customerRoute.js'
import { readKioskFlow,saveKioskFlow } from './kioskClaimSession.js'
import { kioskRequest,generateKioskPhoto,kioskDelivery,scopeKioskCatalog } from './nativeKioskApi.js'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

test('Kiosk photo claims and shared Result claims keep separate deep links', () => {
  assert.equal(parseCustomerRoute('/claim/'+'c'.repeat(24)).name,'photo-claim')
  assert.equal(parseCustomerRoute('/r/shared-result-token').name,'claim')
  assert.equal(parseCustomerRoute('/kiosk/create','?mode=classic').mode,'CLASSIC')
  assert.equal(parseCustomerRoute('/admin').name,'home') // Admin is dispatched by App.
});

test('Kiosk refresh preserves safe selection identifiers and request key without storing credentials', () => {
  const entries = new Map(), storage = { getItem: key => entries.get(key),setItem: (key,value) => entries.set(key,value) }
  const flow = { mode: 'ADVANCED',selectionId: 'mini-me',frameStyleId: 'modern',ornamentIds: ['sparkles'],photoIds: ['a'.repeat(32)],jobId: 'b'.repeat(32),requestKey: 'retry-on-refresh',token: 'private-token',bytes: 'photo-bytes' }
  saveKioskFlow('code',flow,storage)
  const restored = readKioskFlow('code',storage)
  for (const field of ['mode','selectionId','frameStyleId','requestKey','jobId']) assert.equal(restored[field],flow[field])
  assert.deepEqual(restored.ornamentIds,flow.ornamentIds); assert.deepEqual(restored.photoIds,flow.photoIds)
  assert.ok(!entries.get('nxbooth:kiosk-photo:code').includes('private-token'))
  assert.ok(!entries.get('nxbooth:kiosk-photo:code').includes('photo-bytes'))
  assert.equal(readKioskFlow('code',{ getItem: () => 'invalid JSON' }),null)
  assert.doesNotThrow(() => saveKioskFlow('code',flow,{ setItem: () => { throw new Error('blocked') } }))
});

test('Kiosk requests use private session cookies, no cache, and the same durable key on retry', async () => {
  const original = globalThis.fetch, calls = []
  globalThis.fetch = async (url,options) => { calls.push({ url,options }); return { ok: true,json: async () => ({ data: { id: 'job' } }) } }
  try {
    await generateKioskPhoto({ mode: 'BASIC',templateId: 'published' },'repeat-key')
    await generateKioskPhoto({ mode: 'BASIC',templateId: 'published' },'repeat-key')
    for (const call of calls) { assert.equal(call.url,'/api/v1/generations'); assert.equal(call.options.credentials,'same-origin'); assert.equal(call.options.cache,'no-store'); assert.equal(call.options.headers['Idempotency-Key'],'repeat-key'); assert.equal(call.options.headers['X-API-Key'],undefined) }
    assert.equal(kioskDelivery.resultImageUrl('result'),'/api/v1/results/result/image')
    globalThis.fetch = async () => ({ ok: false,status: 410,json: async () => ({ detail: { error_code: 'SESSION_EXPIRED',message: 'Expired' } }) })
    await assert.rejects(kioskRequest('/photo-sessions/code'),error => error.status === 410 && error.errorCode === 'SESSION_EXPIRED')
  } finally { globalThis.fetch = original }
});

test('Kiosk browser entry renders through App on phone and tablet sizes', async () => {
  const server = await createServer({ configFile: false,plugins: [react()],server: { middlewareMode: true },appType: 'custom',logLevel: 'silent' })
  const original = globalThis.window
  try {
    const App = (await server.ssrLoadModule('/src/App.jsx')).default
    for (const width of [390,768,1024]) {
      globalThis.window = { location: { pathname: '/claim/'+'c'.repeat(24),search: '' },innerWidth: width,sessionStorage: { getItem: () => null } }
      const html = renderToStaticMarkup(React.createElement(App))
      assert.match(html,/Opening your photographs/); assert.match(html,/NXBooth/)
      assert.doesNotMatch(html,/Moments, made|Photobooth AI|X-API-Key/)
    }
  } finally { globalThis.window = original; await server.close() }
});
test('Kiosk event restrictions filter published catalogs without changing the web catalog', () => {
  const catalog = { layouts: [{ id: 'one' },{ id: 'two' }],templates: [{ id: 'allowed' },{ id: 'outside' }],experiences: [{ id: 'world' }] }
  const scoped = scopeKioskCatalog(catalog,{ classicLayoutId: 'one',allowedTemplateIds: ['allowed'],allowedExperienceIds: [] })
  assert.deepEqual(scoped.layouts,[{ id: 'one' }]); assert.deepEqual(scoped.templates,[{ id: 'allowed' }]); assert.deepEqual(scoped.experiences,[])
  assert.equal(catalog.templates.length,2)
  assert.deepEqual(scopeKioskCatalog(catalog,{}),catalog)
});
