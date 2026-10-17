import { useState } from 'react'
import { Plus } from 'lucide-react'
import { AdminPage } from '../components/AdminShell'
import { type Column, DataTable } from '../components/DataTable'
import { Modal, useToast } from '../components/overlays'
import { Button, InlineAlert, PageHeader, StatusChip, Switch, SwitchRow, Tabs, TextArea, TextField } from '../components/ui'
import { frameStyles, ornaments, type Preset } from '../data/mock'

type Kind = 'frame-styles' | 'ornaments'

function PresetModal({ kind, preset, onSave, onClose }: { kind: Kind; preset: Preset | null; onSave: (p: Preset) => void; onClose: () => void }) {
  const noun = kind === 'frame-styles' ? 'frame style' : 'ornament'
  const [form, setForm] = useState<Preset>(preset ?? { id: '', slug: '', name: '', description: '', prompt_fragment: '', enabled: true, sort_order: 10 })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const set = <K extends keyof Preset>(k: K, v: Preset[K]) => setForm((f) => ({ ...f, [k]: v }))

  const submit = () => {
    const e: Record<string, string> = {}
    if (!preset && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form.slug)) e.slug = 'Use lowercase letters, numbers and hyphens.'
    if (!form.name.trim()) e.name = 'Name is required.'
    if (!form.prompt_fragment.trim()) e.prompt_fragment = 'Add the text that is appended to the prompt.'
    setErrors(e)
    if (!Object.keys(e).length) onSave({ ...form, id: form.id || `${kind === 'ornaments' ? 'or' : 'fs'}_${Date.now()}` })
  }

  return (
    <Modal
      title={preset ? `Edit ${preset.name}` : `New ${noun}`}
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
      <TextField label="Slug" mono value={form.slug} disabled={!!preset} onChange={(e) => set('slug', e.target.value.trim())} error={errors.slug} helper={preset ? 'The slug can’t be changed.' : undefined} />
      <TextField label="Name" value={form.name} onChange={(e) => set('name', e.target.value)} error={errors.name} />
      <TextField label="Description" value={form.description} onChange={(e) => set('description', e.target.value)} helper="Shown to customers." />
      <TextArea label="Prompt fragment" mono rows={3} value={form.prompt_fragment} onChange={(e) => set('prompt_fragment', e.target.value)} error={errors.prompt_fragment} helper="Admin-only. Appended to the experience prompt." />
      <TextField label="Sort order" type="number" value={form.sort_order} onChange={(e) => set('sort_order', Number(e.target.value))} />
      <SwitchRow label="Enabled" checked={form.enabled} onChange={(v) => set('enabled', v)} />
    </Modal>
  )
}

export function Presets() {
  const toast = useToast()
  const [tab, setTab] = useState<Kind>('frame-styles')
  const [data, setData] = useState({ 'frame-styles': frameStyles, ornaments })
  const [editing, setEditing] = useState<Preset | 'new' | null>(null)
  const rows = data[tab]

  const patch = (id: string, change: Partial<Preset>) => setData((d) => ({ ...d, [tab]: d[tab].map((p) => (p.id === id ? { ...p, ...change } : p)) }))

  const columns: Column<Preset>[] = [
    { key: 'name', header: 'Name', width: 'w-40', cell: (p) => <span className="t-label-s">{p.name}</span> },
    { key: 'slug', header: 'Slug', width: 'w-36', cell: (p) => <code className="t-mono">{p.slug}</code> },
    { key: 'desc', header: 'Description', cell: (p) => p.description },
    { key: 'frag', header: 'Prompt fragment', cell: (p) => <span className="font-mono text-xs text-text-muted">{p.prompt_fragment}</span> },
    { key: 'status', header: 'Status', width: 'w-28', cell: (p) => <StatusChip value={p.enabled ? 'enabled' : 'disabled'} /> },
    { key: 'enabled', header: 'Enabled', width: 'w-24', cell: (p) => <Switch checked={p.enabled} label={`Enable ${p.name}`} onChange={(v) => patch(p.id, { enabled: v })} /> },
    { key: 'order', header: 'Order', width: 'w-20', align: 'right', cell: (p) => p.sort_order },
  ]

  return (
    <AdminPage crumbs={[{ label: 'Catalog' }, { label: 'Presets' }]} roles={['content_manager']}>
      <PageHeader title="Presets" subtitle="Frame styles and ornaments used by Advanced mode" actions={<Button icon={Plus} onClick={() => setEditing('new')}>New {tab === 'frame-styles' ? 'frame style' : 'ornament'}</Button>} />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'frame-styles', label: 'Frame styles' },
          { id: 'ornaments', label: 'Ornaments' },
        ]}
      />
      {tab === 'ornaments' && <InlineAlert tone="warning">Per the migration notes, ornaments are currently camera effects and are not inserted into AI prompts. Confirm whether customers should see them.</InlineAlert>}
      <p className="t-caption text-text-muted">There is no delete — turn a preset off to hide it.</p>
      <DataTable caption={tab === 'frame-styles' ? 'Frame styles' : 'Ornaments'} columns={columns} rows={[...rows].sort((a, b) => a.sort_order - b.sort_order)} rowKey={(p) => p.id} onRowClick={setEditing} />

      {editing && (
        <PresetModal
          kind={tab}
          preset={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={(p) => {
            setData((d) => ({ ...d, [tab]: editing === 'new' ? [...d[tab], p] : d[tab].map((x) => (x.id === p.id ? p : x)) }))
            setEditing(null)
            toast({ tone: 'success', title: 'Preset saved', body: p.name })
          }}
        />
      )}
    </AdminPage>
  )
}
