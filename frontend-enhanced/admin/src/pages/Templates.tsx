import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { AdminPage } from '../components/AdminShell'
import { ConfirmDialog, Modal, useToast } from '../components/overlays'
import { Button, Chip, InlineAlert, PageHeader, StatusChip, SwitchRow, TextArea, TextField, Thumb, cn } from '../components/ui'
import { type Template, templates as seed } from '../data/mock'

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return <Chip tone={ok ? 'success' : 'warning'}>{ok ? label : `${label} missing`}</Chip>
}

function TemplateModal({ template, onSave, onDelete, onClose }: { template: Template | null; onSave: (t: Template) => void; onDelete?: () => void; onClose: () => void }) {
  const [form, setForm] = useState<Template>(
    template ?? { id: '', name: '', description: '', enabled: true, sort_order: 10, preview_missing: true, processing_asset_present: false, canvas_width: 2160, canvas_height: 3240, aspect_ratio: '2:3', framed: false, updated_at: '', updated_by: '' },
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const set = <K extends keyof Template>(k: K, v: Template[K]) => setForm((f) => ({ ...f, [k]: v }))

  const submit = () => {
    const e: Record<string, string> = {}
    if (!template && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form.id)) e.id = 'Use lowercase letters, numbers and hyphens.'
    if (!form.name.trim()) e.name = 'Name is required.'
    setErrors(e)
    if (!Object.keys(e).length) onSave(form)
  }

  return (
    <Modal
      wide
      title={template ? `Edit ${template.name}` : 'New template'}
      description="Basic-mode scene. The master image is what the AI blends the customer into."
      onClose={onClose}
      footer={
        <>
          {onDelete && (
            <Button variant="tertiary" icon={Trash2} className="mr-auto text-danger hover:bg-danger-soft" onClick={onDelete}>
              Delete
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit}>{template ? 'Save' : 'Create template'}</Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-5">
        <TextField label="ID" mono value={form.id} disabled={!!template} onChange={(e) => set('id', e.target.value.trim())} error={errors.id} />
        <TextField label="Name" value={form.name} onChange={(e) => set('name', e.target.value)} error={errors.name} />
        <div className="col-span-2">
          <TextArea label="Description" rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} />
        </div>
        <TextField label="Sort order" type="number" min={0} value={form.sort_order} onChange={(e) => set('sort_order', Number(e.target.value))} />
        <TextField label="Canvas" value={`${form.canvas_width} × ${form.canvas_height} (${form.aspect_ratio})`} disabled helper="Read from the master image." />
        <div className="col-span-2">
          <SwitchRow label="Enabled" description="Hidden from customers when off." checked={form.enabled} onChange={(v) => set('enabled', v)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-5">
        <div className="flex flex-col gap-2 rounded-md border border-border p-4">
          <div className="flex items-center justify-between">
            <p className="t-label-s">Master image</p>
            <Badge ok={form.processing_asset_present} label="Present" />
          </div>
          <p className="t-caption text-text-muted">PNG or JPG, 2:3. Not shown to customers.</p>
          <Button variant="secondary" onClick={() => set('processing_asset_present', true)}>
            {form.processing_asset_present ? 'Replace image' : 'Upload image'}
          </Button>
        </div>
        <div className="flex flex-col gap-2 rounded-md border border-border p-4">
          <div className="flex items-center justify-between">
            <p className="t-label-s">Marketing preview</p>
            <Badge ok={!form.preview_missing} label="Present" />
          </div>
          <p className="t-caption text-text-muted">Shown on the customer template card.</p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => set('preview_missing', false)}>
              {form.preview_missing ? 'Upload preview' : 'Replace'}
            </Button>
            {!form.preview_missing && (
              <Button variant="tertiary" className="text-danger hover:bg-danger-soft" onClick={() => set('preview_missing', true)}>
                Remove
              </Button>
            )}
          </div>
        </div>
      </div>
      {form.enabled && (!form.processing_asset_present || form.preview_missing) && <InlineAlert tone="warning">This template is enabled but missing an image. Customers may see a placeholder or be unable to pick it.</InlineAlert>}
    </Modal>
  )
}

export function Templates() {
  const toast = useToast()
  const [items, setItems] = useState(seed)
  const [editing, setEditing] = useState<Template | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Template | null>(null)

  return (
    <AdminPage crumbs={[{ label: 'Catalog' }, { label: 'Templates' }]} roles={['content_manager']}>
      <PageHeader title="Templates" subtitle="Scenes for Basic mode" actions={<Button icon={Plus} onClick={() => setEditing('new')}>New template</Button>} />
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-5">
        {items.map((t) => (
          <li key={t.id}>
            <button type="button" onClick={() => setEditing(t)} className="flex w-full flex-col gap-3 rounded-md border border-border bg-surface p-3 text-left hover:border-primary">
              <Thumb seed={t.sort_order} missing={t.preview_missing} alt={t.name} className={cn('aspect-[2/3] w-full', !t.enabled && 'opacity-50')} />
              <div className="flex flex-col gap-1.5 px-1 pb-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="t-label-s">{t.name}</p>
                  <StatusChip value={t.enabled ? 'enabled' : 'disabled'} />
                </div>
                <p className="t-caption text-text-muted">
                  {t.canvas_width} × {t.canvas_height} · {t.aspect_ratio} · {t.framed ? 'Framed' : 'No frame'}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <Badge ok={t.processing_asset_present} label="Master" />
                  <Badge ok={!t.preview_missing} label="Preview" />
                </div>
              </div>
            </button>
          </li>
        ))}
      </ul>

      {editing && (
        <TemplateModal
          template={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDelete={editing === 'new' ? undefined : () => (setDeleting(editing), setEditing(null))}
          onSave={(t) => {
            setItems((list) => (editing === 'new' ? [...list, t] : list.map((x) => (x.id === t.id ? t : x))))
            setEditing(null)
            toast({ tone: 'success', title: editing === 'new' ? 'Template created' : 'Template saved', body: t.name })
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete this template?"
          description={`“${deleting.name}” and its images are removed permanently.`}
          confirmLabel="Delete template"
          confirmText="I understand this can’t be undone"
          destructive
          onClose={() => setDeleting(null)}
          onConfirm={() => {
            setItems((l) => l.filter((x) => x.id !== deleting.id))
            toast({ tone: 'success', title: 'Template deleted', body: deleting.name })
            setDeleting(null)
          }}
        />
      )}
    </AdminPage>
  )
}
