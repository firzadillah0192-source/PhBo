import { type ReactNode, useRef, useState } from 'react'
import { Button, InlineAlert } from '../components/ui'
import type { Pagination } from '../components/DataTable'
import { message } from '../../../shared/api'

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="flex flex-col gap-3" aria-label={title}><h2 className="t-h4">{title}</h2>{children}</section>
}
export function Gate({ resource }: { resource: { error: string; refresh: () => void } }) {
  return resource.error ? <InlineAlert tone="danger">{resource.error} <Button variant="secondary" size="sm" onClick={resource.refresh}>Retry</Button></InlineAlert> : null
}
/** Maps the API's `{ page, pages, total, page_size }` envelope to the DataTable footer. */
export function pager(data: any, page: number, setPage: (page: number) => void): Pagination | undefined {
  if (!data) return undefined
  const size = data.page_size || 50
  return { page: data.page ?? page, pages: data.pages ?? Math.max(1, Math.ceil((data.total ?? 0) / size)), total: data.total ?? 0, pageSize: size, onPage: setPage }
}
export const lower = (v: unknown) => String(v ?? '').toLowerCase()
export const when = (v: unknown) => (v ? new Date(v as string).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—')
export const Dash = () => <span className="text-text-muted">—</span>
export const typeTone = (t: string) => (t === 'generation_refund' ? 'success' : t === 'generation_spend' ? 'accent' : t === 'signup_bonus' ? 'info' : t?.includes('deduct') || t === 'admin_adjustment' ? 'danger' : 'primary') as 'success' | 'accent' | 'info' | 'danger' | 'primary'
export const signed = (n: number) => (n > 0 ? `+${n}` : n === 0 ? '0' : `−${Math.abs(n)}`)

/** Runs one mutation at a time; failures are returned so a ConfirmDialog can show them. */
export function useAction(refresh?: () => void) {
  const [error, setError] = useState(''); const lock = useRef(false)
  const run = async (action: () => Promise<any>) => {
    if (lock.current) return false
    lock.current = true; setError('')
    try { await action(); refresh?.(); return true } catch (e) { setError(message(e)); return false } finally { lock.current = false }
  }
  return { error, setError, run }
}
