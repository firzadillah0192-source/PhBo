import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronRight, Plus } from 'lucide-react'
import { AdminPage } from '../components/AdminShell'
import { type Column, DataTable, usePaged } from '../components/DataTable'
import { FilterBar, Modal, useToast } from '../components/overlays'
import { Button, Card, Chip, CodeValue, InlineAlert, InlineSelect, KeyValueList, PageHeader, SelectField, StatusChip, SwitchRow, TextField, type Tone } from '../components/ui'
import { bytes } from '../lib/format'
import { type AdminUser, adminUsers as seedAdmins, audit, auditActions, ledger, type LedgerEntry, ledgerTypes, settings } from '../data/mock'
import type { Role } from '../lib/role'

/* ── Credits ledger ── */

const typeTone = (t: string): Tone => (t === 'generation_refund' ? 'success' : t === 'generation_spend' ? 'accent' : t === 'signup_bonus' ? 'info' : t === 'admin_deduct' ? 'danger' : 'primary')

export function CreditsLedger() {
  const navigate = useNavigate()
  const [type, setType] = useState('')
  const filtered = useMemo(() => ledger.filter((l) => !type || l.type === type), [type])
  const { rows, pagination } = usePaged(filtered, 25)

  const columns: Column<LedgerEntry>[] = [
    { key: 'amount', header: 'Amount', width: 'w-24', align: 'right', cell: (l) => <span className={`font-semibold ${l.amount > 0 ? 'text-success' : 'text-danger'}`}>{l.amount > 0 ? `+${l.amount}` : `−${Math.abs(l.amount)}`}</span> },
    { key: 'type', header: 'Type', width: 'w-44', cell: (l) => <Chip tone={typeTone(l.type)}>{l.type}</Chip> },
    { key: 'reason', header: 'Reason', cell: (l) => l.reason },
    { key: 'user', header: 'User', width: 'w-56', cell: (l) => l.user },
    { key: 'gen', header: 'Generation', width: 'w-36', cell: (l) => (l.related_generation_id ? <code className="t-mono text-primary">{l.related_generation_id}</code> : <span className="text-text-muted">—</span>) },
    { key: 'actor', header: 'Actor', width: 'w-24', cell: (l) => (l.admin_actor_id ? <code className="t-mono">{l.admin_actor_id}</code> : <span className="text-text-muted">system</span>) },
    { key: 'date', header: 'Date', width: 'w-36', cell: (l) => <span className="text-text-muted">{l.created_at}</span> },
  ]

  return (
    <AdminPage crumbs={[{ label: 'Operations' }, { label: 'Credits ledger' }]} roles={['operator']}>
      <PageHeader title="Credits ledger" subtitle="Every credit movement across all users" />
      <FilterBar onReset={() => setType('')}>
        <InlineSelect aria-label="Entry type" value={type} onChange={(e) => setType(e.target.value)} options={[{ value: '', label: 'Type: All' }, ...ledgerTypes.map((t) => ({ value: t, label: t }))]} />
      </FilterBar>
      <DataTable caption="Credits ledger" columns={columns} rows={rows} rowKey={(l) => l.id} pagination={pagination} onRowClick={(l) => l.related_generation_id && navigate(`/usage/generations/${l.related_generation_id}`)} />
    </AdminPage>
  )
}

/* ── Audit log ── */

type Audit = (typeof audit)[number]

export function AuditLog() {
  const [action, setAction] = useState('')
  const [limit, setLimit] = useState('100')
  const [open, setOpen] = useState<string | null>(null)
  const rows = useMemo(() => audit.filter((a) => !action || a.action === action).slice(0, Number(limit)), [action, limit])

  const columns: Column<Audit>[] = [
    { key: 'caret', header: '', width: 'w-10', cell: (a) => (open === a.id ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />) },
    { key: 'when', header: 'When', width: 'w-40', cell: (a) => <span className="text-text-muted">{a.created_at}</span> },
    { key: 'actor', header: 'Actor', width: 'w-24', cell: (a) => <code className="t-mono">{a.admin_actor_id}</code> },
    { key: 'action', header: 'Action', width: 'w-60', cell: (a) => <code className="t-mono">{a.action}</code> },
    { key: 'target', header: 'Target', width: 'w-60', cell: (a) => (<span><span className="text-text-muted">{a.target_type} · </span><code className="t-mono">{a.target_id}</code></span>) },
    { key: 'reason', header: 'Reason', cell: (a) => a.reason ?? <span className="text-text-muted">—</span> },
  ]

  return (
    <AdminPage crumbs={[{ label: 'System' }, { label: 'Audit log' }]} roles={['operator']}>
      <PageHeader title="Audit log" subtitle="Who changed what. Entries are written automatically and can’t be edited." />
      <FilterBar onReset={() => (setAction(''), setLimit('100'))}>
        <InlineSelect aria-label="Action" value={action} onChange={(e) => setAction(e.target.value)} options={[{ value: '', label: 'Action: All' }, ...auditActions.map((a) => ({ value: a, label: a }))]} />
        <InlineSelect aria-label="Limit" value={limit} onChange={(e) => setLimit(e.target.value)} options={[{ value: '50', label: 'Latest 50' }, { value: '100', label: 'Latest 100' }, { value: '500', label: 'Latest 500 (max)' }]} />
      </FilterBar>
      <DataTable
        caption="Audit log"
        columns={columns}
        rows={rows}
        rowKey={(a) => a.id}
        onRowClick={(a) => setOpen(open === a.id ? null : a.id)}
        expanded={(a) =>
          open === a.id ? (
            <div>
              <p className="t-label-xs mb-1.5 text-text-muted">METADATA</p>
              <pre className="overflow-x-auto rounded-sm bg-surface-2 p-3 font-mono text-xs leading-5">{JSON.stringify(a.metadata, null, 2)}</pre>
            </div>
          ) : null
        }
      />
    </AdminPage>
  )
}

/* ── Admin users ── */

function AdminUserModal({ user, onSave, onClose }: { user: AdminUser | null; onSave: (u: AdminUser) => void; onClose: () => void }) {
  const [form, setForm] = useState<AdminUser>(user ?? { id: '', name: '', email: '', role: 'operator', is_active: true })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const set = <K extends keyof AdminUser>(k: K, v: AdminUser[K]) => setForm((f) => ({ ...f, [k]: v }))
  const submit = () => {
    const e: Record<string, string> = {}
    if (!form.name.trim()) e.name = 'Name is required.'
    if (!/^\S+@\S+\.\S+$/.test(form.email)) e.email = 'Enter a valid email address.'
    setErrors(e)
    if (!Object.keys(e).length) onSave({ ...form, id: form.id || `adm_${String(Date.now()).slice(-4)}` })
  }
  return (
    <Modal
      title={user ? `Edit ${user.name}` : 'Add admin'}
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
      <TextField label="Name" value={form.name} onChange={(e) => set('name', e.target.value)} error={errors.name} />
      <TextField label="Email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} error={errors.email} />
      <SelectField label="Role" value={form.role} onChange={(e) => set('role', e.target.value as Role)} helper="Roles are exact: an operator can’t open catalog pages and a content manager can’t open operations pages." options={[{ value: 'superadmin', label: 'superadmin' }, { value: 'operator', label: 'operator' }, { value: 'content_manager', label: 'content_manager' }]} />
      <SwitchRow label="Active" checked={form.is_active} onChange={(v) => set('is_active', v)} />
    </Modal>
  )
}

export function AdminUsers() {
  const toast = useToast()
  const [items, setItems] = useState(seedAdmins)
  const [editing, setEditing] = useState<AdminUser | 'new' | null>(null)

  const columns: Column<AdminUser>[] = [
    { key: 'name', header: 'Name', cell: (u) => <span className="t-label-s">{u.name}</span> },
    { key: 'email', header: 'Email', cell: (u) => u.email },
    { key: 'role', header: 'Role', width: 'w-44', cell: (u) => <Chip tone={u.role === 'superadmin' ? 'primary' : 'neutral'}>{u.role}</Chip> },
    { key: 'active', header: 'Status', width: 'w-28', cell: (u) => <StatusChip value={u.is_active ? 'active' : 'inactive'} /> },
    { key: 'id', header: 'ID', width: 'w-28', cell: (u) => <code className="t-mono">{u.id}</code> },
  ]

  return (
    <AdminPage crumbs={[{ label: 'System' }, { label: 'Admin users' }]} roles={['superadmin']}>
      <PageHeader title="Admin users" subtitle="Role bookkeeping" actions={<Button icon={Plus} onClick={() => setEditing('new')}>Add admin</Button>} />
      <InlineAlert tone="warning" title="These people can’t sign in individually">
        Everyone signs in with one shared admin token and gets the default role. This list records who holds which role; it doesn’t control access.
      </InlineAlert>
      <DataTable caption="Admin users" columns={columns} rows={items} rowKey={(u) => u.id} onRowClick={setEditing} />
      {editing && (
        <AdminUserModal
          user={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={(u) => {
            setItems((l) => (editing === 'new' ? [...l, u] : l.map((x) => (x.id === u.id ? u : x))))
            setEditing(null)
            toast({ tone: 'success', title: 'Admin saved', body: u.name })
          }}
        />
      )}
    </AdminPage>
  )
}

/* ── Settings ── */

export function Settings() {
  return (
    <AdminPage crumbs={[{ label: 'System' }, { label: 'Settings' }]} roles={['operator']}>
      <PageHeader title="Settings" subtitle="Read-only. Change these in the server configuration." />
      <Card className="max-w-2xl">
        <KeyValueList
          items={[
            ['Environment', <Chip tone={settings.environment === 'production' ? 'danger' : 'info'}>{settings.environment}</Chip>],
            ['AI provider', <CodeValue value={settings.ai_provider} />],
            ['Google sign-in', <StatusChip value={settings.google_configured ? 'ready' : 'missing'} label={settings.google_configured ? 'Configured' : 'Not configured'} />],
            ['Upload max size', bytes(settings.upload_max_bytes)],
            ['Upload min dimension', `${settings.upload_min_dimension} px`],
            ['Upload max dimension', `${settings.upload_max_dimension} px`],
            ['Default admin role', <code className="t-mono">{settings.admin_default_role}</code>],
          ]}
        />
      </Card>
    </AdminPage>
  )
}
