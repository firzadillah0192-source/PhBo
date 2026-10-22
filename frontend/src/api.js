import {analyticsHeaders,trackApiOutcome,captureAnalyticsError} from './analytics.js'
/** Single frontend-to-backend API contract. Cookies carry guest/account/admin sessions. */

const BASE = '/api'
import { generationRequestKey,associateGenerationRequest,settleGenerationRequest } from './generationRequest.js'
import { createReadCache } from './adminReadCache.js'

const adminReadCache = createReadCache()
export function clearAdminReadCache() { adminReadCache.clear() }

class ApiError extends Error {
  constructor(status, errorCode, message, detail) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.errorCode = errorCode
    this.detail = detail
  }
}

async function parseError(response) {
  let body = null
  try { body = await response.json() } catch {
    return new ApiError(response.status, 'HTTP_' + response.status, 'Request failed (' + response.status + ')', null)
  }
  const detail = body?.detail ?? body
  if (detail && typeof detail === 'object') {
    return new ApiError(response.status, detail.error_code || 'HTTP_' + response.status, detail.message || 'Request failed', detail.detail ?? null)
  }
  return new ApiError(response.status, 'HTTP_' + response.status, typeof detail === 'string' && detail ? detail : 'Request failed (' + response.status + ')', null)
}

async function request(path, options = {}) {
  const read = !options.method || options.method === 'GET'
  const admin = path.startsWith('/admin/')
  if (admin && !read) {
    clearAdminReadCache()
    try { return await fetchRequest(path, options) } finally { clearAdminReadCache() }
  }
  // Always verify authentication using a live overview request on page startup.
  if (admin && read && path !== '/admin/overview') {
    return adminReadCache.read(path, () => fetchRequest(path, options))
  }
  return fetchRequest(path, options)
}

async function fetchRequest(path, options = {}) {
  // Dynamic JSON must not reuse an edge-cached status or another session's data.
  // A unique query also protects clients while an upstream cache rule is fixed.
  const read = !options.method || options.method === 'GET'
  const nonce = read ? (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`) : null
  const url = BASE + path + (read ? `${path.includes('?') ? '&' : '?'}_request=${encodeURIComponent(nonce)}` : '')
  const response = await fetch(url, { credentials: 'include', cache: 'no-store', ...options,headers:{...analyticsHeaders(),...options.headers} })
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) clearAdminReadCache()
    const error=await parseError(response);if(response.status>=500)captureAnalyticsError(error,{route:path,surface:'web'});throw error
  }
  const text = await response.text()
  const data=text?JSON.parse(text):null;trackApiOutcome(path,options.method||'GET',data,'web');return data
}

export function getHealth() { return request('/health') }
export function getTemplates() { return request('/templates') }
export function getExperiences() { return request('/experiences') }
export function getClassicLayouts() { return request('/classic/layouts') }
export function getFrameStyles() { return request('/advanced/frame-styles') }
export function getOrnaments() { return request('/advanced/ornaments') }
export function getUsage() { return request('/account/usage') }
export function getAccountMe() { return request('/account/me') }
export function getAccountCenter() { return request('/account/center') }
export function createTopUpCheckout(credits, requestKey = globalThis.crypto.randomUUID()) { return request('/account/topups/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestKey }, body: JSON.stringify({ credits }) }) }
export function updateAccountProfile(body) { return request('/account/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) }
export function revokeAccountSession(id) { return request('/account/sessions/' + encodeURIComponent(id) + '/revoke', { method: 'POST' }) }
export function revokeAllAccountSessions() { return request('/account/sessions/revoke-all', { method: 'POST' }) }

export function signup(email, password) {
  return request('/account/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
}

export function login(email, password) {
  return request('/account/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
}

export function logout() { return request('/account/logout', { method: 'POST' }) }

export function uploadPhoto(file) {
  const form = new FormData()
  form.append('file', file)
  return request('/uploads', { method: 'POST', body: form })
}

export function getUpload(uploadId) {
  return request('/uploads/' + encodeURIComponent(uploadId))
}

export async function createGeneration(uploadId, mode, templateId = null, experienceId = null, options = {}) {
  const body = { upload_id: uploadId, mode }
  if (mode === 'CLASSIC') {
    body.layout_id = options.layoutId
    body.capture_upload_ids = options.captureUploadIds
    if (options.eventName) body.event_name = options.eventName
    if (options.capturedAt) body.captured_at = options.capturedAt
  }
  if (Object.hasOwn(options,'folderId')) body.folder_id = options.folderId
  if (mode !== 'CLASSIC' && options.lane) body.lane = options.lane
  if (mode === 'BASIC') body.template_id = templateId
  if (mode !== 'CLASSIC' && options.eventName) body.event_name = options.eventName
  if (mode === 'ADVANCED') {
    body.experience_id = experienceId
    body.frame_style_id = options.frameStyleId
    body.ornament_ids = options.ornamentIds || []
  }
  const key = generationRequestKey(body)
  const job = await request('/generations', { method: 'POST', headers: { 'Content-Type': 'application/json','Idempotency-Key': key }, body: JSON.stringify(body) })
  associateGenerationRequest(key,job.job_id)
  return job
}

export async function getGeneration(jobId) {
  const job = await request('/generations/' + encodeURIComponent(jobId))
  settleGenerationRequest(jobId,job.state)
  return job
}
export function getResult(resultId) { return request('/results/' + encodeURIComponent(resultId)) }
export function deleteResultPhoto(resultId) { return request('/results/' + encodeURIComponent(resultId), { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true }) }) }
export function deleteAdminResultPhoto(jobId) { return request('/admin/usage/generations/' + encodeURIComponent(jobId) + '/result', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true }) }) }
export function startKioskSession(newRun = false) {
  return request('/kiosk/session' + (newRun ? '?new_run=true' : ''), { method: 'POST' })
}
export function createResultClaim(resultId, reuseToken = null, refresh = false, kiosk = false) {
  const body = {}
  if (reuseToken) body.reuse_token = reuseToken
  if (refresh) body.refresh = true
  if (kiosk) body.kiosk = true
  return request('/results/' + encodeURIComponent(resultId) + '/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
export function getPublicResultClaim(token) { return request('/public/results/' + encodeURIComponent(token)) }
export function resultImageUrl(resultId) { return BASE + '/results/' + encodeURIComponent(resultId) + '/image' }
export function resultDownloadUrl(resultId) { return BASE + '/results/' + encodeURIComponent(resultId) + '/download' }
export function uploadPreviewUrl(uploadId) { return BASE + '/uploads/' + encodeURIComponent(uploadId) + '/preview' }

export function loginAdmin(email, password) {
  return request('/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(email ? { email, password } : {}) })
}
export function getAdminMe() { return fetchRequest('/admin/me') }

export function logoutAdmin() { return request('/admin/logout', { method: 'POST' }) }

function adminJson(method, path, body) {
  return request(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

export function getAdminExperiences() { return request('/admin/experiences') }
export function createAdminExperience(body) { return adminJson('POST', '/admin/experiences', body) }
export function updateAdminExperience(id, body) { return adminJson('PATCH', '/admin/experiences/' + encodeURIComponent(id), body) }
export function deleteAdminExperience(id) { return request('/admin/experiences/' + encodeURIComponent(id), { method: 'DELETE' }) }
export function replaceAdminExperienceThumbnail(id, file) {
  const form = new FormData()
  form.append('file', file)
  return request('/admin/experiences/' + encodeURIComponent(id) + '/thumbnail', { method: 'POST', body: form })
}
export function deleteAdminExperienceThumbnail(id) { return request('/admin/experiences/' + encodeURIComponent(id) + '/thumbnail', { method: 'DELETE' }) }
export function getAdminPreviewSources() { return request('/admin/preview-sources') }
export function uploadAdminPreviewSource(id, file) {
  const form = new FormData()
  form.append('file', file)
  return request('/admin/preview-sources/' + encodeURIComponent(id), { method: 'POST', body: form })
}
export function generateAdminExperiencePreview(id) { return request('/admin/experiences/' + encodeURIComponent(id) + '/preview', { method: 'POST' }) }
export function getAdminPreviewJob(id) { return request('/admin/preview-jobs/' + encodeURIComponent(id)) }
export function generateMissingAdminPreviews(body) { return adminJson('POST', '/admin/preview-jobs/generate-missing', body) }
export function publishReadyAdminExperiences(confirm = true) { return adminJson('POST', '/admin/experiences/publish-ready', { confirm }) }
export function getAdminTemplates() { return request('/admin/templates') }
export function getAdminClassicLayouts() { return request('/admin/classic-layouts') }
export function createAdminClassicLayout(body) { return adminJson('POST', '/admin/classic-layouts', body) }
export function updateAdminClassicLayout(id, body) { return adminJson('PATCH', '/admin/classic-layouts/' + encodeURIComponent(id), body) }
export function uploadAdminClassicFrame(id, file) { const form = new FormData(); form.append('file', file); return request('/admin/classic-layouts/' + encodeURIComponent(id) + '/frame', { method: 'POST', body: form }) }
export function getAdminFrameStyles() { return request('/admin/advanced/frame-styles') }
export function createAdminFrameStyle(body) { return adminJson('POST', '/admin/advanced/frame-styles', body) }
export function updateAdminFrameStyle(id, body) { return adminJson('PATCH', '/admin/advanced/frame-styles/' + encodeURIComponent(id), body) }
export function getAdminOrnaments() { return request('/admin/advanced/ornaments') }
export function createAdminOrnament(body) { return adminJson('POST', '/admin/advanced/ornaments', body) }
export function updateAdminOrnament(id, body) { return adminJson('PATCH', '/admin/advanced/ornaments/' + encodeURIComponent(id), body) }
export function createAdminTemplate(body) { return adminJson('POST', '/admin/templates', body) }
export function updateAdminTemplate(id, body) { return adminJson('PATCH', '/admin/templates/' + encodeURIComponent(id), body) }
export function deleteAdminTemplate(id) { return request('/admin/templates/' + encodeURIComponent(id), { method: 'DELETE' }) }
export function replaceAdminTemplateImage(id, file) {
  const form = new FormData()
  form.append('file', file)
  return request('/admin/templates/' + encodeURIComponent(id) + '/image', { method: 'POST', body: form })
}
export function replaceAdminTemplatePreview(id, file) {
  const form = new FormData()
  form.append('file', file)
  return request('/admin/templates/' + encodeURIComponent(id) + '/preview', { method: 'POST', body: form })
}
export function removeAdminTemplatePreview(id) {
  return request('/admin/templates/' + encodeURIComponent(id) + '/preview', { method: 'DELETE' })
}
export function adminTemplateProcessingUrl(id, version = '') {
  return '/api/admin/templates/' + encodeURIComponent(id) + '/image' + (version ? '?v=' + encodeURIComponent(version) : '')
}
export function adminTemplatePreviewUrl(id, version = '') {
  return '/api/admin/templates/' + encodeURIComponent(id) + '/preview' + (version ? '?v=' + encodeURIComponent(version) : '')
}

export { ApiError }

export function signInWithGoogle(idToken) {
  return request('/account/google', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id_token: idToken }) })
}

export function getAdminOverview() { return request('/admin/overview') }
export function getAdminUsers(params = {}) {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ''))
  return request('/admin/users' + (query.toString() ? '?' + query.toString() : ''))
}
export function getAdminUser(id) { return request('/admin/users/' + encodeURIComponent(id)) }
export function getAdminUserCredits(id) { return request('/admin/users/' + encodeURIComponent(id) + '/credits') }
export function getAdminUserGenerations(id) { return request('/admin/users/' + encodeURIComponent(id) + '/generations') }
export function getAdminUserSessions(id) { return request('/admin/users/' + encodeURIComponent(id) + '/sessions') }
export function getAdminUserAudit(id) { return request('/admin/users/' + encodeURIComponent(id) + '/audit') }
export function changeAdminUserStatus(id, body) { return adminJson('PATCH', '/admin/users/' + encodeURIComponent(id) + '/status', body) }
export function revokeAdminUserSessions(id, body) { return adminJson('POST', '/admin/users/' + encodeURIComponent(id) + '/sessions/revoke', body) }
export function adjustAdminUserCredits(id, body) { return adminJson('POST', '/admin/users/' + encodeURIComponent(id) + '/credits', body) }
export function getAdminLedger(params = {}) {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ''))
  return request('/admin/credits/ledger' + (query.toString() ? '?' + query.toString() : ''))
}
export function getAdminPlans() { return request('/admin/plans') }
export function createAdminPlan(body) { return adminJson('POST', '/admin/plans', body) }
export function updateAdminPlan(id, body) { return adminJson('PATCH', '/admin/plans/' + encodeURIComponent(id), body) }
export function getAdminSubscriptions() { return request('/admin/subscriptions') }
export function changeAdminUserSubscription(id, body) { return adminJson('POST', '/admin/users/' + encodeURIComponent(id) + '/subscription', body) }
export function getAdminGenerations(params = {}) {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ''))
  return request('/admin/generations' + (query.toString() ? '?' + query.toString() : ''))
}
export function getAdminGeneration(id) { return request('/admin/generations/' + encodeURIComponent(id)) }
export function revokeAdminResultClaim(id, body) { return adminJson('POST', '/admin/result-claims/' + encodeURIComponent(id) + '/revoke', body) }
export function getAdminAudit(params = {}) {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ''))
  return request('/admin/audit' + (query.toString() ? '?' + query.toString() : ''))
}
export function getAdminActors() { return request('/admin/admin-users') }
export function createAdminUser(body) { return adminJson('POST', '/admin/admin-users', body) }
export function updateAdminUser(id, body) { return adminJson('PATCH', '/admin/admin-users/' + encodeURIComponent(id), body) }
export function getAdminSettings() { return request('/admin/settings') }

export function getAdminUsageOverview() { return request('/admin/usage/overview') }
export function getAdminUsageUsers(params = {}) {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ''))
  return request('/admin/usage/users' + (query.toString() ? '?' + query.toString() : ''))
}
export function getAdminUsageUser(id) { return request('/admin/usage/users/' + encodeURIComponent(id)) }
export function getAdminUsageUserGenerations(id, params = {}) {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ''))
  return request('/admin/usage/users/' + encodeURIComponent(id) + '/generations' + (query.toString() ? '?' + query.toString() : ''))
}
export function getAdminUsageUserCredits(id, params = {}) {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ''))
  return request('/admin/usage/users/' + encodeURIComponent(id) + '/credits' + (query.toString() ? '?' + query.toString() : ''))
}
export function getAdminUsageGenerations(params = {}) {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ''))
  return request('/admin/usage/generations' + (query.toString() ? '?' + query.toString() : ''))
}
export function getAdminUsageGeneration(id) { return request('/admin/usage/generations/' + encodeURIComponent(id)) }
export function getAdminProviderOverview() { return request('/admin/usage/providers/overview') }
export function getAdminProviderAccounts() { return request('/admin/usage/providers/accounts') }

// ---- AI Provider Lab (admin, superadmin-only; isolated from production generation) ----
const lab = '/admin/lab'
// Lab reads bypass the admin read cache: run polling and spend totals must always be live.
export const labGet = (path) => fetchRequest(lab + path)
export function labSend(method, path, body) { return request(lab + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) }) }
export function labUpload(path, payload, files) {
  const form = new FormData()
  form.append('payload', JSON.stringify(payload))
  for (const [field, list] of Object.entries(files)) for (const file of list) form.append(field, file)
  return request(lab + path, { method: 'POST', body: form })
}
export const labImageUrl = (runId, slot, download = false) => `${BASE}${lab}/runs/${encodeURIComponent(runId)}/image/${encodeURIComponent(slot)}${download ? '?download=1' : ''}`
export const labExportUrl = (query = '') => `${BASE}${lab}/export.csv${query}`
export const labReportUrl = (query = '') => `${BASE}${lab}/report.csv${query}`

// Payment reads deliberately bypass the Admin read cache so provider callbacks appear immediately.
export function getTopUpPayments(query = {}) { return request('/account/topups?' + new URLSearchParams(query)) }
export function refreshTopUpPayment(id) { return request('/account/topups/' + encodeURIComponent(id) + '/refresh', { method: 'POST' }) }
export function getAdminPaymentConfig() { return fetchRequest('/admin/payments/config') }
export function getAdminPayments(query = {}) { const params = Object.fromEntries(Object.entries(query).filter(([, value]) => value !== '')); return fetchRequest('/admin/payments?' + new URLSearchParams(params)) }
export function getAdminPayment(id) { return fetchRequest('/admin/payments/' + encodeURIComponent(id)) }
export function refreshAdminPayment(id) { return request('/admin/payments/' + encodeURIComponent(id) + '/refresh', { method: 'POST' }) }

export function createSubscriptionCheckout(planCode, requestKey) { return request('/account/subscriptions/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestKey }, body: JSON.stringify({ plan_code: planCode }) }) }
export function getGenerationApiRoutes() { return request('/admin/generation-api-routes') }
export function saveGenerationApiRoute(lane, body) { return request('/admin/generation-api-routes/' + encodeURIComponent(lane), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) }

// Folder metadata; generated photo bytes remain in existing private MinIO storage.
export function getPhotoFolders(){return request('/account/photo-folders')}
export function createPhotoFolder(name){return request('/account/photo-folders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})})}
export function renamePhotoFolder(id,name){return request('/account/photo-folders/'+encodeURIComponent(id),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})})}
export function deletePhotoFolder(id){return request('/account/photo-folders/'+encodeURIComponent(id),{method:'DELETE'})}
export function setDefaultPhotoFolder(folder_id){return request('/account/photo-folders/default',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({folder_id})})}
export function getFolderPhotos(filter='all',cursor=null){const q=new URLSearchParams();if(filter!=='all')q.set('folder_id',filter);if(cursor)q.set('cursor',cursor);return request('/account/photos?'+q)}
export function movePhotoToFolder(id,folder_id){return request('/account/photos/'+encodeURIComponent(id)+'/folder',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({folder_id})})}
export function getFolderShares(id){return request('/account/photo-folders/'+encodeURIComponent(id)+'/shares')}
export function createFolderShare(id,expires_at){return request('/account/photo-folders/'+encodeURIComponent(id)+'/shares',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expires_at})})}
export function revokeFolderShare(id){return request('/account/photo-folder-shares/'+encodeURIComponent(id),{method:'DELETE'})}
export function getSharedFolder(token,cursor=null){return request('/public/photo-folders/'+encodeURIComponent(token)+(cursor?'?cursor='+encodeURIComponent(cursor):''))}

// Management uses the signed-in web session. Secrets must never enter analytics.
export function getIntegrationCapabilities() { return request('/public/v1/capabilities') }
export function listIntegrationKeys() { return request('/account/api-keys') }
export function createIntegrationKey(body) { return request('/account/api-keys', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}) }
export function rotateIntegrationKey(id) { return request(`/account/api-keys/${encodeURIComponent(id)}/rotate`, {method:'POST'}) }
export function revokeIntegrationKey(id) { return request(`/account/api-keys/${encodeURIComponent(id)}/revoke`, {method:'POST'}) }

// Fixed same-origin GET destinations only. No cookies, telemetry, persistence or redirects.
export async function exploreStorageApi({token,endpoint,folderId='',cursor='',resultId='',signal}) {
  const routes={folders:'/storage/folders',photos:'/storage/photos',usage:'/usage'}
  if(!/^nxb_live_[a-f0-9]{16}_[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('Secret Key tidak valid.')
  let path=routes[endpoint]
  if(endpoint==='download') {
    if(!/^[a-f0-9]{32}$/.test(resultId)) throw new Error('Result ID harus 32 karakter heksadesimal.')
    path=`/storage/photos/${resultId}/download`
  }
  if(!path) throw new Error('Endpoint tidak didukung.')
  const query=new URLSearchParams()
  if(endpoint==='photos') {query.set('limit','20');if(folderId)query.set('folder_id',folderId);if(cursor)query.set('cursor',cursor)}
  const response=await fetch(`${BASE}/public/v1${path}${query.size?'?'+query:''}`,{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Authorization:`Bearer ${token}`},signal})
  if(!response.ok) {
    const code=response.status===401?'Key salah, kedaluwarsa, atau dicabut.':response.status===403?'Key tidak memiliki izin atau akun tidak tersedia.':response.status===429?'Terlalu banyak request. Coba lagi setelah jeda.':`Request gagal (${response.status}).`
    throw new Error(code)
  }
  if(endpoint==='download') return {status:response.status,blob:await response.blob()}
  return {status:response.status,data:await response.json()}
}

// Explicit Generation Explorer actions; secret stays in the Authorization header.
export async function exploreGenerationApi({token,action,file,body,id,requestKey,signal}) {
  if(!/^nxb_live_[a-f0-9]{16}_[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('Secret Key tidak valid.')
  let path,method='GET',payload
  const headers={Authorization:`Bearer ${token}`}
  if(action==='templates') path='/templates'
  else if(action==='status') {
    if(!/^[a-f0-9]{32}$/.test(id)) throw new Error('Job ID tidak valid.')
    path='/generations/'+id
  } else if(action==='upload') {
    if(!file||!file.size) throw new Error('Pilih foto terlebih dahulu.')
    path='/inputs';method='POST';payload=new FormData();payload.append('file',file)
  } else if(action==='generate') {
    if(typeof requestKey!=='string'||!requestKey||requestKey.length>120) throw new Error('Idempotency-Key tidak valid.')
    if(!body?.template_id||!body?.input_id) throw new Error('Template dan input wajib diisi.')
    path='/generations';method='POST';headers['Content-Type']='application/json';headers['Idempotency-Key']=requestKey;payload=JSON.stringify(body)
  } else throw new Error('Endpoint tidak didukung.')
  const response=await fetch(`${BASE}/public/v1${path}`,{method,body:payload,headers,credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal})
  if(!response.ok) {
    let code;try{const value=await response.json();code=value?.detail?.error_code}catch{}
    const messages={CREDIT_BALANCE_EXHAUSTED:'AI Credit tidak cukup.',STORAGE_QUOTA_EXCEEDED:'Storage akun penuh.',AI_PROVIDER_NOT_CONNECTED:'Jalur generate belum terhubung.',IDEMPOTENCY_CONFLICT:'Idempotency-Key sudah dipakai untuk isi request berbeda.',API_KEY_SCOPE_FORBIDDEN:'Key belum memiliki izin yang dibutuhkan.',API_KEY_INVALID:'Key salah, kedaluwarsa, atau dicabut.'}
    const error=new Error(messages[code]||`Request gagal (${response.status}). Periksa izin, foto, saldo dan parameter. Untuk mengulang generate setelah gangguan jaringan, gunakan request yang sama.`)
    error.definitiveRejection=[400,401,403,404,413,422].includes(response.status)
    throw error
  }
  return {status:response.status,data:await response.json(),retryAfter:Number(response.headers.get('Retry-After'))||3}
}

function integrationQuery(query={}) {const params=new URLSearchParams();for(const [key,value] of Object.entries(query))if(value!==''&&value!==null&&value!==undefined)params.set(key,String(value));return params.size?'?'+params:''}
export function getDeveloperDashboard(query={},options={}) {return request('/account/api-keys/dashboard'+integrationQuery(query),options)}
export function getDeveloperGenerations(query={},options={}) {return request('/account/api-keys/generations'+integrationQuery(query),options)}

const webhookPath=key=>'/account/api-keys/'+encodeURIComponent(key)+'/webhook'
export const getIntegrationWebhook=(key,options={})=>request(webhookPath(key),options)
export const saveIntegrationWebhook=(key,body)=>request(webhookPath(key),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
export const rotateIntegrationWebhook=key=>request(webhookPath(key)+'/rotate-secret',{method:'POST'})
export const getWebhookDeliveries=(key,query={},options={})=>request(webhookPath(key)+'/deliveries'+integrationQuery(query),options)
export const getWebhookAttempts=(key,id)=>request(webhookPath(key)+'/deliveries/'+encodeURIComponent(id)+'/attempts')
export const retryWebhookDelivery=(key,id)=>request(webhookPath(key)+'/deliveries/'+encodeURIComponent(id)+'/retry',{method:'POST'})
