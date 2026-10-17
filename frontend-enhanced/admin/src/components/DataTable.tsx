import { type ReactNode, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn, EmptyState, IconButton, InlineSelect } from './ui'

export type Column<T> = {
  key: string
  header: string
  cell: (row: T) => ReactNode
  /** Tailwind width class, e.g. "w-36". Columns without one share the remaining space. */
  width?: string
  align?: 'right'
  /** Set only for columns the server can sort by. */
  sortKey?: string
}

export type Sort = { key: string; direction: 'asc' | 'desc' }

export type Pagination = {
  page: number
  pages: number
  total: number
  pageSize: number
  onPage: (page: number) => void
  onPageSize?: (size: number) => void
  pageSizes?: number[]
}

type Props<T> = {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  onRowClick?: (row: T) => void
  /** Rendered in a full-width row under the clicked row (e.g. audit metadata). */
  expanded?: (row: T) => ReactNode | null
  sort?: Sort
  onSort?: (sort: Sort) => void
  pagination?: Pagination
  loading?: boolean
  empty?: { title: string; body?: string }
  caption: string
}

export function DataTable<T>({ columns, rows, rowKey, onRowClick, expanded, sort, onSort, pagination, loading, empty, caption }: Props<T>) {
  const toggleSort = (key: string) => onSort?.({ key, direction: sort?.key === key && sort.direction === 'asc' ? 'desc' : 'asc' })

  return (
    <div className="overflow-hidden rounded-md border border-border bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full table-fixed border-collapse">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 bg-surface-2">
            <tr>
              {columns.map((c) => {
                const active = sort?.key === c.sortKey
                const SortIcon = !active ? ArrowUpDown : sort?.direction === 'asc' ? ArrowUp : ArrowDown
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={active ? (sort?.direction === 'asc' ? 'ascending' : 'descending') : undefined}
                    className={cn('t-caption h-10 px-3 font-medium text-text-muted', c.width, c.align === 'right' ? 'text-right' : 'text-left')}
                  >
                    {c.sortKey && onSort ? (
                      <button type="button" onClick={() => toggleSort(c.sortKey!)} className={cn('inline-flex items-center gap-1 hover:text-text', active && 'text-text')}>
                        {c.header}
                        <SortIcon size={12} aria-hidden />
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: 6 }, (_, i) => (
                <tr key={i} className="border-t border-border">
                  {columns.map((c) => (
                    <td key={c.key} className="h-[52px] px-3">
                      <div className="h-3 w-3/4 animate-pulse rounded bg-surface-2" />
                    </td>
                  ))}
                </tr>
              ))}
            {!loading &&
              rows.map((row) => {
                const extra = expanded?.(row)
                return [
                  <tr
                    key={rowKey(row)}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    onKeyDown={onRowClick ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onRowClick(row)) : undefined}
                    tabIndex={onRowClick ? 0 : undefined}
                    className={cn('border-t border-border', onRowClick && 'cursor-pointer hover:bg-bg focus-visible:bg-bg')}
                  >
                    {columns.map((c) => (
                      <td key={c.key} className={cn('t-body-s h-[52px] px-3 py-2', c.align === 'right' && 'text-right tabular-nums')}>
                        <div className={cn('min-w-0', c.align !== 'right' && 'truncate')}>{c.cell(row)}</div>
                      </td>
                    ))}
                  </tr>,
                  extra ? (
                    <tr key={rowKey(row) + ':x'} className="border-t border-border bg-bg">
                      <td colSpan={columns.length} className="px-3 py-3">
                        {extra}
                      </td>
                    </tr>
                  ) : null,
                ]
              })}
          </tbody>
        </table>
      </div>
      {!loading && rows.length === 0 && <EmptyState title={empty?.title ?? 'Nothing to show'} body={empty?.body ?? 'Try changing or resetting the filters.'} />}
      {pagination && (
        <footer className="flex h-14 items-center justify-between gap-4 border-t border-border px-4">
          <p className="t-body-s text-text-muted">
            Page {pagination.page} of {Math.max(pagination.pages, 1)} · {pagination.total.toLocaleString('en')} results
          </p>
          <div className="flex items-center gap-2">
            {pagination.onPageSize && (
              <InlineSelect
                aria-label="Rows per page"
                value={String(pagination.pageSize)}
                onChange={(e) => pagination.onPageSize!(Number(e.target.value))}
                options={(pagination.pageSizes ?? [10, 25, 50]).map((n) => ({ value: String(n), label: `${n} / page` }))}
              />
            )}
            <IconButton icon={ChevronLeft} label="Previous page" disabled={pagination.page <= 1} onClick={() => pagination.onPage(pagination.page - 1)} />
            <IconButton icon={ChevronRight} label="Next page" disabled={pagination.page >= pagination.pages} onClick={() => pagination.onPage(pagination.page + 1)} />
          </div>
        </footer>
      )}
    </div>
  )
}

/**
 * Client-side stand-in for the API's `{ items, page, page_size, total, pages }` envelope.
 * Replace with the server response once the pages fetch real data.
 */
export function usePaged<T>(rows: T[], initialSize = 10) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(initialSize)
  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  const current = Math.min(page, pages)
  const slice = useMemo(() => rows.slice((current - 1) * pageSize, current * pageSize), [rows, current, pageSize])
  const pagination: Pagination = {
    page: current,
    pages,
    total: rows.length,
    pageSize,
    onPage: setPage,
    onPageSize: (n) => {
      setPageSize(n)
      setPage(1)
    },
  }
  return { rows: slice, pagination }
}

export function sortRows<T>(rows: T[], sort: Sort | undefined, get: (row: T, key: string) => string | number) {
  if (!sort) return rows
  const dir = sort.direction === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const x = get(a, sort.key)
    const y = get(b, sort.key)
    return (x < y ? -1 : x > y ? 1 : 0) * dir
  })
}
