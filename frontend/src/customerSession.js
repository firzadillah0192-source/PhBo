const FLOW_KEY = 'photobooth:active-customer-flow'
const ALLOWED_FIELDS = new Set(['uploadId', 'mode', 'templateId', 'experienceId', 'layoutId', 'frameStyleId', 'ornamentIds', 'captureUploadIds', 'stage', 'jobId', 'resultId'])
const ALLOWED_STAGES = new Set(['gallery', 'art-direction', 'photo', 'review', 'processing', 'failed', 'result'])

function sessionStorageOrNull(storage) {
  if (storage !== undefined) return storage
  try { return globalThis.sessionStorage } catch { return null }
}

function normalizeFlow(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const flow = {}
  for (const [key, item] of Object.entries(value)) {
    if (!ALLOWED_FIELDS.has(key)) continue
    if (item === null) {
      flow[key] = null
    } else if (key === 'mode' && (item === 'CLASSIC' || item === 'BASIC' || item === 'ADVANCED')) {
      flow[key] = item
    } else if ((key === 'ornamentIds' || key === 'captureUploadIds') && Array.isArray(item) && item.length <= 20 && item.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 256)) {
      flow[key] = item
    } else if (key === 'stage' && ALLOWED_STAGES.has(item)) {
      flow[key] = item
    } else if (key !== 'mode' && key !== 'stage' && typeof item === 'string' && item.length > 0 && item.length <= 256) {
      flow[key] = item
    }
  }
  return Object.keys(flow).length ? flow : null
}

export function readCustomerFlow(storage) {
  const target = sessionStorageOrNull(storage)
  if (!target) return null
  try {
    const raw = target.getItem(FLOW_KEY)
    return raw ? normalizeFlow(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

export function updateCustomerFlow(patch, storage) {
  const target = sessionStorageOrNull(storage)
  if (!target) return null
  const previous = readCustomerFlow(target) || {}
  const next = normalizeFlow({ ...previous, ...patch })
  try {
    if (next) target.setItem(FLOW_KEY, JSON.stringify(next))
    else target.removeItem(FLOW_KEY)
  } catch {
    return null
  }
  return next
}

export function clearCustomerFlow(storage) {
  const target = sessionStorageOrNull(storage)
  if (!target) return
  try { target.removeItem(FLOW_KEY) } catch {}
}

export function customerFlowKey() {
  return FLOW_KEY
}
