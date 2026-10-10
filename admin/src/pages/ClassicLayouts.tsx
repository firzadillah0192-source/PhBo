import { useState } from 'react'
import { Ban, Plus } from 'lucide-react'
import { AdminPage } from '../components/AdminShell'
import { ConfirmDialog, Modal, useToast } from '../components/overlays'
import { Button, Chip, cn, InlineAlert, PageHeader, StatusChip, SwitchRow, TextField } from '../components/ui'
import { type ClassicLayout, classicLayouts as seed, type Slot } from '../data/mock'

const REQUIRED = { w: 1200, h: 3600 }

/** Mirrors the server rule that returns 422 CLASSIC_LAYOUT_INVALID. */
const problems = (l: ClassicLayout) => {
  const out: string[] = []
  if (l.canvas_width !== REQUIRED.w || l.canvas_height !== REQUIRED.h) out.push(`Canvas must be ${REQUIRED.w} × ${REQUIRED.h} (currently ${l.canvas_width} × ${l.canvas_height}).`)
  if (l.slots.length !== l.shot_count) out.push(`Slots (${l.slots.length}) must match the shot count (${l.shot_count}).`)
  if (!l.slots_reviewed) out.push('Slots have not been reviewed.')
  if (!l.frame_asset_present) out.push('Upload the frame PNG.')
  return out
}

function StripPreview({ layout, className }: { layout: ClassicLayout; className?: string }) {
  const s = 100 / layout.canvas_width
  return (
    <div role="img" aria-label={`${layout.name} strip preview with ${layout.shot_count} slots`} className={cn('relative overflow-hidden rounded-sm border border-border bg-white', className)} style={{ aspectRatio: `${layout.canvas_width} / ${layout.canvas_height}` }}>
      {layout.slots.map((sl: Slot, i) => (
        <span key={i} className="absolute rounded-[2px] bg-gradient-to-br from-[#A18CD1] to-[#FBC2EB]" style={{ left: `${sl.x * s}%`, top: `${(sl.y / layout.canvas_height) * 100}%`, width: `${sl.width * s}%`, height: `${(sl.height / layout.canvas_height) * 100}%` }} />
      ))}
      {!layout.frame_asset_present && <span className="absolute inset-0 flex items-center justify-center bg-surface-2/70 px-2 text-center text-xs font-medium text-text-muted">No frame</span>}
    </div>
  )
}

function LayoutModal({ layout, onSave, onClose }: { layout: ClassicLayout | null; onSave: (l: ClassicLayout) => void; onClose: () => void }) {
  const [form, setForm] = useState<ClassicLayout>(
    layout ?? { id: '', slug: '', name: '', canvas_width: REQUIRED.w, canvas_height: REQUIRED.h, shot_count: 3, slots: [], slots_reviewed: false, enabled: false, sort_order: 10, frame_asset_present: false, theme_slug: '', theme_name: '' },
  )
  const [serverError, setServerError] = useState<string[]>([])
  const set = <K extends keyof ClassicLayout>(k: K, v: ClassicLayout[K]) => setForm((f) => ({ ...f, [k]: v }))
  const setSlot = (i: number, key: keyof Slot, v: number) => set('slots', form.slots.map((s, j) => (j === i ? { ...s, [key]: v } : s)))

  const resizeSlots = (n: number) => {
    const count = Math.max(1, Math.min(8, n))
    const h = Math.floor((form.canvas_height - 420 - 60 * (count + 1)) / count)
    setForm((f) => ({ ...f, shot_count: count, slots_reviewed: false, slots: Array.from({ length: count }, (_, i) => f.slots[i] ?? { x: 84, y: 60 + i * (h + 60), width: 1032, height: h }) }))
  }

  const submit = () => {
    const issues = form.enabled ? problems(form) : []
    if (issues.length) return setServerError(issues)
    onSave({ ...form, id: form.id || `cl_${Date.now()}` })
  }

  return (
    <Modal
      wide
      title={layout ? `Edit ${layout.name}` : 'New Classic layout'}
      description="Strip layouts need a 1200 × 3600 canvas and reviewed slots before they can be enabled."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit}>Save</Button>
        </>
      }
    >
      <div className="flex gap-6">
        <div className="flex w-32 shrink-0 flex-col gap-2">
          <StripPreview layout={form} className="w-full" />
          <Button variant="secondary" size="sm" onClick={() => set('frame_asset_present', true)}>
            {form.frame_asset_present ? 'Replace frame' : 'Upload frame'}
          </Button>
          <p className="t-caption text-text-muted">PNG, {REQUIRED.w} × {REQUIRED.h}.</p>
        </div>
        <div className="grid flex-1 grid-cols-2 gap-4">
          <TextField label="Slug" mono value={form.slug} disabled={!!layout} onChange={(e) => set('slug', e.target.value.trim())} />
          <TextField label="Name" value={form.name} onChange={(e) => set('name', e.target.value)} />
          <TextField label="Theme" value={form.theme_name} onChange={(e) => (set('theme_name', e.target.value), set('theme_slug', e.target.value.toLowerCase()))} />
          <TextField label="Sort order" type="number" value={form.sort_order} onChange={(e) => set('sort_order', Number(e.target.value))} />
          <TextField label="Canvas width" type="number" value={form.canvas_width} onChange={(e) => set('canvas_width', Number(e.target.value))} />
          <TextField label="Canvas height" type="number" value={form.canvas_height} onChange={(e) => set('canvas_height', Number(e.target.value))} />
          <TextField label="Shots" type="number" min={1} max={8} value={form.shot_count} onChange={(e) => resizeSlots(Number(e.target.value))} helper="Customers must add exactly this many photos." />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <p className="t-label-s">Slots (pixels)</p>
        <div className="grid grid-cols-[48px_repeat(4,1fr)] items-center gap-x-3 gap-y-2">
          {['', 'x', 'y', 'width', 'height'].map((h) => (
            <span key={h} className="t-caption font-medium text-text-muted">
              {h}
            </span>
          ))}
          {form.slots.map((s, i) => (
            <div key={i} className="contents">
              <span className="t-label-s">#{i + 1}</span>
              {(['x', 'y', 'width', 'height'] as const).map((k) => (
                <input key={k} type="number" aria-label={`Slot ${i + 1} ${k}`} value={s[k]} onChange={(e) => setSlot(i, k, Number(e.target.value))} className="t-body-s h-9 w-full rounded-sm border border-border bg-surface px-2 tabular-nums focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary" />
              ))}
            </div>
          ))}
        </div>
        <SwitchRow label="Slots reviewed" description="Confirm the numbers above line up with the frame art." checked={form.slots_reviewed} onChange={(v) => set('slots_reviewed', v)} />
      </div>

      <SwitchRow label="Enabled" description="Customers can pick this layout." checked={form.enabled} onChange={(v) => (set('enabled', v), setServerError([]))} />
      {serverError.length > 0 && (
        <InlineAlert tone="danger" title="CLASSIC_LAYOUT_INVALID">
          <ul className="list-disc pl-4">
            {serverError.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </InlineAlert>
      )}
    </Modal>
  )
}

export function ClassicLayouts() {
  const toast = useToast()
  const [items, setItems] = useState(seed)
  const [editing, setEditing] = useState<ClassicLayout | 'new' | null>(null)
  const [disabling, setDisabling] = useState<ClassicLayout | null>(null)
  const themes = [...new Set(items.map((l) => l.theme_name))]

  return (
    <AdminPage crumbs={[{ label: 'Catalog' }, { label: 'Classic layouts' }]} roles={['content_manager']}>
      <PageHeader title="Classic layouts" subtitle="Photo-strip layouts. Removing a layout disables it; it is never deleted." actions={<Button icon={Plus} onClick={() => setEditing('new')}>New layout</Button>} />
      {themes.map((theme) => (
        <section key={theme} className="flex flex-col gap-3">
          <h2 className="t-h4">{theme}</h2>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-5">
            {items
              .filter((l) => l.theme_name === theme)
              .map((l) => (
                <li key={l.id} className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4">
                  <button type="button" onClick={() => setEditing(l)} className={cn('mx-auto w-28 rounded-sm hover:ring-2 hover:ring-primary', !l.enabled && 'opacity-50')} aria-label={`Edit ${l.name}`}>
                    <StripPreview layout={l} className="w-full" />
                  </button>
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="t-label-s">{l.name}</p>
                      <StatusChip value={l.enabled ? 'enabled' : 'disabled'} />
                    </div>
                    <p className="t-caption text-text-muted">{l.shot_count} shots · {l.canvas_width} × {l.canvas_height}</p>
                    <div className="flex flex-wrap gap-1.5">
                      <Chip tone={l.frame_asset_present ? 'success' : 'warning'}>{l.frame_asset_present ? 'Frame' : 'Frame missing'}</Chip>
                      {!l.slots_reviewed && <Chip tone="warning">Slots unreviewed</Chip>}
                    </div>
                  </div>
                  {l.enabled && (
                    <Button variant="tertiary" size="sm" icon={Ban} className="text-danger hover:bg-danger-soft" onClick={() => setDisabling(l)}>
                      Disable
                    </Button>
                  )}
                </li>
              ))}
          </ul>
        </section>
      ))}

      {editing && (
        <LayoutModal
          layout={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={(l) => {
            setItems((list) => (editing === 'new' ? [...list, l] : list.map((x) => (x.id === l.id ? l : x))))
            setEditing(null)
            toast({ tone: 'success', title: 'Layout saved', body: l.name })
          }}
        />
      )}
      {disabling && (
        <ConfirmDialog
          title="Disable this layout?"
          description={`“${disabling.name}” stops appearing for customers. You can enable it again later.`}
          confirmLabel="Disable layout"
          destructive
          onClose={() => setDisabling(null)}
          onConfirm={() => {
            setItems((l) => l.map((x) => (x.id === disabling.id ? { ...x, enabled: false } : x)))
            toast({ tone: 'success', title: 'Layout disabled', body: disabling.name })
            setDisabling(null)
          }}
        />
      )}
    </AdminPage>
  )
}
