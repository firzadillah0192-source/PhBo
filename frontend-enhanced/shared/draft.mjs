const KEY = 'nxbooth:v2:customer-draft'
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
export function readDraft(storage) {
  try {
    storage ??= globalThis.sessionStorage
    const value = JSON.parse(storage.getItem(KEY))
    if (!value || !['classic', 'basic', 'advanced'].includes(value.mode)) return null
    if (!Array.isArray(value.uploads) || value.uploads.length > 4 || value.uploads.some(row => !id(row?.upload_id))) return null
    for (const key of ['templateId', 'styleId', 'frameId', 'layoutId']) if (value[key] && !id(value[key])) return null
    if (!Array.isArray(value.ornaments) || value.ornaments.some(item => !id(item))) return null
    if (value.eventName != null && (typeof value.eventName !== 'string' || value.eventName.length > 80)) return null
    return value
  } catch { return null }
}
export function saveDraft(value, storage) {
  try { storage ??= globalThis.sessionStorage; storage.setItem(KEY, JSON.stringify({ ...value, uploads: value.uploads.map(row => ({ upload_id: row.upload_id, captured_at: row.captured_at })) })) } catch {}
}
