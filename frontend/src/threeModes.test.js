import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

import { createGeneration } from './api.js'
import { runClassicCaptureSequence } from './classicSequence.js'
import { parseCustomerRoute } from './customerRoute.js'
import { readCustomerFlow, updateCustomerFlow } from './customerSession.js'

function memoryStorage() {
  const values = new Map()
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }
}

test('Classic countdown captures metadata shot count in order', async () => {
  const ticks = []
  const progress = []
  const uploads = await runClassicCaptureSequence(3, {
    tick: async (count, shot) => ticks.push([shot, count]),
    capture: async (shot) => `photo-${shot}`,
    upload: async (photo) => ({ upload_id: `upload-${photo}` }),
    pause: async () => {},
    progress: (count) => progress.push(count),
  })
  assert.deepEqual(ticks, [[0, 3], [0, 2], [0, 1], [1, 3], [1, 2], [1, 1], [2, 3], [2, 2], [2, 1]])
  assert.deepEqual(progress, [1, 2, 3])
  assert.deepEqual(uploads.map((item) => item.upload_id), ['upload-photo-0', 'upload-photo-1', 'upload-photo-2'])
})

test('routes and refresh storage retain all three modes and selection IDs', () => {
  for (const mode of ['classic', 'basic', 'advanced']) assert.equal(parseCustomerRoute('/create', `?mode=${mode}`).mode, mode.toUpperCase())
  const storage = memoryStorage()
  updateCustomerFlow({ mode: 'CLASSIC', layoutId: 'classic-frame-003', captureUploadIds: ['a', 'b', 'c'], stage: 'photo' }, storage)
  assert.equal(readCustomerFlow(storage).layoutId, 'classic-frame-003')
  updateCustomerFlow({ mode: 'ADVANCED', experienceId: 'mini-me', frameStyleId: 'modern', ornamentIds: ['sparkles'], uploadId: 'upload-1', stage: 'review' }, storage)
  assert.deepEqual(readCustomerFlow(storage).ornamentIds, ['sparkles'])
  assert.equal(readCustomerFlow(storage).frameStyleId, 'modern')
  assert.equal(readCustomerFlow(storage).uploadId, 'upload-1')
})

test('generation payloads follow Classic, Basic, and Advanced contracts', async () => {
  const originalFetch = globalThis.fetch
  const bodies = []
  globalThis.fetch = async (_url, options) => { bodies.push(JSON.parse(options.body)); return { ok: true, text: async () => '{}' } }
  try {
    await createGeneration('a', 'CLASSIC', null, null, { layoutId: 'classic-frame-003', captureUploadIds: ['a', 'b', 'c'] })
    await createGeneration('a', 'BASIC', 'sci-fi-space-commander-framed-001')
    await createGeneration('a', 'ADVANCED', null, 'mini-me', { frameStyleId: 'modern', ornamentIds: ['sparkles'] })
  } finally { globalThis.fetch = originalFetch }
  assert.deepEqual(bodies[0], { upload_id: 'a', mode: 'CLASSIC', layout_id: 'classic-frame-003', capture_upload_ids: ['a', 'b', 'c'] })
  assert.deepEqual(bodies[1], { upload_id: 'a', mode: 'BASIC', template_id: 'sci-fi-space-commander-framed-001' })
  assert.deepEqual(bodies[2], { upload_id: 'a', mode: 'ADVANCED', experience_id: 'mini-me', frame_style_id: 'modern', ornament_ids: ['sparkles'] })
})

test('customer screens render all three choices and their required steps', async () => {
  const vite = await createServer({ configFile: false, plugins: [react()], server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
  try {
    const ModeSelector = (await vite.ssrLoadModule('/src/components/home/ModeSelector.jsx')).default
    const ExperienceBrowser = (await vite.ssrLoadModule('/src/components/customer/ExperienceBrowser.jsx')).default
    const AdvancedOptionsStage = (await vite.ssrLoadModule('/src/components/customer/AdvancedOptionsStage.jsx')).default
    const ReviewStage = (await vite.ssrLoadModule('/src/components/customer/ReviewStage.jsx')).default
    const modes = renderToStaticMarkup(React.createElement(ModeSelector, { onSelect: () => {} }))
    assert.match(modes, />Classic</); assert.match(modes, />Basic</); assert.match(modes, />Advanced</)
    const classic = renderToStaticMarkup(React.createElement(ExperienceBrowser, { mode: 'CLASSIC', layouts: [{ id: 'classic-frame-003', name: 'Classic Frame 3', shot_count: 3, preview_url: '/frame.png' }], selectedId: 'classic-frame-003', onSelect: () => {}, onContinue: () => {} }))
    assert.match(classic, /3 Photos/); assert.match(classic, /classic-layout-card/); assert.doesNotMatch(classic, /selection-dock|Continue to camera/)
    const basic = renderToStaticMarkup(React.createElement(ExperienceBrowser, { mode: 'BASIC', templates: [{ id: 'framed', name: 'Framed Basic Template', preview_url: '/basic.png' }], selectedId: 'framed', onSelect: () => {}, onContinue: () => {} }))
    assert.match(basic, /Framed Basic Template/); assert.match(basic, /Continue →/); assert.doesNotMatch(basic, /selection-dock|＋/)
    const advanced = renderToStaticMarkup(React.createElement(AdvancedOptionsStage, { experience: { name: 'Mini Me', max_ornaments: 3 }, frameStyles: [{ id: 'modern', name: 'Modern', description: 'Clean' }], ornaments: [{ id: 'sparkles', name: 'Sparkles' }], frameStyleId: 'modern', ornamentIds: ['sparkles'], onFrameStyle: () => {}, onOrnaments: () => {}, onBack: () => {}, onContinue: () => {} }))
    assert.match(advanced, /Frame style/); assert.match(advanced, /Sparkles/)
    for (const id of ['natural', 'modern', 'minimal', 'luxury', 'retro', 'film', 'cute', 'editorial', 'futuristic', 'artistic']) {
      const thumbnail = renderToStaticMarkup(React.createElement(AdvancedOptionsStage, { experience: { name: 'Published world', thumbnail: '/api/experiences/world/thumbnail' }, frameStyles: [{ id, slug: id, name: id }], ornaments: [], frameStyleId: id, ornamentIds: [] }))
      assert.match(thumbnail, new RegExp(`frame-preview-${id}`))
      assert.match(thumbnail, /<svg/)
      assert.match(thumbnail, /src="\/api\/experiences\/world\/thumbnail"/)
    }
    const review = renderToStaticMarkup(React.createElement(ReviewStage, { mode: 'ADVANCED', upload: { upload_id: 'a' }, selection: { name: 'Mini Me' }, frameStyle: { name: 'Modern' }, ornaments: [{ name: 'Sparkles' }], onCreate: () => {} }))
    assert.match(review, /Experience/); assert.match(review, /Frame style/); assert.match(review, /Ornaments/); assert.match(review, /Photo/)
  } finally { await vite.close() }
})
