import { useMemo, useState } from 'react'
import { Pencil, Plus } from 'lucide-react'
import { AdminPage } from '../components/AdminShell'
import { type Column, DataTable, usePaged } from '../components/DataTable'
import { FilterBar, Modal, SearchInput, useToast } from '../components/overlays'
import { Button, InlineAlert, InlineSelect, PageHeader, SelectField, StatusChip, SwitchRow, TextArea, TextField } from '../components/ui'
import { can, useRole } from '../lib/role'
import { money } from '../lib/format'
import { type Plan, plans as seedPlans, subscriptions } from '../data/mock'

function PlanModal({ plan, onSave, onClose }: { plan: Plan | null; onSave: (p: Plan) => void; onClose: () => void }) {
  const [form, setForm] = useState<Plan>(plan ?? { id: '', code: '', name: '', description: '', monthly_ai_credits: 0, billing_period: 'monthly', price_amount: 0, currency: 'IDR', is_active: false })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const set = <K extends keyof Plan>(k: K, v: Plan[K]) => setForm((f) => ({ ...f, [k]: v }))
  const submit = () => {
    const e: Record<string, string> = {}
    if (!plan && !/^[a-z0-9_-]+$/.test(form.code)) e.code = 'Use lowercase letters, numbers, hyphens or underscores.'
    if (!form.name.trim()) e.name = 'Name is required.'
    if (form.monthly_ai_credits < 0) e.monthly_ai_credits = 'Enter 0 or more.'
    setErrors(e)
    if (!Object.keys(e).length) onSave({ ...form, id: form.id || `pln_${Date.now()}` })
  }
  return (
    <Modal
      title={plan ? `Edit ${plan.name}` : 'New plan'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit}>Save plan</Button>
        </>
      }
    >
      <InlineAlert tone="info">Billing isn't enabled. Plans are display-only for customers and assigned by hand.</InlineAlert>
      <div className="grid grid-cols-2 gap-4">
        <TextField label="Code" mono value={form.code} disabled={!!plan} onChange={(e) => set('code', e.target.value.trim())} error={errors.code} />
        <TextField label="Name" value={form.name} onChange={(e) => set('name', e.target.value)} error={errors.name} />
        <div className="col-span-2">
          <TextArea label="Description" rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} />
        </div>
        <TextField label="Monthly AI credits" type="number" min={0} value={form.monthly_ai_credits} onChange={(e) => set('monthly_ai_credits', Number(e.target.value))} error={errors.monthly_ai_credits} />
        <SelectField label="Billing period" value={form.billing_period} onChange={(e) => set('billing_period', e.target.value)} options={[{ value: 'none', label: 'None' }, { value: 'monthly', label: 'Monthly' }, { value: 'yearly', label: 'Yearly' }]} />
        <TextField label="Price" type="number" min={0} value={form.price_amount} onChange={(e) => set('price_amount', Number(e.target.value))} />
        <TextField label="Currency" value={form.currency} maxLength={3} onChange={(e) => set('currency', e.target.value.toUpperCase())} />
      </div>
      <SwitchRow label="Active" description="Inactive plans can't be assigned." checked={form.is_active} onChange={(v) => set('is_active', v)} />
    </Modal>
  )
}

export function Plans() {
  const { role } = useRole()
  const toast = useToast()
  const canEdit = can(role, ['superadmin'])
  const [items, setItems] = useState(seedPlans)
  const [editing, setEditing] = useState<Plan | 'new' | null>(null)

  const columns: Column<Plan>[] = [
    { key: 'name', header: 'Plan', width: 'w-40', cell: (p) => <span className="t-label-s">{p.name}</span> },
    { key: 'code', header: 'Code', width: 'w-28', cell: (p) => <code className="t-mono">{p.code}</code> },
    { key: 'desc', header: 'Description', cell: (p) => p.description },
    { key: 'credits', header: 'AI credits / month', width: 'w-40', align: 'right', cell: (p) => p.monthly_ai_credits },
    { key: 'period', header: 'Billing', width: 'w-28', cell: (p) => p.billing_period },
    { key: 'price', header: 'Price', width: 'w-36', align: 'right', cell: (p) => money(p.price_amount, p.currency) },
    { key: 'active', header: 'Status', width: 'w-28', cell: (p) => <StatusChip value={p.is_active ? 'active' : 'inactive'} /> },
    ...(canEdit ? [{ key: 'edit', header: '', width: 'w-24', cell: (p: Plan) => <Button variant="tertiary" size="sm" icon={Pencil} aria-label={`Edit ${p.name}`} onClick={() => setEditing(p)}>Edit</Button> }] : []),
  ]

  return (
    <AdminPage crumbs={[{ label: 'Business' }, { label: 'Plans' }]} roles={['operator']}>
      <PageHeader title="Plans" subtitle={canEdit ? 'Create and edit the plan catalog' : 'Read-only. Only a superadmin can create or edit plans.'} actions={canEdit && <Button icon={Plus} onClick={() => setEditing('new')}>New plan</Button>} />
      <InlineAlert tone="info">Billing isn't enabled — there is no checkout, payment method or invoice. Customers see plans for information only.</InlineAlert>
      <DataTable caption="Plans" columns={columns} rows={items} rowKey={(p) => p.id} />
      {editing && (
        <PlanModal
          plan={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={(p) => {
            setItems((l) => (editing === 'new' ? [...l, p] : l.map((x) => (x.id === p.id ? p : x))))
            setEditing(null)
            toast({ tone: 'success', title: 'Plan saved', body: p.name })
          }}
        />
      )}
    </AdminPage>
  )
}

type Sub = (typeof subscriptions)[number]

export function Subscriptions() {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const filtered = useMemo(() => subscriptions.filter((s) => (!q || s.user_email.includes(q.toLowerCase())) && (!status || s.status === status)), [q, status])
  const { rows, pagination } = usePaged(filtered)
  const columns: Column<Sub>[] = [
    { key: 'user', header: 'User', cell: (s) => s.user_email },
    { key: 'plan', header: 'Plan', width: 'w-28', cell: (s) => s.plan },
    { key: 'status', header: 'Status', width: 'w-32', cell: (s) => <StatusChip value={s.status} /> },
    { key: 'start', header: 'Period start', width: 'w-36', cell: (s) => <span className="text-text-muted">{s.period_start}</span> },
    { key: 'end', header: 'Period end', width: 'w-36', cell: (s) => <span className="text-text-muted">{s.period_end}</span> },
    { key: 'source', header: 'Source', width: 'w-40', cell: (s) => <code className="t-mono">{s.source}</code> },
  ]
  return (
    <AdminPage crumbs={[{ label: 'Business' }, { label: 'Subscriptions' }]} roles={['operator']}>
      <PageHeader title="Subscriptions" subtitle="Latest 200 subscriptions" />
      <FilterBar onReset={() => (setQ(''), setStatus(''))}>
        <SearchInput value={q} onChange={setQ} placeholder="Search user email" />
        <InlineSelect aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: '', label: 'Status: All' }, { value: 'active', label: 'Active' }, { value: 'cancelled', label: 'Cancelled' }, { value: 'expired', label: 'Expired' }]} />
      </FilterBar>
      <DataTable caption="Subscriptions" columns={columns} rows={rows} rowKey={(s) => s.id} pagination={pagination} empty={{ title: 'No subscriptions match', body: 'Plans are assigned from a user’s detail page.' }} />
    </AdminPage>
  )
}
