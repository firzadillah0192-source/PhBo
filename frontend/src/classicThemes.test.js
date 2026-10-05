import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { classicThemes, layoutsForTheme } from './components/customer/classicThemes.js'
import { readCustomerFlow, updateCustomerFlow } from './customerSession.js'

const frames = JSON.parse(readFileSync(new URL('../../backend/app/data/classic_event_frames.json', import.meta.url))).frames
const layouts = [{ id: 'classic-frame-001', name: 'Original', shot_count: 4 }, ...frames.map((item) => ({ ...item, preview_url: `/api/classic/layouts/${item.id}/preview` }))]

test('all 35 Classic templates use the frozen 1:3 master and print profile', () => {
  const originals = JSON.parse(readFileSync(new URL('../../backend/app/data/classic_original_strip_frames.json', import.meta.url))).frames
  const profile = JSON.parse(readFileSync(new URL('../../backend/app/data/classic_print_profile.json', import.meta.url)))
  assert.equal(profile.frozen, true)
  assert.deepEqual(profile.master, { width: 1200, height: 3600, dpi: 600 })
  assert.deepEqual(profile.print, { width: 600, height: 1800, dpi: 300 })
  assert.equal(originals.length + frames.length, 35)
  for (const frame of [...originals, ...frames]) {
    assert.equal(frame.canvas_width, 1200)
    assert.equal(frame.canvas_height, 3600)
    assert.equal(frame.print_profile, profile.id)
    assert.equal(frame.slots.length, frame.shot_count)
  }
})

test('eight event themes each contain four frames, half three-shot and half four-shot', () => {
  assert.equal(frames.length, 32)
  assert.equal(new Set(frames.map((item) => item.id)).size, 32)
  const themes = classicThemes(frames)
  assert.equal(themes.length, 8)
  assert.ok(themes.every((item) => item.count === 4))
  assert.equal(frames.filter((item) => item.shot_count === 3).length, 16)
  assert.equal(frames.filter((item) => item.shot_count === 4).length, 16)
  for (const theme of themes) assert.equal(layoutsForTheme(layouts, theme.slug).length, 4)
  assert.equal(layoutsForTheme(layouts, 'all').length, 33)
  assert.equal(layoutsForTheme(layouts, 'classic-originals')[0].id, 'classic-frame-001')
  assert.deepEqual(layoutsForTheme(layouts, 'unknown'), [])
})

test('event frame selection IDs survive session recovery', () => {
  const values = new Map()
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }
  for (const frame of frames) {
    updateCustomerFlow({ mode: 'CLASSIC', layoutId: frame.id, stage: 'photo' }, storage)
    assert.equal(readCustomerFlow(storage).layoutId, frame.id)
  }
})

test('Classic event gallery renders themes, previews, shot counts and selection boundary', async () => {
  const vite = await createServer({ configFile: false, plugins: [react()], server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
  try {
    const Browser = (await vite.ssrLoadModule('/src/components/customer/ClassicFrameBrowser.jsx')).default
    const html = renderToStaticMarkup(React.createElement(Browser, { layouts, selectedId: frames[0].id }))
    assert.match(html, /Frame themes/)
    assert.match(html, /Wedding Padang \/ Minang/)
    assert.match(html, /Ulang Tahun/)
    assert.match(html, /3 Photos/)
    assert.match(html, /4 Photos/)
    assert.match(html, /classic-eid-fitri-001\/preview/)
    assert.doesNotMatch(html, /selection-dock|Continue to camera/)
    const invalid = renderToStaticMarkup(React.createElement(Browser, { layouts, selectedId: 'not-published' }))
    assert.doesNotMatch(invalid, /classic-layout-card is-selected/)
    assert.match(invalid, /classic-layout-card/)
  } finally { await vite.close() }
})
