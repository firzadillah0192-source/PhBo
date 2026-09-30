import assert from 'node:assert/strict'
import test from 'node:test'
import { createGeneration, getUpload, uploadPreviewUrl } from './api.js'
import { clearCustomerFlow, customerFlowKey, readCustomerFlow, updateCustomerFlow } from './customerSession.js'

function memoryStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

test('upload survives customer navigation and back navigation with only its opaque id persisted', () => {
  const storage = memoryStorage()
  updateCustomerFlow({
    uploadId: 'opaque-upload-id',
    mode: 'BASIC',
    templateId: 'sci-fi-space-commander-001',
    stage: 'review',
  }, storage)

  // Moving into the gallery and returning to review changes only the route stage.
  updateCustomerFlow({ stage: 'gallery' }, storage)
  updateCustomerFlow({ stage: 'review' }, storage)
  assert.deepEqual(readCustomerFlow(storage), {
    uploadId: 'opaque-upload-id',
    mode: 'BASIC',
    templateId: 'sci-fi-space-commander-001',
    stage: 'review',
  })

  const serialized = storage.getItem(customerFlowKey())
  assert.equal(serialized.includes('base64'), false)
  assert.equal(serialized.includes('storage_path'), false)
  assert.equal(serialized.includes('blob:'), false)
  assert.equal(serialized.includes('file'), false)
})

test('refresh reads the saved upload id and API restores owner-checked server metadata', async () => {
  const storage = memoryStorage()
  updateCustomerFlow({ uploadId: 'upload-123', mode: 'ADVANCED', experienceId: 'mini-me', stage: 'review' }, storage)
  const flowAfterRefresh = readCustomerFlow(storage)
  assert.equal(flowAfterRefresh.uploadId, 'upload-123')

  const originalFetch = globalThis.fetch
  let requestedUrl = ''
  try {
    globalThis.fetch = async (url, options) => {
      requestedUrl = url
      assert.equal(options.credentials, 'include')
      return {
        ok: true,
        text: async () => JSON.stringify({ upload_id: 'upload-123', preview_url: '/api/uploads/upload-123/preview' }),
      }
    }
    const upload = await getUpload(flowAfterRefresh.uploadId)
    assert.equal(new URL(requestedUrl, 'https://nxbooth.test').pathname, '/api/uploads/upload-123')
    assert.ok(new URL(requestedUrl, 'https://nxbooth.test').searchParams.get('_request'))
    assert.equal(upload.preview_url, '/api/uploads/upload-123/preview')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('generation consumes upload_id without requiring a persisted File object', async () => {
  const originalFetch = globalThis.fetch
  let requestBody
  try {
    globalThis.fetch = async (_url, options) => {
      requestBody = JSON.parse(options.body)
      return { ok: true, text: async () => JSON.stringify({ job_id: 'job-123', upload_id: 'upload-123' }) }
    }
    const response = await createGeneration('upload-123', 'BASIC', 'sci-fi-space-commander-001')
    assert.equal(response.upload_id, 'upload-123')
    assert.deepEqual(requestBody, {
      upload_id: 'upload-123',
      mode: 'BASIC',
      template_id: 'sci-fi-space-commander-001',
    })
    assert.equal(Object.hasOwn(requestBody, 'file'), false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('restored portrait preview remains a stable backend URL and flow cleanup only removes the session reference', () => {
  const storage = memoryStorage()
  updateCustomerFlow({ uploadId: 'upload-123', mode: 'BASIC', stage: 'review' }, storage)
  assert.equal(uploadPreviewUrl(readCustomerFlow(storage).uploadId), '/api/uploads/upload-123/preview')
  assert.equal(uploadPreviewUrl('id with / chars'), '/api/uploads/id%20with%20%2F%20chars/preview')
  clearCustomerFlow(storage)
  assert.equal(readCustomerFlow(storage), null)
})
