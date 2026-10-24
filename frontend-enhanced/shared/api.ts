// Keep both UI versions on the production contract and idempotency implementation.
// @ts-ignore The existing client is JavaScript, maintained by frontend/.
import * as customer from '../../frontend/src/api.js'
// @ts-ignore The existing kiosk client enforces the separate staff session.
import * as kiosk from '../../frontend/src/kioskWebApi.js'
export { customer, kiosk }
export type Row = Record<string, any>
export function rows(value: any, key?: string): Row[] {
  if (Array.isArray(value)) return value
  return value?.[key || 'items'] || value?.items || []
}
export function message(error: any): string {
  if (error?.errorCode === 'AI_PROVIDER_NOT_CONNECTED') return 'The AI service is unavailable. Please try again later.'
  return error?.message || 'The request failed. Please try again.'
}
export function date(value: any) { return value ? new Date(value).toLocaleString() : '—' }
