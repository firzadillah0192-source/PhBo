import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Rocket, Sparkles } from 'lucide-react'
import { AdminPage } from '../components/AdminShell'
import { type Column, DataTable, type Sort, sortRows, usePaged } from '../components/DataTable'
import { ConfirmDialog, FilterBar, SearchInput, useToast } from '../components/overlays'
import { Button, InlineSelect, PageHeader, StatusChip, Switch, Thumb } from '../components/ui'
import { type Experience, experienceCategories, experiences as seed } from '../data/mock'

const previewValue = (s: Experience['preview_status']) => s.toLowerCase()

export function Experiences() {
  const navigate = useNavigate()
  const toast = useToast()
  const [items, setItems] = useState(seed)
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  const [status, setStatus] = useState('')
  const [sort, setSort] = useState<Sort>({ key: 'sort_order', direction: 'asc' })
  const [dialog, setDialog] = useState<'missing' | 'publish' | null>(null)

  const missing = items.filter((e) => e.preview_status === 'MISSING' || e.preview_status === 'FAILED')
  const publishable = items.filter((e) => e.status === 'draft' && e.preview_status === 'READY')

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const rows = items.filter((e) => (!needle || `${e.name} ${e.id}`.toLowerCase().includes(needle)) && (!category || e.category === category) && (!status || e.status === status))
    return sortRows(rows, sort, (r, k) => (r as unknown as Record<string, string | number>)[k])
  }, [items, q, category, status, sort])

  const { rows, pagination } = usePaged(filtered)

  const patch = (id: string, change: Partial<Experience>) => setItems((list) => list.map((e) => (e.id === id ? { ...e, ...change } : e)))

  const columns: Column<Experience>[] = [
    { key: 'thumb', header: '', width: 'w-16', cell: (e) => <Thumb seed={e.sort_order} missing={e.preview_status === 'MISSING'} alt={e.name} className="h-10 w-8" /> },
    { key: 'name', header: 'Name', sortKey: 'name', cell: (e) => (<div><p className="t-label-s truncate">{e.name}</p><p className="t-caption truncate font-mono text-text-muted">{e.id}</p></div>) },
    { key: 'category', header: 'Category', width: 'w-28', sortKey: 'category', cell: (e) => e.category },
    { key: 'status', header: 'Status', width: 'w-32', cell: (e) => <StatusChip value={e.status} /> },
    { key: 'preview', header: 'Preview', width: 'w-36', cell: (e) => <StatusChip value={previewValue(e.preview_status)} label={e.preview_status === 'FAILED' ? 'Failed' : undefined} /> },
    { key: 'enabled', header: 'Enabled', width: 'w-24', cell: (e) => <Switch checked={e.enabled} label={`Enable ${e.name}`} onChange={(v) => patch(e.id, { enabled: v })} /> },
    { key: 'sort', header: 'Order', width: 'w-20', align: 'right', sortKey: 'sort_order', cell: (e) => e.sort_order },
    { key: 'updated', header: 'Updated', width: 'w-40', cell: (e) => <span className="text-text-muted">{e.updated_at}</span> },
  ]

  return (
    <AdminPage crumbs={[{ label: 'Catalog' }, { label: 'Experiences' }]} roles={['content_manager']}>
      <PageHeader
        title="Experiences"
        subtitle="AI art styles customers see in Advanced mode"
        actions={
          <>
            <Button variant="secondary" icon={Sparkles} disabled={!missing.length} onClick={() => setDialog('missing')}>
              Generate missing previews{missing.length ? ` (${missing.length})` : ''}
            </Button>
            <Button variant="secondary" icon={Rocket} disabled={!publishable.length} onClick={() => setDialog('publish')}>
              Publish ready drafts{publishable.length ? ` (${publishable.length})` : ''}
            </Button>
            <Button icon={Plus} onClick={() => navigate('/experiences/new')}>
              New experience
            </Button>
          </>
        }
      />
      <FilterBar
        onReset={() => {
          setQ('')
          setCategory('')
          setStatus('')
        }}
      >
        <SearchInput value={q} onChange={setQ} placeholder="Search name or ID" />
        <InlineSelect aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)} options={[{ value: '', label: 'Category: All' }, ...experienceCategories.map((c) => ({ value: c, label: c }))]} />
        <InlineSelect aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: '', label: 'Status: All' }, { value: 'draft', label: 'Draft' }, { value: 'published', label: 'Published' }, { value: 'disabled', label: 'Disabled' }]} />
      </FilterBar>
      <DataTable caption="Experiences" columns={columns} rows={rows} rowKey={(e) => e.id} sort={sort} onSort={setSort} onRowClick={(e) => navigate(`/experiences/${e.id}`)} pagination={pagination} />

      {dialog === 'missing' && (
        <ConfirmDialog
          title="Generate missing previews"
          description={`Queues an AI preview job for ${missing.length} experience${missing.length === 1 ? '' : 's'} that have no usable preview. Each job uses the shared portrait source and counts toward provider usage.`}
          confirmLabel="Queue previews"
          confirmText="I understand this uses AI provider capacity"
          onClose={() => setDialog(null)}
          onConfirm={() => {
            setItems((list) => list.map((e) => (e.preview_status === 'MISSING' || e.preview_status === 'FAILED' ? { ...e, preview_status: 'GENERATING', preview_error: null } : e)))
            setDialog(null)
            toast({ tone: 'success', title: 'Previews queued', body: `${missing.length} queued · 0 skipped (already ready).` })
          }}
        />
      )}
      {dialog === 'publish' && (
        <ConfirmDialog
          title="Publish ready drafts"
          description={`${publishable.length} draft${publishable.length === 1 ? '' : 's'} with a ready preview will become visible in the customer gallery.`}
          confirmLabel="Publish"
          onClose={() => setDialog(null)}
          onConfirm={() => {
            setItems((list) => list.map((e) => (e.status === 'draft' && e.preview_status === 'READY' ? { ...e, status: 'published' } : e)))
            setDialog(null)
            toast({ tone: 'success', title: 'Published', body: `${publishable.length} experience${publishable.length === 1 ? '' : 's'} are now live.` })
          }}
        >
          <ul className="t-body-s flex flex-col gap-1 rounded-sm bg-surface-2 p-3">
            {publishable.map((e) => (
              <li key={e.id}>{e.name}</li>
            ))}
          </ul>
        </ConfirmDialog>
      )}
    </AdminPage>
  )
}
