import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

test('Photo controls render only for available results and disappear after deletion', async () => {
  const vite = await createServer({ configFile: false, plugins: [react()], server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
  try {
    const { CreationCard } = await vite.ssrLoadModule('/src/components/customer/AccountCenter.jsx')
    const { default: AdminResultPhoto } = await vite.ssrLoadModule('/src/components/admin/AdminResultPhoto.jsx')
    const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props))
    const item = { id: 'result', result_id: 'result', job_id: 'job', title: 'Test portrait', status: 'COMPLETED', mode: 'CLASSIC', image_url: '/api/results/result/image', download_url: '/api/results/result/download' }
    assert.match(render(CreationCard, { item, onDeleted: () => {} }), /Delete photo/)
    assert.match(render(CreationCard, { item, onDeleted: () => {} }), /Photo Booth/)
    assert.doesNotMatch(render(CreationCard, { item: { ...item, result_id: null, image_url: null, download_url: null, status: 'QUEUED' }, onDeleted: () => {} }), /Delete photo/)
    const generation = { job_id: 'job', result_id: 'result', result_image_url: '/api/admin/usage/generations/job/result/image', result_download_url: '/api/admin/usage/generations/job/result/download' }
    const admin = render(AdminResultPhoto, { generation, onDeleted: () => {} })
    assert.match(admin, /Hapus foto/)
    assert.match(admin, /Download foto/)
    const deleted = render(AdminResultPhoto, { generation: { ...generation, result_deleted_at: '2026-10-02' }, onDeleted: () => {} })
    assert.match(deleted, /Foto sudah dihapus/)
    assert.doesNotMatch(deleted, /Hapus foto|Download foto|<img/)
  } finally { await vite.close() }
})
