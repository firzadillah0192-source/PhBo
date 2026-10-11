import test from 'node:test'
import assert from 'node:assert/strict'
import { readDraft, saveDraft } from './draft.mjs'
test('draft restoration stores references, never photo bytes, and rejects invalid modes/uploads', () => {
  let contents; const storage = { getItem: () => contents, setItem: (_, value) => { contents = value } }
  saveDraft({ mode: 'classic', uploads: [{ upload_id: 'u1', captured_at: '2026-10-11T00:00:00Z', rawImage: 'private bytes' }], ornaments: [], layoutId: 'layout' }, storage)
  assert.equal(readDraft(storage).uploads[0].upload_id, 'u1'); assert.ok(!contents.includes('private bytes'))
  contents = JSON.stringify({ mode: 'invalid', uploads: [], ornaments: [] }); assert.equal(readDraft(storage), null)
  contents = JSON.stringify({ mode: 'classic', uploads: [{ upload_id: '../private' }], ornaments: [] }); assert.equal(readDraft(storage), null)
})
