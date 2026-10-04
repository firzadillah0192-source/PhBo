const modes = ['CLASSIC','BASIC','ADVANCED']
const safeId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
export function readKioskFlow(code,storage) {
  try {
    const value = JSON.parse(storage.getItem(`nxbooth:kiosk-photo:${code}`))
    if (!value || !modes.includes(value.mode)) return null
    return { mode: value.mode,selectionId: safeId(value.selectionId) ? value.selectionId : null,
      frameStyleId: safeId(value.frameStyleId) ? value.frameStyleId : null,
      ornamentIds: Array.isArray(value.ornamentIds) ? value.ornamentIds.filter(safeId).slice(0,20) : [],
      photoIds: Array.isArray(value.photoIds) ? value.photoIds.filter(id => /^[a-f0-9]{32}$/.test(id)).slice(0,4) : [],
      jobId: /^[a-f0-9]{32}$/.test(value.jobId) ? value.jobId : null,
      requestKey: safeId(value.requestKey) ? value.requestKey : null }
  } catch { return null }
}
export function saveKioskFlow(code,flow,storage) {
  try {
    // Persist only validated selection/job identifiers, never photos or credentials.
    storage.setItem(`nxbooth:kiosk-photo:${code}`,JSON.stringify({ mode: flow.mode,selectionId: flow.selectionId,
      frameStyleId: flow.frameStyleId,ornamentIds: flow.ornamentIds,photoIds: flow.photoIds,jobId: flow.jobId,requestKey: flow.requestKey }))
  } catch {}
}
