const STORAGE_KEY = 'nxbooth:pending-generation-requests'
const memory = new Map()
const failedStorage = new WeakSet()
const keyPattern = /^[A-Za-z0-9_-]{1,128}$/
function storageTarget(storage) {
  if (storage!==undefined) return storage
  try { return globalThis.sessionStorage ?? null } catch { return null }
}
function read(storage) {
  if (!storage || failedStorage.has(storage)) return [...memory.values()]
  try {
    const rows = JSON.parse(storage.getItem(STORAGE_KEY) || '[]')
    return Array.isArray(rows) ? rows.filter(row => row && keyPattern.test(row.key) && typeof row.payload==='string' && row.payload.length<20000 && (row.jobId==null || typeof row.jobId==='string')).slice(-20) : []
  } catch { return [...memory.values()] }
}
function write(rows,storage) {
  memory.clear(); rows.forEach(row => memory.set(row.key,row))
  try { storage?.setItem(STORAGE_KEY,JSON.stringify(rows)) } catch {
    if (storage) failedStorage.add(storage)
  }
}
export function generationRequestKey(body,storage) {
  const target = storageTarget(storage),rows = read(target)
  const payload = JSON.stringify({ mode: body.mode,upload_id: body.upload_id,
    template_id: body.mode==='BASIC' ? body.template_id : null,
    experience_id: body.mode==='ADVANCED' ? body.experience_id : null,
    frame_style_id: body.mode==='ADVANCED' ? body.frame_style_id || 'natural' : null,
    ornament_ids: body.mode==='ADVANCED' ? body.ornament_ids || [] : [],
    layout_id: body.mode==='CLASSIC' ? body.layout_id : null,
    capture_upload_ids: body.mode==='CLASSIC' ? body.capture_upload_ids || [] : [],
  })
  const existing = rows.find(row => row.payload===payload)
  if (existing) return existing.key
  const key = 'web-'+(globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`)
  write([...rows,{ key,payload,jobId: null }].slice(-20),target)
  return key
}
export function associateGenerationRequest(key,jobId,storage) {
  const target = storageTarget(storage)
  write(read(target).map(row => row.key===key ? { ...row,jobId } : row),target)
}
export function settleGenerationRequest(jobId,state,storage) {
  if (!['COMPLETED','FAILED'].includes(state)) return
  const target = storageTarget(storage)
  write(read(target).filter(row => row.jobId!==jobId),target)
}
