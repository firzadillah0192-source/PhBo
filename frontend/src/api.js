/**
 * Backend API client.
 *
 * This module is the single place that knows the HTTP contract. It mirrors
 * the FastAPI schemas exactly (see docs/API_CONTRACT.md). No endpoint is
 * called here unless it exists on the backend.
 *
 * All paths are relative (/api/...) and served through the Vite dev proxy or
 * the production reverse proxy, so the browser only ever talks to one origin.
 */

const BASE = '/api'

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
  // FastAPI errors arrive as either our {error_code,message,detail} object,
  // a {detail: {...}} wrapper, or a {detail: "string"} wrapper.
  let body = null
  try {
    body = await response.json()
  } catch {
    return new ApiError(response.status, 'HTTP_' + response.status, 'Request failed (' + response.status + ')', null)
  }

  const detail = body?.detail ?? body
  if (detail && typeof detail === 'object') {
    return new ApiError(
      response.status,
      detail.error_code || 'HTTP_' + response.status,
      detail.message || 'Request failed',
      detail.detail ?? null,
    )
  }
  return new ApiError(
    response.status,
    'HTTP_' + response.status,
    typeof detail === 'string' && detail ? detail : 'Request failed (' + response.status + ')',
    null,
  )
}

async function request(path, options = {}) {
  const response = await fetch(BASE + path, options)
  if (!response.ok) {
    throw await parseError(response)
  }
  // 204 or empty body
  const text = await response.text()
  if (!text) return null
  return JSON.parse(text)
}

/** GET /api/health -> {status, app, environment, checks, ai_provider, ai_provider_connected} */
export function getHealth() {
  return request('/health')
}

/** GET /api/templates -> {templates: [...], count} */
export function getTemplates() {
  return request('/templates')
}

/**
 * POST /api/uploads (multipart/form-data, field name "file")
 * -> {upload_id, filename, content_type, size_bytes, width, height, format,
 *     sha256, validation_status, preview_url, created_at}
 */
export function uploadPhoto(file) {
  const form = new FormData()
  form.append('file', file)
  return request('/uploads', { method: 'POST', body: form })
}

/**
 * POST /api/generations {upload_id, template_id}
 * -> 202 {job_id, state, upload_id, template_id, created_at}
 */
export function createGeneration(uploadId, templateId) {
  return request('/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ upload_id: uploadId, template_id: templateId }),
  })
}

/**
 * GET /api/generations/{job_id}
 * -> {job_id, state, ..., error_code, error_message, result_id, result_url, download_url}
 */
export function getGeneration(jobId) {
  return request('/generations/' + encodeURIComponent(jobId))
}

/** GET /api/results/{result_id} -> result metadata */
export function getResult(resultId) {
  return request('/results/' + encodeURIComponent(resultId))
}

/** Inline image URL for an <img> tag. */
export function resultImageUrl(resultId) {
  return BASE + '/results/' + encodeURIComponent(resultId) + '/image'
}

/** Attachment download URL. */
export function resultDownloadUrl(resultId) {
  return BASE + '/results/' + encodeURIComponent(resultId) + '/download'
}

/** Upload preview URL for an <img> tag. */
export function uploadPreviewUrl(uploadId) {
  return BASE + '/uploads/' + encodeURIComponent(uploadId) + '/preview'
}

export { ApiError }
