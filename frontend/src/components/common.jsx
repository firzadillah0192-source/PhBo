import { ApiError } from '../api.js'

export function toError(error, fallbackTitle) {
  if (error instanceof ApiError) {
    console.error(fallbackTitle, { code: error.errorCode, detail: error.detail })
    return { title: fallbackTitle, message: error.message }
  }
  console.error(fallbackTitle, error)
  return { title: fallbackTitle, message: error?.message || String(error) }
}
