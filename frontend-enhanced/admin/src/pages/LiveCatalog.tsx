import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Ban, Pencil, Plus, Rocket, Sparkles, Trash2 } from 'lucide-react'
import { AdminPage } from '../components/AdminShell'
import { type Column, DataTable, type Sort, sortRows, usePaged } from '../components/DataTable'
import { ConfirmDialog, FilterBar, Modal, SearchInput, useToast } from '../components/overlays'
import { ImageAssetPanel } from '../components/panels'
import { Button, Card, Chip, cn, EmptyState, InlineAlert, InlineSelect, KeyValueList, MultiSelectAll, PageHeader, SelectField, StatusChip, Switch, SwitchRow, Tabs, TextArea, TextField, Thumb } from '../components/ui'
import { customer as api, message, rows, type Row } from '../../../shared/api'
import { useResource } from '../../../shared/useResource'
import { can, useRole } from '../lib/role'
import { money } from '../lib/format'
import { Dash, Gate, lower, useAction, when } from './liveParts'

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const upper = (v: string) => v.replace(/^./, c => c.toUpperCase())
const Missing = ({ ok, label }: { ok: boolean; label: string }) => <Chip tone={ok ? 'success' : 'warning'}>{ok ? label : `${label} missing`}</Chip>
function FilePick({ label, send, done, replace }: { label: string; send: (file: File) => Promise<any>; done: () => void; replace?: boolean }) {
  const input = useRef<HTMLInputElement>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  return <div className="flex flex-col gap-1">
    <input ref={input} aria-label={label} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} onChange={async e => { const file = e.target.files?.[0]; const el = e.target; if (!file) return; setBusy(true); setError(''); try { await send(file); done() } catch (x) { setError(message(x)) } finally { el.value = ''; setBusy(false) } }} />
    <Button variant="secondary" loading={busy} onClick={() => input.current?.click()}>{replace ? `Replace ${label.toLowerCase()}` : `Upload ${label.toLowerCase()}`}</Button>
    {error && <p role="alert" className="t-caption text-danger">{error}</p>}
  </div>
}

/* ───────────── Experiences ───────────── */

export function Experiences() {
  const navigate = useNavigate(); const toast = useToast(); const r = useResource(() => api.getAdminExperiences()); const action = useAction(r.refresh)
  const [q, setQ] = useState(''); const [category, setCategory] = useState(''); const [status, setStatus] = useState(''); const [sort, setSort] = useState<Sort>({ key: 'sort_order', direction: 'asc' }); const [dialog, setDialog] = useState<'missing' | 'publish' | null>(null)
  const items = rows(r.data, 'experiences'); const missing = items.filter(e => e.preview_status === 'MISSING' || e.preview_status === 'FAILED' || e.preview_missing); const publishable = items.filter(e => e.status === 'draft' && e.preview_status === 'READY')
  const categories = [...new Set(items.map(e => e.category).filter(Boolean))].sort()
  const needle = q.trim().toLowerCase()
  const filtered = sortRows(items.filter(e => (!needle || `${e.name} ${e.id}`.toLowerCase().includes(needle)) && (!category || e.category === category) && (!status || e.status === status)), sort, (row, k) => (row as Row)[k] ?? '')
  const { rows: page, pagination } = usePaged(filtered)
  const columns: Column<Row>[] = [
    { key: 'thumb', header: '', width: 'w-16', cell: e => <Thumb src={e.preview_missing ? undefined : '/api/admin/experiences/' + e.id + '/thumbnail'} missing={e.preview_missing} alt={e.name} className="h-10 w-8" /> },
    { key: 'name', header: 'Name', sortKey: 'name', cell: e => <div><p className="t-label-s truncate">{e.name}</p><p className="t-caption truncate font-mono text-text-muted">{e.id}</p></div> },
    { key: 'category', header: 'Category', width: 'w-28', sortKey: 'category', cell: e => e.category },
    { key: 'status', header: 'Status', width: 'w-32', cell: e => <StatusChip value={lower(e.status)} /> },
    { key: 'preview', header: 'Preview', width: 'w-36', cell: e => <StatusChip value={lower(e.preview_status || (e.preview_missing ? 'missing' : 'ready'))} /> },
    { key: 'enabled', header: 'Enabled', width: 'w-24', cell: e => <span onClick={ev => ev.stopPropagation()}><Switch checked={!!e.enabled} label={`Enable ${e.name}`} onChange={v => action.run(() => api.updateAdminExperience(e.id, { enabled: v }))} /></span> },
    { key: 'sort', header: 'Order', width: 'w-20', align: 'right', sortKey: 'sort_order', cell: e => e.sort_order },
    { key: 'updated', header: 'Updated', width: 'w-44', cell: e => <span className="text-text-muted">{when(e.updated_at)}</span> },
  ]
  return <AdminPage crumbs={[{ label: 'Catalog' }, { label: 'Experiences' }]} roles={['content_manager']}>
    <PageHeader title="Experiences" subtitle="AI art styles customers see in Advanced mode" actions={<>
      <Button variant="secondary" icon={Sparkles} disabled={!missing.length} onClick={() => { action.setError(''); setDialog('missing') }}>Generate missing previews{missing.length ? ` (${missing.length})` : ''}</Button>
      <Button variant="secondary" icon={Rocket} disabled={!publishable.length} onClick={() => { action.setError(''); setDialog('publish') }}>Publish ready drafts{publishable.length ? ` (${publishable.length})` : ''}</Button>
      <Button icon={Plus} onClick={() => navigate('/experiences/new')}>New experience</Button></>} />
    <FilterBar onReset={() => { setQ(''); setCategory(''); setStatus('') }}>
      <SearchInput value={q} onChange={setQ} placeholder="Search name or ID" />
      <InlineSelect aria-label="Category" value={category} onChange={e => setCategory(e.target.value)} options={[{ value: '', label: 'Category: All' }, ...categories.map(c => ({ value: c, label: c }))]} />
      <InlineSelect aria-label="Status" value={status} onChange={e => setStatus(e.target.value)} options={[{ value: '', label: 'Status: All' }, { value: 'draft', label: 'Draft' }, { value: 'published', label: 'Published' }, { value: 'disabled', label: 'Disabled' }]} />
    </FilterBar>
    <Gate resource={r} />{action.error && !dialog && <InlineAlert tone="danger">{action.error}</InlineAlert>}
    <DataTable caption="Experiences" columns={columns} rows={page} rowKey={e => e.id} loading={r.loading && !r.data} sort={sort} onSort={setSort} onRowClick={e => navigate('/experiences/' + e.id)} pagination={pagination} />
    {dialog === 'missing' && <ConfirmDialog title="Generate missing previews" description={`Queues an AI preview job for ${missing.length} experience${missing.length === 1 ? '' : 's'} that have no usable preview. Each job uses the shared portrait source and counts toward provider usage.`} confirmLabel="Queue previews" confirmText="I understand this uses AI provider capacity" error={action.error} onClose={() => setDialog(null)} onConfirm={async () => { if (await action.run(() => api.generateMissingAdminPreviews({ confirm: true }))) { setDialog(null); toast({ tone: 'success', title: 'Previews queued' }) } }} />}
    {dialog === 'publish' && <ConfirmDialog title="Publish ready drafts" description={`${publishable.length} draft${publishable.length === 1 ? '' : 's'} with a ready preview will become visible in the customer gallery.`} confirmLabel="Publish" error={action.error} onClose={() => setDialog(null)} onConfirm={async () => { if (await action.run(() => api.publishReadyAdminExperiences())) { setDialog(null); toast({ tone: 'success', title: 'Published' }) } }}><ul className="t-body-s flex flex-col gap-1 rounded-sm bg-surface-2 p-3">{publishable.map(e => <li key={e.id}>{e.name}</li>)}</ul></ConfirmDialog>}
  </AdminPage>
}

export function ExperienceEditor() {
  const { id = '' } = useParams(); const creating = id === 'new'; const navigate = useNavigate(); const toast = useToast()
  const r = useResource(async () => ({ list: rows(await api.getAdminExperiences(), 'experiences'), frames: rows(await api.getAdminFrameStyles()), ornaments: rows(await api.getAdminOrnaments()) }), [id])
  const source = creating ? { id: '', name: '', description: '', category: 'Design', status: 'draft', enabled: false, sort_order: 10, max_ornaments: 3, internal_prompt: '', compatible_frame_style_ids: [], compatible_ornament_ids: [], preview_status: 'MISSING' } as Row : r.data?.list.find(e => e.id === id)
  const [form, setForm] = useState<Row | null>(null); const [errors, setErrors] = useState<Record<string, string>>({}); const [deleting, setDeleting] = useState(false); const [jobId, setJobId] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  useEffect(() => { if (source && !form) setForm({ sort_order: 0, max_ornaments: 3, category: 'Design', description: '', internal_prompt: '', ...source, compatible_frame_style_ids: source.compatible_frame_style_ids ?? [], compatible_ornament_ids: source.compatible_ornament_ids ?? [] }) }, [source, form])
  const job = useResource(async () => jobId ? api.getAdminPreviewJob(jobId) : null, [jobId], jobId ? 2000 : 0)
  const jobState = lower(job.data?.state)
  useEffect(() => { if (jobState === 'completed') { toast({ tone: 'success', title: 'Preview ready' }); setJobId(null); r.refresh() } else if (jobState === 'failed') { setError(job.data?.error_message || 'The preview job failed.'); setJobId(null); r.refresh() } }, [jobState])
  const crumbs = [{ label: 'Catalog' }, { label: 'Experiences', to: '/experiences' }, { label: creating ? 'New experience' : form?.name || id }]
  if (r.loading && !r.data) return <AdminPage crumbs={crumbs} roles={['content_manager']}><p role="status">Loading…</p></AdminPage>
  if (!source || !form) return <AdminPage crumbs={crumbs} roles={['content_manager']}><Gate resource={r} /><InlineAlert tone="danger" title="Experience not found">No experience has the ID <code className="t-mono">{id}</code>.</InlineAlert></AdminPage>
  const set = (key: string, value: any) => setForm(f => ({ ...f!, [key]: value }))
  const preview = jobId ? 'generating' : lower(source.preview_status || (source.preview_missing ? 'missing' : 'ready'))
  const cur: Row = form
  const validate = () => {
    const e: Record<string, string> = {}
    if (creating) { if (!SLUG.test(cur.id)) e.id = 'Use lowercase letters, numbers and single hyphens, e.g. space-commander.'; else if (r.data!.list.some(x => x.id === cur.id)) e.id = 'An experience with this ID already exists.' }
    if (!String(cur.name).trim()) e.name = 'Name is required.'
    if (!String(cur.internal_prompt).trim()) e.internal_prompt = 'The internal prompt is required.'
    if (cur.max_ornaments < 0 || cur.max_ornaments > 10) e.max_ornaments = 'Choose a number from 0 to 10.'
    return e
  }
  async function save() {
    const e = validate(); setErrors(e)
    if (Object.keys(e).length) { toast({ tone: 'warning', title: 'Fix the highlighted fields', body: 'Nothing was saved.' }); return }
    setBusy(true); setError('')
    try {
      const body: Row = { name: cur.name, description: cur.description, sort_order: cur.sort_order, enabled: cur.enabled, category: cur.category, internal_prompt: cur.internal_prompt, status: cur.status, max_ornaments: cur.max_ornaments, compatible_frame_style_ids: cur.compatible_frame_style_ids, compatible_ornament_ids: cur.compatible_ornament_ids }
      if (creating) await api.createAdminExperience({ id: cur.id, ...body }); else await api.updateAdminExperience(id, body)
      toast({ tone: 'success', title: creating ? 'Experience created' : 'Experience saved', body: cur.name }); navigate('/experiences')
    } catch (x) { setError(message(x)) } finally { setBusy(false) }
  }
  async function remove() { try { await api.deleteAdminExperience(id); toast({ tone: 'success', title: 'Experience deleted', body: cur.name }); navigate('/experiences') } catch (x) { setError(message(x)); setDeleting(false) } }
  const asset = async (call: () => Promise<any>) => { setError(''); try { const res = await call(); if (res?.state && res?.id) setJobId(res.id); r.refresh() } catch (x) { setError(message(x)) } }
  const categories = [...new Set([...r.data!.list.map(e => e.category).filter(Boolean), form.category].filter(Boolean))]
  return <AdminPage crumbs={crumbs} roles={['content_manager']}>
    <PageHeader title={creating ? 'New experience' : form.name} subtitle={creating ? 'Starts as a draft. Publish it once the preview is ready.' : `Last updated ${when(source.updated_at)}${source.updated_by ? ` by ${source.updated_by}` : ''}`} actions={<>
      {!creating && <Button variant="tertiary" icon={Trash2} className="text-danger hover:bg-danger-soft" onClick={() => setDeleting(true)}>Delete</Button>}
      <Button variant="secondary" onClick={() => navigate('/experiences')}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>} />
    {error && <InlineAlert tone="danger">{error}</InlineAlert>}
    <div className="flex items-start gap-6">
      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <Card title="Details"><div className="grid grid-cols-2 gap-x-5 gap-y-5">
          <TextField label="ID" mono value={form.id} disabled={!creating} onChange={e => set('id', e.target.value.trim())} helper={creating ? 'Permanent. Used in URLs and job records.' : 'The ID can’t be changed after creation.'} error={errors.id} />
          <TextField label="Name" value={form.name} onChange={e => set('name', e.target.value)} error={errors.name} />
          <div className="col-span-2"><TextField label="Description" value={form.description ?? ''} onChange={e => set('description', e.target.value)} helper="Shown on the customer style card." /></div>
          <SelectField label="Category" value={form.category} onChange={e => set('category', e.target.value)} options={categories.map(c => ({ value: c, label: c }))} />
          <SelectField label="Status" value={form.status} onChange={e => set('status', e.target.value)} error={errors.status} options={[{ value: 'draft', label: 'Draft' }, { value: 'published', label: 'Published' }, { value: 'disabled', label: 'Disabled' }]} />
          <TextField label="Sort order" type="number" min={0} value={form.sort_order} onChange={e => set('sort_order', Number(e.target.value))} helper="Lower numbers appear first." />
          <TextField label="Max ornaments" type="number" min={0} max={10} value={form.max_ornaments} onChange={e => set('max_ornaments', Number(e.target.value))} helper="0 hides the ornaments section for customers." error={errors.max_ornaments} />
          <div className="col-span-2"><SwitchRow label="Enabled" description="Turn off to hide this style without changing its status." checked={!!form.enabled} onChange={v => set('enabled', v)} /></div>
        </div></Card>
        <Card title="Prompt"><InlineAlert tone="warning">The internal prompt is for admins only. It is never shown to customers.</InlineAlert><div className="mt-4"><TextArea label="Internal prompt" mono rows={7} value={form.internal_prompt ?? ''} onChange={e => set('internal_prompt', e.target.value)} error={errors.internal_prompt} /></div></Card>
        <Card title="Compatibility"><div className="flex flex-col gap-6">
          <MultiSelectAll label="Compatible frame styles" helper="“All” means every enabled frame style." options={r.data!.frames.map(({ id, name }) => ({ id, name }))} value={form.compatible_frame_style_ids} onChange={v => set('compatible_frame_style_ids', v)} />
          <MultiSelectAll label="Compatible ornaments" helper="Customers can pick up to the max ornaments above." options={r.data!.ornaments.map(({ id, name }) => ({ id, name }))} value={form.compatible_ornament_ids} onChange={v => set('compatible_ornament_ids', v)} />
        </div></Card>
      </div>
      {!creating && <div className="w-80 shrink-0"><ImageAssetPanel title="Thumbnail & preview" aspect="aspect-[2/3]" present={!source.preview_missing} src={source.preview_missing ? undefined : '/api/admin/experiences/' + id + '/thumbnail'} status={preview} busy={!!jobId} error={source.preview_status === 'FAILED' ? source.preview_error || 'The preview job failed.' : undefined}
        constraints="JPG, PNG or WebP · 2:3 portrait · up to 12 MB. Generating a preview uses the shared portrait source."
        onUpload={file => asset(() => api.replaceAdminExperienceThumbnail(id, file))} onRemove={() => asset(() => api.deleteAdminExperienceThumbnail(id))}
        onGenerate={() => asset(() => api.generateAdminExperiencePreview(id))} generateLabel={source.preview_status === 'FAILED' ? 'Try again' : 'Generate preview'}
        footer={jobId ? <p className="t-caption text-text-muted">Checking the preview job every few seconds…</p> : <div className="flex items-center gap-2"><span className="t-caption text-text-muted">Preview status</span><StatusChip value={preview} /></div>} /></div>}
    </div>
    {deleting && <ConfirmDialog title="Delete this experience?" description={`“${form.name}” is removed permanently. Past generations keep their record but the style no longer appears anywhere.`} confirmLabel="Delete experience" confirmText="I understand this can’t be undone" destructive onClose={() => setDeleting(false)} onConfirm={remove} />}
  </AdminPage>
}

/* ───────────── Templates ───────────── */

function TemplateModal({ template, onClose, onSaved, onDelete }: { template: Row | null; onClose: () => void; onSaved: () => void; onDelete?: () => void }) {
  const toast = useToast(); const [form, setForm] = useState<Row>(template ?? { id: '', name: '', description: '', enabled: true, sort_order: 10 }); const [errors, setErrors] = useState<Record<string, string>>({}); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }))
  async function submit() {
    const e: Record<string, string> = {}
    if (!template && !SLUG.test(form.id)) e.id = 'Use lowercase letters, numbers and hyphens.'
    if (!String(form.name).trim()) e.name = 'Name is required.'
    setErrors(e); if (Object.keys(e).length) return
    setBusy(true); setError('')
    try { const body = { name: form.name, description: form.description, enabled: form.enabled, sort_order: form.sort_order }; if (template) await api.updateAdminTemplate(template.id, body); else await api.createAdminTemplate({ id: form.id, ...body }); toast({ tone: 'success', title: template ? 'Template saved' : 'Template created', body: form.name }); onSaved() }
    catch (x) { setError(message(x)) } finally { setBusy(false) }
  }
  return <Modal wide title={template ? `Edit ${template.name}` : 'New template'} description="Basic-mode scene. The master image is what the AI blends the customer into." onClose={onClose} footer={<>
    {onDelete && <Button variant="tertiary" icon={Trash2} className="mr-auto text-danger hover:bg-danger-soft" onClick={onDelete}>Delete</Button>}
    <Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={submit}>{template ? 'Save' : 'Create template'}</Button></>}>
    <div className="grid grid-cols-2 gap-5">
      <TextField label="ID" mono value={form.id} disabled={!!template} onChange={e => set('id', e.target.value.trim())} error={errors.id} />
      <TextField label="Name" value={form.name} onChange={e => set('name', e.target.value)} error={errors.name} />
      <div className="col-span-2"><TextArea label="Description" rows={2} value={form.description ?? ''} onChange={e => set('description', e.target.value)} /></div>
      <TextField label="Sort order" type="number" min={0} value={form.sort_order} onChange={e => set('sort_order', Number(e.target.value))} />
      <TextField label="Canvas" value={template?.canvas_width ? `${template.canvas_width} × ${template.canvas_height} (${template.aspect_ratio})` : 'Read from the master image'} disabled helper="Read from the master image." />
      <div className="col-span-2"><SwitchRow label="Enabled" description="Hidden from customers when off." checked={!!form.enabled} onChange={v => set('enabled', v)} /></div>
    </div>
    {template && <div className="grid grid-cols-2 gap-5">
      <div className="flex flex-col gap-2 rounded-md border border-border p-4"><div className="flex items-center justify-between"><p className="t-label-s">Master image</p><Missing ok={!!template.processing_asset_present} label="Present" /></div><p className="t-caption text-text-muted">PNG or JPG, 2:3. Not shown to customers.</p><FilePick label="Master image" replace={!!template.processing_asset_present} send={f => api.replaceAdminTemplateImage(template.id, f)} done={onSaved} /></div>
      <div className="flex flex-col gap-2 rounded-md border border-border p-4"><div className="flex items-center justify-between"><p className="t-label-s">Marketing preview</p><Missing ok={!template.preview_missing} label="Present" /></div><p className="t-caption text-text-muted">Shown on the customer template card.</p><div className="flex gap-2"><FilePick label="Marketing preview" replace={!template.preview_missing} send={f => api.replaceAdminTemplatePreview(template.id, f)} done={onSaved} />{!template.preview_missing && <Button variant="tertiary" className="text-danger hover:bg-danger-soft" onClick={async () => { try { await api.removeAdminTemplatePreview(template.id); onSaved() } catch (x) { setError(message(x)) } }}>Remove</Button>}</div></div>
    </div>}
    {error && <InlineAlert tone="danger">{error}</InlineAlert>}
    {template && form.enabled && (!template.processing_asset_present || template.preview_missing) && <InlineAlert tone="warning">This template is enabled but missing an image. Customers may see a placeholder or be unable to pick it.</InlineAlert>}
  </Modal>
}
export function Templates() {
  const toast = useToast(); const r = useResource(() => api.getAdminTemplates()); const [editing, setEditing] = useState<Row | 'new' | null>(null); const [deleting, setDeleting] = useState<Row | null>(null); const action = useAction(r.refresh)
  const list = rows(r.data, 'templates')
  return <AdminPage crumbs={[{ label: 'Catalog' }, { label: 'Templates' }]} roles={['content_manager']}>
    <PageHeader title="Templates" subtitle="Scenes for Basic mode" actions={<Button icon={Plus} onClick={() => setEditing('new')}>New template</Button>} />
    <Gate resource={r} />
    {!r.loading && !list.length && <div className="rounded-md border border-border bg-surface"><EmptyState title="No templates yet" /></div>}
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-5">{list.map(t => <li key={t.id}><button type="button" onClick={() => setEditing(t)} className="flex w-full flex-col gap-3 rounded-md border border-border bg-surface p-3 text-left hover:border-primary">
      <Thumb src={t.marketing_preview_url || undefined} missing={t.preview_missing} alt={t.name} className={cn('aspect-[2/3] w-full !object-contain', !t.enabled && 'opacity-50')} />
      <div className="flex flex-col gap-1.5 px-1 pb-1"><div className="flex items-start justify-between gap-2"><p className="t-label-s">{t.name}</p><StatusChip value={t.enabled ? 'enabled' : 'disabled'} /></div>
        <p className="t-caption text-text-muted">{t.canvas_width ? `${t.canvas_width} × ${t.canvas_height} · ${t.aspect_ratio} · ` : ''}{t.framed ? 'Framed' : 'No frame'}</p>
        <div className="flex flex-wrap gap-1.5"><Missing ok={!!t.processing_asset_present} label="Master" /><Missing ok={!t.preview_missing} label="Preview" /></div></div></button></li>)}</ul>
    {editing && <TemplateModal template={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); r.refresh() }} onDelete={editing === 'new' ? undefined : () => { setDeleting(editing); setEditing(null) }} />}
    {deleting && <ConfirmDialog title="Delete this template?" description={`“${deleting.name}” and its images are removed permanently.`} confirmLabel="Delete template" confirmText="I understand this can’t be undone" destructive error={action.error} onClose={() => setDeleting(null)} onConfirm={async () => { if (await action.run(() => api.deleteAdminTemplate(deleting.id))) { toast({ tone: 'success', title: 'Template deleted', body: deleting.name }); setDeleting(null) } }} />}
  </AdminPage>
}

/* ───────────── Classic layouts ───────────── */

const REQUIRED = { w: 1200, h: 3600 }
function StripPreview({ layout, className }: { layout: Row; className?: string }) {
  const slots: Row[] = layout.slots ?? []; const s = 100 / (layout.canvas_width || REQUIRED.w)
  return <div role="img" aria-label={`${layout.name} strip preview with ${layout.shot_count} slots`} className={cn('relative overflow-hidden rounded-sm border border-border bg-white', className)} style={{ aspectRatio: `${layout.canvas_width || REQUIRED.w} / ${layout.canvas_height || REQUIRED.h}` }}>
    {layout.preview_url && layout.frame_asset_present ? <img src={layout.preview_url} alt="" className="absolute inset-0 h-full w-full object-contain" /> : slots.map((sl, i) => <span key={i} className="absolute rounded-[2px] bg-gradient-to-br from-[#A18CD1] to-[#FBC2EB]" style={{ left: `${sl.x * s}%`, top: `${(sl.y / layout.canvas_height) * 100}%`, width: `${sl.width * s}%`, height: `${(sl.height / layout.canvas_height) * 100}%` }} />)}
    {!layout.frame_asset_present && <span className="absolute inset-0 flex items-center justify-center bg-surface-2/70 px-2 text-center text-xs font-medium text-text-muted">No frame</span>}
  </div>
}
function LayoutModal({ layout, onClose, onSaved }: { layout: Row | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast(); const [form, setForm] = useState<Row>(layout ?? { id: '', slug: '', name: '', canvas_width: REQUIRED.w, canvas_height: REQUIRED.h, shot_count: 3, slots: [], enabled: false, sort_order: 10, frame_asset_present: false })
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }))
  const setSlot = (i: number, key: string, v: number) => set('slots', form.slots.map((s: Row, j: number) => j === i ? { ...s, [key]: v } : s))
  const resize = (n: number) => { const count = Math.max(1, Math.min(8, n)); const h = Math.floor((form.canvas_height - 420 - 60 * (count + 1)) / count); setForm(f => ({ ...f, shot_count: count, slots: Array.from({ length: count }, (_, i) => f.slots[i] ?? { x: 84, y: 60 + i * (h + 60), width: 1032, height: h }) })) }
  async function submit() {
    setBusy(true); setError('')
    try { const body = { name: form.name, canvas_width: form.canvas_width, canvas_height: form.canvas_height, shot_count: form.shot_count, slots: form.slots, enabled: form.enabled, sort_order: form.sort_order }; if (layout) await api.updateAdminClassicLayout(layout.id, body); else await api.createAdminClassicLayout({ id: form.id || form.slug, slug: form.slug, ...body }); toast({ tone: 'success', title: 'Layout saved', body: form.name }); onSaved() }
    catch (x) { setError(message(x)) } finally { setBusy(false) }
  }
  return <Modal wide title={layout ? `Edit ${layout.name}` : 'New Classic layout'} description="Strip layouts need a 1200 × 3600 canvas and reviewed slots before they can be enabled." onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={submit}>Save</Button></>}>
    <div className="flex gap-6">
      <div className="flex w-32 shrink-0 flex-col gap-2"><StripPreview layout={form} className="w-full" />{layout && <FilePick label="Frame" replace={!!layout.frame_asset_present} send={f => api.uploadAdminClassicFrame(layout.id, f)} done={onSaved} />}<p className="t-caption text-text-muted">PNG, {REQUIRED.w} × {REQUIRED.h}.</p></div>
      <div className="grid flex-1 grid-cols-2 gap-4">
        <TextField label="Slug" mono value={form.slug} disabled={!!layout} onChange={e => set('slug', e.target.value.trim())} /><TextField label="Name" value={form.name} onChange={e => set('name', e.target.value)} />
        <TextField label="Sort order" type="number" value={form.sort_order} onChange={e => set('sort_order', Number(e.target.value))} /><TextField label="Shots" type="number" min={1} max={8} value={form.shot_count} onChange={e => resize(Number(e.target.value))} helper="Customers must add exactly this many photos." />
        <TextField label="Canvas width" type="number" value={form.canvas_width} onChange={e => set('canvas_width', Number(e.target.value))} /><TextField label="Canvas height" type="number" value={form.canvas_height} onChange={e => set('canvas_height', Number(e.target.value))} />
      </div>
    </div>
    <div className="flex flex-col gap-2"><p className="t-label-s">Slots (pixels)</p>
      <div className="grid grid-cols-[48px_repeat(4,1fr)] items-center gap-x-3 gap-y-2">{['', 'x', 'y', 'width', 'height'].map(h => <span key={h} className="t-caption font-medium text-text-muted">{h}</span>)}
        {form.slots.map((s: Row, i: number) => <div key={i} className="contents"><span className="t-label-s">#{i + 1}</span>{(['x', 'y', 'width', 'height'] as const).map(k => <input key={k} type="number" aria-label={`Slot ${i + 1} ${k}`} value={s[k]} onChange={e => setSlot(i, k, Number(e.target.value))} className="t-body-s h-9 w-full rounded-sm border border-border bg-surface px-2 tabular-nums focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary" />)}</div>)}</div></div>
    <SwitchRow label="Enabled" description="Customers can pick this layout." checked={!!form.enabled} onChange={v => set('enabled', v)} />
    {error && <InlineAlert tone="danger" title="Layout rejected">{error}</InlineAlert>}
  </Modal>
}
export function ClassicLayouts() {
  const toast = useToast(); const r = useResource(() => api.getAdminClassicLayouts()); const [editing, setEditing] = useState<Row | 'new' | null>(null); const [disabling, setDisabling] = useState<Row | null>(null); const action = useAction(r.refresh)
  const items = rows(r.data, 'layouts'); const themes = [...new Set(items.map(l => l.theme_name || 'Classic Originals'))]
  return <AdminPage crumbs={[{ label: 'Catalog' }, { label: 'Classic layouts' }]} roles={['content_manager']}>
    <PageHeader title="Classic layouts" subtitle="Photo-strip layouts. Removing a layout disables it; it is never deleted." actions={<Button icon={Plus} onClick={() => setEditing('new')}>New layout</Button>} />
    <Gate resource={r} />
    {themes.map(theme => <section key={theme} className="flex flex-col gap-3"><h2 className="t-h4">{theme}</h2>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-5">{items.filter(l => (l.theme_name || 'Classic Originals') === theme).map(l => <li key={l.id} className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4">
        <button type="button" onClick={() => setEditing(l)} className={cn('mx-auto w-28 rounded-sm hover:ring-2 hover:ring-primary', !l.enabled && 'opacity-50')} aria-label={`Edit ${l.name}`}><StripPreview layout={l} className="w-full" /></button>
        <div className="flex flex-col gap-1.5"><div className="flex items-start justify-between gap-2"><p className="t-label-s">{l.name}</p><StatusChip value={l.enabled ? 'enabled' : 'disabled'} /></div><p className="t-caption text-text-muted">{l.shot_count} shots · {l.canvas_width} × {l.canvas_height}</p><div className="flex flex-wrap gap-1.5"><Chip tone={l.frame_asset_present ? 'success' : 'warning'}>{l.frame_asset_present ? 'Frame' : 'Frame missing'}</Chip></div></div>
        {l.enabled && <Button variant="tertiary" size="sm" icon={Ban} className="text-danger hover:bg-danger-soft" onClick={() => setDisabling(l)}>Disable</Button>}
      </li>)}</ul></section>)}
    {editing && <LayoutModal layout={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); r.refresh() }} />}
    {disabling && <ConfirmDialog title="Disable this layout?" description={`“${disabling.name}” stops appearing for customers. You can enable it again later.`} confirmLabel="Disable layout" destructive error={action.error} onClose={() => setDisabling(null)} onConfirm={async () => { if (await action.run(() => api.updateAdminClassicLayout(disabling.id, { enabled: false }))) { toast({ tone: 'success', title: 'Layout disabled', body: disabling.name }); setDisabling(null) } }} />}
  </AdminPage>
}

/* ───────────── Presets ───────────── */

type Kind = 'frame-styles' | 'ornaments'
function PresetModal({ kind, preset, onClose, onSaved }: { kind: Kind; preset: Row | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast(); const noun = kind === 'frame-styles' ? 'frame style' : 'ornament'; const [form, setForm] = useState<Row>(preset ?? { id: '', slug: '', name: '', description: '', prompt_fragment: '', enabled: true, sort_order: 10 }); const [errors, setErrors] = useState<Record<string, string>>({}); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }))
  async function submit() {
    const e: Record<string, string> = {}
    if (!preset && !SLUG.test(form.slug)) e.slug = 'Use lowercase letters, numbers and hyphens.'
    if (!String(form.name).trim()) e.name = 'Name is required.'
    if (!String(form.prompt_fragment).trim()) e.prompt_fragment = 'Add the text that is appended to the prompt.'
    setErrors(e); if (Object.keys(e).length) return
    setBusy(true); setError('')
    try {
      const body = { name: form.name, description: form.description, prompt_fragment: form.prompt_fragment, enabled: form.enabled, sort_order: form.sort_order }
      const [create, update] = kind === 'frame-styles' ? [api.createAdminFrameStyle, api.updateAdminFrameStyle] : [api.createAdminOrnament, api.updateAdminOrnament]
      if (preset) await update(preset.id, body); else await create({ id: form.id || form.slug, slug: form.slug, ...body })
      toast({ tone: 'success', title: 'Preset saved', body: form.name }); onSaved()
    } catch (x) { setError(message(x)) } finally { setBusy(false) }
  }
  return <Modal title={preset ? `Edit ${preset.name}` : `New ${noun}`} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={submit}>Save</Button></>}>
    <TextField label="Slug" mono value={form.slug} disabled={!!preset} onChange={e => set('slug', e.target.value.trim())} error={errors.slug} helper={preset ? 'The slug can’t be changed.' : undefined} />
    <TextField label="Name" value={form.name} onChange={e => set('name', e.target.value)} error={errors.name} />
    <TextField label="Description" value={form.description ?? ''} onChange={e => set('description', e.target.value)} helper="Shown to customers." />
    <TextArea label="Prompt fragment" mono rows={3} value={form.prompt_fragment ?? ''} onChange={e => set('prompt_fragment', e.target.value)} error={errors.prompt_fragment} helper="Admin-only. Appended to the experience prompt." />
    <TextField label="Sort order" type="number" value={form.sort_order} onChange={e => set('sort_order', Number(e.target.value))} />
    <SwitchRow label="Enabled" checked={!!form.enabled} onChange={v => set('enabled', v)} />
    {error && <InlineAlert tone="danger">{error}</InlineAlert>}
  </Modal>
}
export function Presets() {
  const [tab, setTab] = useState<Kind>('frame-styles'); const [editing, setEditing] = useState<Row | 'new' | null>(null)
  const r = useResource(() => tab === 'frame-styles' ? api.getAdminFrameStyles() : api.getAdminOrnaments(), [tab]); const action = useAction(r.refresh)
  const list = [...rows(r.data)].sort((a, b) => a.sort_order - b.sort_order)
  const columns: Column<Row>[] = [
    { key: 'name', header: 'Name', width: 'w-40', cell: p => <span className="t-label-s">{p.name}</span> }, { key: 'slug', header: 'Slug', width: 'w-36', cell: p => <code className="t-mono">{p.slug}</code> },
    { key: 'desc', header: 'Description', cell: p => p.description || <Dash /> }, { key: 'frag', header: 'Prompt fragment', cell: p => <span className="font-mono text-xs text-text-muted">{p.prompt_fragment}</span> },
    { key: 'status', header: 'Status', width: 'w-28', cell: p => <StatusChip value={p.enabled ? 'enabled' : 'disabled'} /> },
    { key: 'enabled', header: 'Enabled', width: 'w-24', cell: p => <span onClick={e => e.stopPropagation()}><Switch checked={!!p.enabled} label={`Enable ${p.name}`} onChange={v => action.run(() => (tab === 'frame-styles' ? api.updateAdminFrameStyle : api.updateAdminOrnament)(p.id, { enabled: v }))} /></span> },
    { key: 'order', header: 'Order', width: 'w-20', align: 'right', cell: p => p.sort_order },
  ]
  return <AdminPage crumbs={[{ label: 'Catalog' }, { label: 'Presets' }]} roles={['content_manager']}>
    <PageHeader title="Presets" subtitle="Frame styles and ornaments used by Advanced mode" actions={<Button icon={Plus} onClick={() => setEditing('new')}>New {tab === 'frame-styles' ? 'frame style' : 'ornament'}</Button>} />
    <Tabs value={tab} onChange={setTab} tabs={[{ id: 'frame-styles', label: 'Frame styles' }, { id: 'ornaments', label: 'Ornaments' }]} />
    <p className="t-caption text-text-muted">There is no delete — turn a preset off to hide it.</p>
    <Gate resource={r} />{action.error && <InlineAlert tone="danger">{action.error}</InlineAlert>}
    <DataTable caption={tab === 'frame-styles' ? 'Frame styles' : 'Ornaments'} columns={columns} rows={list} rowKey={p => p.id} loading={r.loading && !r.data} onRowClick={setEditing} />
    {editing && <PresetModal key={tab} kind={tab} preset={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); r.refresh() }} />}
  </AdminPage>
}

/* ───────────── Preview source ───────────── */

export function PreviewSource() {
  const toast = useToast(); const r = useResource(() => api.getAdminPreviewSources()); const [pending, setPending] = useState<File | null>(null); const action = useAction(r.refresh)
  const source = rows(r.data, 'sources')[0]
  return <AdminPage crumbs={[{ label: 'Catalog' }, { label: 'Preview source' }]} roles={['content_manager']}>
    <PageHeader title="Preview source" subtitle="The one demo portrait every AI preview is generated from" />
    <Gate resource={r} />
    {!r.loading && !source && !r.error && <div className="rounded-md border border-border bg-surface"><EmptyState title="No preview source" /></div>}
    {source && <div className="flex items-start gap-6">
      <div className="w-80 shrink-0"><ImageAssetPanel title={source.id} aspect="aspect-[2/3]" present={!!source.has_asset} src={source.has_asset ? '/api/admin/preview-sources/' + source.id + '/image' : undefined} constraints="JPG, PNG or WebP · portrait · a clear, front-facing, neutral expression · up to 12 MB." onUpload={setPending} /></div>
      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <Card title="Details"><KeyValueList items={[['Source ID', <code className="t-mono">{source.id}</code>], ['Type', source.source_type || '—'], ['File type', source.content_type || '—'], ['Updated', when(source.updated_at)], ['Updated by', source.updated_by || '—']]} /></Card>
        <InlineAlert tone="warning" title="Replacing this changes future previews">Existing previews are not regenerated automatically. After replacing the portrait, use “Generate missing previews” on the Experiences page, or regenerate each preview from its editor. Only the <code className="t-mono">portrait-default</code> source can be replaced.</InlineAlert>
      </div></div>}
    {pending && source && <ConfirmDialog title="Replace the preview source?" description={`${pending.name} will replace the current portrait.`} confirmLabel="Replace portrait" confirmText="I understand new previews will look different" error={action.error} onClose={() => setPending(null)} onConfirm={async () => { if (await action.run(() => api.uploadAdminPreviewSource(source.id, pending))) { setPending(null); toast({ tone: 'success', title: 'Preview source replaced' }) } }} />}
  </AdminPage>
}

/* ───────────── Plans & admin users ───────────── */

function RecordModal({ title, onClose, onSaved, children, save, valid }: { title: string; onClose: () => void; onSaved: () => void; children: ReactNode; save: () => Promise<any>; valid: () => Record<string, string> | null }) {
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  return <Modal title={title} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={async () => { if (valid()) return; setBusy(true); setError(''); try { await save(); onSaved() } catch (x) { setError(message(x)) } finally { setBusy(false) } }}>Save</Button></>}>{children}{error && <InlineAlert tone="danger">{error}</InlineAlert>}</Modal>
}
export function Plans() {
  const { role } = useRole(); const toast = useToast(); const canEdit = can(role, ['superadmin']); const r = useResource(() => api.getAdminPlans()); const [editing, setEditing] = useState<Row | 'new' | null>(null)
  const list = rows(r.data, 'plans')
  const columns: Column<Row>[] = [
    { key: 'name', header: 'Plan', width: 'w-40', cell: p => <span className="t-label-s">{p.name}</span> }, { key: 'code', header: 'Code', width: 'w-28', cell: p => <code className="t-mono">{p.code}</code> }, { key: 'desc', header: 'Description', cell: p => p.description || <Dash /> },
    { key: 'credits', header: 'AI credits / month', width: 'w-40', align: 'right', cell: p => p.monthly_ai_credits }, { key: 'period', header: 'Billing', width: 'w-28', cell: p => p.billing_period },
    { key: 'price', header: 'Price', width: 'w-36', align: 'right', cell: p => money(p.price_amount ?? 0, p.currency || 'IDR') }, { key: 'active', header: 'Status', width: 'w-28', cell: p => <StatusChip value={p.is_active ? 'active' : 'inactive'} /> },
    ...(canEdit ? [{ key: 'edit', header: '', width: 'w-24', cell: (p: Row) => <Button variant="tertiary" size="sm" icon={Pencil} aria-label={`Edit ${p.name}`} onClick={() => setEditing(p)}>Edit</Button> }] : []),
  ]
  return <AdminPage crumbs={[{ label: 'Business' }, { label: 'Plans' }]} roles={['operator']}>
    <PageHeader title="Plans" subtitle={canEdit ? 'Create and edit the plan catalog' : 'Read-only. Only a superadmin can create or edit plans.'} actions={canEdit && <Button icon={Plus} onClick={() => setEditing('new')}>New plan</Button>} />
    <InlineAlert tone="info">Billing isn't enabled — there is no checkout, payment method or invoice. Customers see plans for information only.</InlineAlert>
    <Gate resource={r} />
    <DataTable caption="Plans" columns={columns} rows={list} rowKey={p => p.id} loading={r.loading && !r.data} />
    {editing && <PlanForm plan={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); r.refresh(); toast({ tone: 'success', title: 'Plan saved' }) }} />}
  </AdminPage>
}
function PlanForm({ plan, onClose, onSaved }: { plan: Row | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Row>(plan ?? { id: '', code: '', name: '', description: '', monthly_ai_credits: 0, billing_period: 'month', price_amount: 0, currency: 'IDR', is_active: false }); const [errors, setErrors] = useState<Record<string, string>>({}); const set = (k: string, v: any) => setF(x => ({ ...x, [k]: v }))
  const valid = () => { const e: Record<string, string> = {}; if (!plan && !/^[a-z0-9_-]+$/.test(f.code)) e.code = 'Use lowercase letters, numbers, hyphens or underscores.'; if (!String(f.name).trim()) e.name = 'Name is required.'; if (f.monthly_ai_credits < 0) e.monthly_ai_credits = 'Enter 0 or more.'; setErrors(e); return Object.keys(e).length ? e : null }
  const save = () => { const body = { name: f.name, description: f.description, monthly_ai_credits: f.monthly_ai_credits, billing_period: f.billing_period, price_amount: f.price_amount, currency: f.currency, is_active: f.is_active }; return plan ? api.updateAdminPlan(plan.id, body) : api.createAdminPlan({ id: f.id || f.code, code: f.code, ...body }) }
  return <RecordModal title={plan ? `Edit ${plan.name}` : 'New plan'} onClose={onClose} onSaved={onSaved} save={save} valid={valid}>
    <InlineAlert tone="info">Billing isn't enabled. Plans are display-only for customers and assigned by hand.</InlineAlert>
    <div className="grid grid-cols-2 gap-4">
      <TextField label="Code" mono value={f.code} disabled={!!plan} onChange={e => set('code', e.target.value.trim())} error={errors.code} /><TextField label="Name" value={f.name} onChange={e => set('name', e.target.value)} error={errors.name} />
      <div className="col-span-2"><TextArea label="Description" rows={2} value={f.description ?? ''} onChange={e => set('description', e.target.value)} /></div>
      <TextField label="Monthly AI credits" type="number" min={0} value={f.monthly_ai_credits} onChange={e => set('monthly_ai_credits', Number(e.target.value))} error={errors.monthly_ai_credits} />
      <SelectField label="Billing period" value={f.billing_period} onChange={e => set('billing_period', e.target.value)} options={[{ value: 'none', label: 'None' }, { value: 'month', label: 'Monthly' }, { value: 'year', label: 'Yearly' }]} />
      <TextField label="Price" type="number" min={0} value={f.price_amount} onChange={e => set('price_amount', Number(e.target.value))} /><TextField label="Currency" value={f.currency} maxLength={3} onChange={e => set('currency', e.target.value.toUpperCase())} />
    </div>
    <SwitchRow label="Active" description="Inactive plans can't be assigned." checked={!!f.is_active} onChange={v => set('is_active', v)} />
  </RecordModal>
}

export function AdminUsers() {
  const toast = useToast(); const r = useResource(() => api.getAdminActors()); const [editing, setEditing] = useState<Row | 'new' | null>(null)
  const columns: Column<Row>[] = [
    { key: 'name', header: 'Name', cell: u => <span className="t-label-s">{u.name}</span> }, { key: 'email', header: 'Email', cell: u => u.email },
    { key: 'role', header: 'Role', width: 'w-44', cell: u => <Chip tone={u.role === 'superadmin' ? 'primary' : 'neutral'}>{u.role}</Chip> }, { key: 'active', header: 'Status', width: 'w-28', cell: u => <StatusChip value={u.is_active ? 'active' : 'inactive'} /> },
    { key: 'id', header: 'ID', width: 'w-40', cell: u => <code className="t-mono">{String(u.id).slice(0, 14)}</code> },
  ]
  return <AdminPage crumbs={[{ label: 'System' }, { label: 'Admin users' }]} roles={['superadmin']}>
    <PageHeader title="Admin users" subtitle="Accounts that hold an admin role" actions={<Button icon={Plus} onClick={() => setEditing('new')}>Add admin</Button>} />
    <InlineAlert tone="info">Admins sign in with their own registered NXBooth account. Roles are exact: an operator can’t open catalog pages and a content manager can’t open operations pages.</InlineAlert>
    <Gate resource={r} />
    <DataTable caption="Admin users" columns={columns} rows={rows(r.data, 'admin_users')} rowKey={u => u.id} loading={r.loading && !r.data} onRowClick={setEditing} />
    {editing && <AdminForm user={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); r.refresh(); toast({ tone: 'success', title: 'Admin saved' }) }} />}
  </AdminPage>
}
function AdminForm({ user, onClose, onSaved }: { user: Row | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Row>(user ?? { id: '', name: '', email: '', role: 'operator', is_active: true }); const [errors, setErrors] = useState<Record<string, string>>({}); const set = (k: string, v: any) => setF(x => ({ ...x, [k]: v }))
  const valid = () => { const e: Record<string, string> = {}; if (!String(f.name).trim()) e.name = 'Name is required.'; if (!/^\S+@\S+\.\S+$/.test(f.email)) e.email = 'Enter a valid email address.'; setErrors(e); return Object.keys(e).length ? e : null }
  const save = () => { const body = { name: f.name, email: f.email, role: f.role, is_active: f.is_active }; return user ? api.updateAdminUser(user.id, body) : api.createAdminUser({ id: f.id || undefined, ...body }) }
  return <RecordModal title={user ? `Edit ${user.name}` : 'Add admin'} onClose={onClose} onSaved={onSaved} save={save} valid={valid}>
    <TextField label="Name" value={f.name} onChange={e => set('name', e.target.value)} error={errors.name} /><TextField label="Email" type="email" value={f.email} onChange={e => set('email', e.target.value)} error={errors.email} helper="Must be an active, registered NXBooth account." />
    <SelectField label="Role" value={f.role} onChange={e => set('role', e.target.value)} helper="Roles are exact: an operator can’t open catalog pages and a content manager can’t open operations pages." options={['superadmin', 'operator', 'content_manager'].map(v => ({ value: v, label: v }))} />
    <SwitchRow label="Active" checked={!!f.is_active} onChange={v => set('is_active', v)} />
  </RecordModal>
}
