import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AdminPage } from '../components/AdminShell'
import { type Column, DataTable, usePaged } from '../components/DataTable'
import { ConfirmDialog, FilterBar, SearchInput, useToast } from '../components/overlays'
import { Button, Chip, EmptyState, InlineSelect, KeyValueList, PageHeader, SelectField, StatTile, StatusChip, Tabs, TextField, type Tone } from '../components/ui'
import { audit, plans } from '../data/mock'
import { ayuLedger, type UserLedgerRow, type UserRow, userRows, userSessions } from '../data/ops'

const Avatar = ({ initials }: { initials: string }) => (
  <span aria-hidden className="t-label-xs flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
    {initials}
  </span>
)

/* ───────────── Users list ───────────── */

export function Users() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [sort, setSort] = useState('last_activity')
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    const list = userRows.filter((u) => (!status || u.status === status) && (!term || u.email.toLowerCase().includes(term) || u.name.toLowerCase().includes(term)))
    return sort === 'joined' ? [...list].reverse() : list
  }, [q, status, sort])
  const { rows, pagination } = usePaged(filtered, 50)

  const columns: Column<UserRow>[] = [
    {
      key: 'user',
      header: 'User',
      cell: (u) => (
        <div className="flex items-center gap-3">
          <Avatar initials={u.initials} />
          <div className="min-w-0">
            <p className="t-label-s truncate">{u.name}</p>
            <p className="t-caption truncate text-text-muted">{u.email}</p>
          </div>
        </div>
      ),
    },
    { key: 'signin', header: 'Sign-in', width: 'w-28', cell: (u) => u.signin },
    { key: 'status', header: 'Status', width: 'w-32', cell: (u) => <StatusChip value={u.status} /> },
    { key: 'plan', header: 'Plan', width: 'w-24', cell: (u) => u.plan },
    { key: 'credits', header: 'Credits', width: 'w-24', align: 'right', cell: (u) => <span className="tabular-nums">{u.credits}</span> },
    { key: 'gens', header: 'Generations', width: 'w-32', align: 'right', cell: (u) => <span className="tabular-nums">{u.generations}</span> },
    { key: 'last', header: 'Last activity', width: 'w-36', cell: (u) => <span className="text-text-muted">{u.last_activity}</span> },
    { key: 'joined', header: 'Joined', width: 'w-32', cell: (u) => <span className="text-text-muted">{u.joined}</span> },
  ]

  return (
    <AdminPage crumbs={[{ label: 'Operations' }, { label: 'Users' }]} roles={['operator']}>
      <PageHeader title="Users" subtitle="Find and manage customers" />
      <FilterBar
        onReset={() => {
          setQ('')
          setStatus('')
          setSort('last_activity')
        }}
      >
        <SearchInput value={q} onChange={setQ} placeholder="Search email or name" />
        <InlineSelect aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: '', label: 'Status: All' }, { value: 'active', label: 'Active' }, { value: 'suspended', label: 'Suspended' }]} />
        <InlineSelect aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)} options={[{ value: 'last_activity', label: 'Sort: Last activity' }, { value: 'joined', label: 'Sort: Joined' }]} />
      </FilterBar>
      <DataTable
        caption="Users"
        columns={columns}
        rows={rows}
        rowKey={(u) => u.id}
        pagination={pagination}
        onRowClick={(u) => navigate(`/users/${u.id}`)}
        empty={{ title: 'No users match', body: 'Try a different search or status.' }}
      />
    </AdminPage>
  )
}

/* ───────────── User detail ───────────── */

type TabId = 'profile' | 'credits' | 'sessions' | 'audit'
type Dialog = null | 'adjust' | 'plan' | 'revoke' | 'suspend'

const typeTone = (t: string): Tone => (t === 'generation_refund' ? 'success' : t === 'generation_spend' ? 'accent' : t === 'signup_bonus' ? 'info' : t === 'admin_deduct' ? 'danger' : 'primary')

export function UserDetail() {
  const { id = '' } = useParams()
  const toast = useToast()
  const user = userRows.find((u) => u.id === id)
  const [tab, setTab] = useState<TabId>('credits')
  const [dialog, setDialog] = useState<Dialog>(null)
  const [suspended, setSuspended] = useState(user?.status === 'suspended')
  const [delta, setDelta] = useState(0)
  const [grantedExtra, setGrantedExtra] = useState(0)
  const [used] = useState(5)
  const [reserved] = useState(1)
  const [amount, setAmount] = useState('+5')
  const [plan, setPlan] = useState('free')
  const [extra, setExtra] = useState<UserLedgerRow[]>([])
  const [adjustError, setAdjustError] = useState<string>()

  const crumbs = [{ label: 'Operations' }, { label: 'Users', to: '/users' }, { label: user?.name ?? id }]
  if (!user)
    return (
      <AdminPage crumbs={crumbs} roles={['operator']}>
        <div className="rounded-md border border-border bg-surface">
          <EmptyState title="User not found" body="The account may have been removed, or the ID is wrong." action={<Link to="/users" className="t-label-s text-primary hover:underline">Back to Users</Link>} />
        </div>
      </AdminPage>
    )

  const granted = 10 + grantedExtra
  const remaining = granted - used - reserved + (delta - grantedExtra)
  const entries = [...extra, ...ayuLedger]
  const parsed = Number(amount.replace('−', '-'))
  const amountValid = amount.trim() !== '' && Number.isInteger(parsed) && parsed !== 0

  const apply = (reason: string) => {
    if (!amountValid) return setAdjustError('Enter a whole number other than 0.')
    if (parsed < 0 && Math.abs(parsed) > remaining) return setAdjustError("CREDIT_ADJUSTMENT_REJECTED: can't deduct credits already used or reserved.")
    setAdjustError(undefined)
    setDelta((d) => d + parsed)
    if (parsed > 0) setGrantedExtra((g) => g + parsed)
    setExtra((e) => [{ amount: parsed, type: parsed > 0 ? 'admin_grant' : 'admin_deduct', reason, generation: null, actor: 'adm_01', date: 'Just now' }, ...e])
    setDialog(null)
    toast({ tone: 'success', title: 'Credits updated', body: `New balance: ${remaining + parsed} remaining.` })
  }

  const ledgerColumns: Column<UserLedgerRow>[] = [
    { key: 'amount', header: 'Amount', width: 'w-24', align: 'right', cell: (l) => <span className={`font-semibold tabular-nums ${l.amount > 0 ? 'text-success' : 'text-danger'}`}>{l.amount > 0 ? `+${l.amount}` : `−${Math.abs(l.amount)}`}</span> },
    { key: 'type', header: 'Type', width: 'w-44', cell: (l) => <Chip tone={typeTone(l.type)}>{l.type}</Chip> },
    { key: 'reason', header: 'Reason', cell: (l) => l.reason },
    { key: 'gen', header: 'Generation', width: 'w-36', cell: (l) => (l.generation ? <Link to={`/generations/${l.generation}`} className="t-mono text-primary hover:underline">{l.generation}</Link> : <span className="text-text-muted">—</span>) },
    { key: 'actor', header: 'Actor', width: 'w-24', cell: (l) => <code className="t-mono">{l.actor}</code> },
    { key: 'date', header: 'Date', width: 'w-36', cell: (l) => <span className="text-text-muted">{l.date}</span> },
  ]

  const userAudit = audit.filter((a) => a.target_type === 'user').slice(0, 6)

  return (
    <AdminPage crumbs={crumbs} roles={['operator']}>
      <PageHeader
        title={user.name}
        subtitle={`${user.email} · ${user.id}`}
        actions={
          <>
            <Button variant="secondary" onClick={() => { setAmount('+5'); setAdjustError(undefined); setDialog('adjust') }}>Adjust credits</Button>
            <Button variant="secondary" onClick={() => setDialog('plan')}>Assign plan</Button>
            <Button variant="secondary" onClick={() => setDialog('revoke')}>Revoke sessions</Button>
            <Button variant="destructive" onClick={() => setDialog('suspend')}>{suspended ? 'Reinstate' : 'Suspend'}</Button>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip value={suspended ? 'suspended' : 'active'} />
        <Chip tone="neutral">{plan === 'free' ? 'Free plan' : `${plan[0].toUpperCase()}${plan.slice(1)} plan`}</Chip>
        <Chip tone="info">{user.signin}</Chip>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'profile', label: 'Profile & identities' },
          { id: 'credits', label: 'Credits' },
          { id: 'sessions', label: 'Sessions' },
          { id: 'audit', label: 'Audit' },
        ]}
      />

      {tab === 'profile' && (
        <KeyValueList
          items={[
            ['Display name', user.name],
            ['Email', user.email],
            ['Account ID', <code className="t-mono">{user.id}</code>],
            ['Identity', `${user.signin} · verified`],
            ['Joined', user.joined],
            ['Last activity', user.last_activity],
          ]}
        />
      )}

      {tab === 'credits' && (
        <>
          <div className="flex gap-4">
            <StatTile label="Total granted" value={granted} />
            <StatTile label="Used" value={used} />
            <StatTile label="Reserved" value={reserved} hint="1 job in progress" hintTone="info" />
            <StatTile label="Remaining" value={remaining} hint="Available now" hintTone="success" />
          </div>
          <DataTable caption="Credit ledger" columns={ledgerColumns} rows={entries} rowKey={(l) => `${l.date}-${l.type}-${l.amount}-${l.reason}`} pagination={{ page: 1, pages: 1, total: entries.length, pageSize: 50, onPage: () => {} }} />
        </>
      )}

      {tab === 'sessions' && (
        <DataTable
          caption="Sessions"
          columns={[
            { key: 'device', header: 'Device', cell: (s) => s.device },
            { key: 'started', header: 'Started', width: 'w-36', cell: (s) => s.started },
            { key: 'seen', header: 'Last seen', width: 'w-36', cell: (s) => <span className="text-text-muted">{s.last_seen}</span> },
            { key: 'exp', header: 'Expires', width: 'w-36', cell: (s) => <span className="text-text-muted">{s.expires}</span> },
          ] as Column<(typeof userSessions)[number]>[]}
          rows={userSessions}
          rowKey={(s) => s.id}
        />
      )}

      {tab === 'audit' &&
        (userAudit.length ? (
          <DataTable
            caption="Audit"
            columns={[
              { key: 'action', header: 'Action', width: 'w-56', cell: (a) => <code className="t-mono">{a.action}</code> },
              { key: 'reason', header: 'Reason', cell: (a) => a.reason ?? '—' },
              { key: 'actor', header: 'Actor', width: 'w-24', cell: (a) => <code className="t-mono">{a.admin_actor_id}</code> },
              { key: 'date', header: 'Date', width: 'w-40', cell: (a) => <span className="text-text-muted">{a.created_at}</span> },
            ] as Column<(typeof userAudit)[number]>[]}
            rows={userAudit}
            rowKey={(a) => a.id}
          />
        ) : (
          <div className="rounded-md border border-border bg-surface"><EmptyState title="No audit entries" body="Admin actions on this account appear here." /></div>
        ))}

      {dialog === 'adjust' && (
        <ConfirmDialog
          title="Adjust credits"
          description={`${user.name} · ${remaining} remaining, ${reserved} reserved`}
          confirmLabel="Apply adjustment"
          confirmText="I confirm this credit adjustment"
          requireReason
          error={adjustError}
          disabled={!amountValid}
          onClose={() => setDialog(null)}
          onConfirm={apply}
        >
          <TextField label="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" error={amount && !amountValid ? 'Enter a whole number other than 0.' : undefined} helper="Use a negative number to deduct. Can't deduct credits already used or reserved." />
        </ConfirmDialog>
      )}
      {dialog === 'plan' && (
        <ConfirmDialog
          title="Assign plan"
          description={`Change the plan for ${user.name}. Billing is not enabled, so no charge is made.`}
          confirmLabel="Assign plan"
          requireReason
          onClose={() => setDialog(null)}
          onConfirm={() => {
            setDialog(null)
            toast({ tone: 'success', title: 'Plan assigned', body: `${user.name} is now on the ${plan} plan.` })
          }}
        >
          <SelectField label="Plan" value={plan} onChange={(e) => setPlan(e.target.value)} options={plans.map((p) => ({ value: p.code, label: p.name }))} />
        </ConfirmDialog>
      )}
      {dialog === 'revoke' && (
        <ConfirmDialog
          title="Revoke all sessions?"
          description={`${user.name} is signed out on every device and must sign in again.`}
          confirmLabel="Revoke sessions"
          requireReason
          destructive
          onClose={() => setDialog(null)}
          onConfirm={() => {
            setDialog(null)
            toast({ tone: 'success', title: 'Sessions revoked' })
          }}
        />
      )}
      {dialog === 'suspend' && (
        <ConfirmDialog
          title={suspended ? 'Reinstate this account?' : 'Suspend this account?'}
          description={suspended ? `${user.name} can sign in and create again.` : `${user.name} is signed out and can't create until reinstated. Credits are kept.`}
          confirmLabel={suspended ? 'Reinstate account' : 'Suspend account'}
          requireReason
          destructive={!suspended}
          onClose={() => setDialog(null)}
          onConfirm={() => {
            setSuspended(!suspended)
            setDialog(null)
            toast({ tone: 'success', title: suspended ? 'Account reinstated' : 'Account suspended' })
          }}
        />
      )}
    </AdminPage>
  )
}
