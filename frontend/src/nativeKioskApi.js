export async function kioskRequest(path, options = {}) {
  const response = await fetch(`/api/v1${path}`, { credentials: 'same-origin',cache: 'no-store',...options })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(body.detail?.message || body.error?.message || 'The photo session could not be loaded.')
    error.status = response.status
    error.errorCode = body.detail?.error_code || body.error?.code
    throw error
  }
  return body.data
}
const json = (body) => ({ method: 'POST',headers: { 'Content-Type': 'application/json' },body: JSON.stringify(body) })
export const getKioskPhotoSession = (code) => kioskRequest(`/photo-sessions/${encodeURIComponent(code)}`)
export const claimKioskPhotos = (code,token) => kioskRequest(`/photo-sessions/${encodeURIComponent(code)}/claim`,json({ token }))
export const getKioskJob = (id) => kioskRequest(`/generations/${encodeURIComponent(id)}`)
export const getKioskPhotoDelivery = (id) => kioskRequest(`/photos/${encodeURIComponent(id)}/url`)
export const generateKioskPhoto = (body,key) => kioskRequest('/generations',{ ...json(body),headers: { 'Content-Type': 'application/json','Idempotency-Key': key } })
export const getKioskCatalog = async () => {
  const [layouts,templates,experiences,styles,ornaments] = await Promise.all(['frames','templates','experiences','frame-styles','ornaments'].map(path => kioskRequest(`/${path}`)))
  return { layouts,templates,experiences,styles,ornaments }
}
export function scopeKioskCatalog(catalog,session) {
  return { ...catalog,
    layouts: session.classicLayoutId ? catalog.layouts.filter(item => item.id === session.classicLayoutId) : catalog.layouts,
    templates: Array.isArray(session.allowedTemplateIds) ? catalog.templates.filter(item => session.allowedTemplateIds.includes(item.id)) : catalog.templates,
    experiences: Array.isArray(session.allowedExperienceIds) ? catalog.experiences.filter(item => session.allowedExperienceIds.includes(item.id)) : catalog.experiences }
}
export const kioskDelivery = {
  resolveResultImage: (id) => kioskRequest(`/results/${encodeURIComponent(id)}/url`),
  getResult: (id) => kioskRequest(`/results/${encodeURIComponent(id)}`),
  createResultClaim: (id,reuseToken,refresh) => kioskRequest(`/results/${encodeURIComponent(id)}/claim`,json({ reuse_token: reuseToken,refresh })),
  resultImageUrl: (id) => `/api/v1/results/${encodeURIComponent(id)}/image`,
  resultDownloadUrl: (id) => `/api/v1/results/${encodeURIComponent(id)}/download`,
  uploadPreviewUrl: (id) => `/api/v1/photos/${encodeURIComponent(id)}`,
}
