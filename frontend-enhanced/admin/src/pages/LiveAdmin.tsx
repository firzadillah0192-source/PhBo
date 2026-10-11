import { useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { ChevronRight, Download, Eye, RefreshCw, Trash2 } from 'lucide-react'
import { AdminPage, Logo } from '../components/AdminShell'
import { type Column, DataTable } from '../components/DataTable'
import { ConfirmDialog, FilterBar, SearchInput, useToast } from '../components/overlays'
import { SimpleBarChart, Timeline, type TimelineEvent } from '../components/panels'
import { Button, Card, Chip, CodeValue, EmptyState, InlineAlert, InlineSelect, KeyValueList, ModeChip, PageHeader, SelectField, StatTile, StatusChip, Tabs, TextField, Thumb } from '../components/ui'
import { customer as api, rows, type Row } from '../../../shared/api'
import { useResource } from '../../../shared/useResource'
import { homeFor, useRole } from '../lib/role'
import { num, seconds } from '../lib/format'
import { Dash, Gate, Section, lower, pager, signed, typeTone, useAction, when } from './liveParts'

const opt = (all: string, values: string[]) => [{ value: '', label: all }, ...values.map(v => ({ value: v, label: v }))]
const mode = (m: unknown) => (lower(m) || 'classic') as 'classic' | 'basic' | 'advanced'
const Avatar = ({ text }: { text: string }) => <span aria-hidden className="t-label-xs flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">{text.slice(0, 2).toUpperCase()}</span>
const NotFound = ({ crumbs, what, to, label }: { crumbs: any[]; what: string; to: string; label: string }) => <AdminPage crumbs={crumbs} roles={['operator']}><div className="rounded-md border border-border bg-surface"><EmptyState title={`${what} not found`} body="It may have been removed, or the ID is wrong." action={<Link to={to} className="t-label-s text-primary hover:underline">{label}</Link>} /></div></AdminPage>

/* ───────────── Login ───────────── */

export function Login() {
  const session = useRole(); const navigate = useNavigate(); const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false); const action = useAction()
  if (session.authenticated) return <Navigate to={homeFor(session.role)} replace />
  const signIn = async (call: () => Promise<any>) => { setBusy(true); if (await action.run(async () => { await call(); await session.refresh(); navigate('/') })) return; setBusy(false) }
  return <div className="flex min-h-screen items-center justify-center bg-bg p-6"><form noValidate className="flex w-full max-w-[420px] flex-col gap-6 rounded-lg border border-border bg-surface p-8 shadow-e2" onSubmit={e => { e.preventDefault(); if (!email.trim() || !password) { action.setError('Enter your email and password.'); return } signIn(() => api.loginAdmin(email, password)) }}>
    <div className="flex items-center gap-2"><Logo /><Chip>Admin</Chip></div>
    <div><h1 className="t-h2">Admin console</h1><p className="t-body-s mt-1 text-text-muted">Sign in with your authorised account.</p></div>
    <TextField label="Email" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} />
    <TextField label="Password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} error={action.error || undefined} helper="Your session uses the role assigned to your account." />
    <Button type="submit" loading={busy} className="!h-12 !rounded-md !text-base">Sign in</Button>
    <Button variant="secondary" disabled={busy} onClick={() => signIn(() => api.loginAdmin())}>Continue with authorised Google session</Button>
  </form></div>
}

/* ───────────── Overview ───────────── */

export function Overview() {
  const toast = useToast(); const r = useResource(() => api.getAdminOverview()); const o = r.data
  const jump = (to: string, label: string) => <Link to={to} className="text-primary hover:underline">{label}</Link>
  return <AdminPage crumbs={[{ label: 'Operations' }, { label: 'Overview' }]} roles={['operator']}>
    <PageHeader title="Overview" subtitle="Business and pipeline health" actions={<Button variant="secondary" icon={RefreshCw} loading={r.loading} onClick={() => { r.refresh(); toast({ tone: 'success', title: 'Overview refreshed' }) }}>Refresh</Button>} />
    <Gate resource={r} />
    {o && <>
      <Section title="Users"><div className="flex gap-4"><StatTile label="Total users" value={num(o.total_users)} /><StatTile label="New today" value={num(o.new_users_today)} /><StatTile label="Active (30 days)" value={num(o.active_users)} /></div></Section>
      <Section title="Generations"><div className="flex gap-4">
        <StatTile label="Completed" value={num(o.successful_generations)} />
        <StatTile label="Failed" value={num(o.failed_generations)} hint={jump('/generations?state=FAILED', 'View failed →')} />
        <StatTile label="Queued" value={num(o.queued_jobs)} hint={jump('/generations?state=QUEUED', 'View queue →')} />
        <StatTile label="Processing" value={num(o.processing_jobs)} />
        <StatTile label="Advanced today" value={num(o.advanced_generations_today)} />
      </div></Section>
      <Section title="Credits & business"><div className="flex gap-4"><StatTile label="AI credits consumed" value={num(o.ai_credits_consumed)} /><StatTile label="Active subscriptions" value={num(o.active_subscriptions)} hint="Billing not enabled" /></div></Section>
      <Section title="Catalog"><div className="flex gap-4">
        <StatTile label="Published" value={num(o.published_experiences)} /><StatTile label="Draft" value={num(o.draft_experiences)} /><StatTile label="Disabled" value={num(o.disabled_experiences)} />
        <StatTile label="Missing previews" value={num(o.missing_experience_previews)} hintTone="warning" hint={jump('/experiences', 'Generate previews →')} />
      </div></Section>
    </>}
  </AdminPage>
}

/* ───────────── Generations ───────────── */

export function Generations() {
  const navigate = useNavigate()
  const [state, setState] = useState(() => new URLSearchParams(window.location.search).get('state') ?? ''); const [md, setMode] = useState(''); const [user, setUser] = useState(''); const [page, setPage] = useState(1)
  const r = useResource(() => api.getAdminGenerations({ page, state, mode: md, user_id: user }), [page, state, md, user])
  const columns: Column<Row>[] = [
    { key: 'id', header: 'ID', width: 'w-36', cell: g => <code className="t-mono text-primary">{String(g.job_id).slice(0, 12)}</code> },
    { key: 'user', header: 'User', cell: g => g.user_email || <span className="text-text-muted">Guest</span> },
    { key: 'mode', header: 'Mode', width: 'w-28', cell: g => <ModeChip mode={mode(g.mode)} /> },
    { key: 'state', header: 'State', width: 'w-36', cell: g => <StatusChip value={lower(g.state)} /> },
    { key: 'credit', header: 'Credit', width: 'w-40', cell: g => <StatusChip value={lower(g.credit_state) || 'not_applicable'} /> },
    { key: 'created', header: 'Created', width: 'w-40', cell: g => <span className="text-text-muted">{when(g.created_at)}</span> },
    { key: 'duration', header: 'Duration', width: 'w-24', align: 'right', cell: g => g.duration_seconds == null ? <Dash /> : `${Math.round(g.duration_seconds)} s` },
  ]
  return <AdminPage crumbs={[{ label: 'Operations' }, { label: 'Generations' }]} roles={['operator']}>
    <PageHeader title="Generations" subtitle="Monitor and inspect jobs" />
    <FilterBar onReset={() => { setState(''); setMode(''); setUser(''); setPage(1) }}>
      <InlineSelect aria-label="State" value={state} onChange={e => { setState(e.target.value); setPage(1) }} options={[{ value: '', label: 'State: All' }, ...['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED'].map(v => ({ value: v, label: v[0] + v.slice(1).toLowerCase() }))]} />
      <InlineSelect aria-label="Mode" value={md} onChange={e => { setMode(e.target.value); setPage(1) }} options={[{ value: '', label: 'Mode: All' }, ...['CLASSIC', 'BASIC', 'ADVANCED'].map(v => ({ value: v, label: v[0] + v.slice(1).toLowerCase() }))]} />
      <SearchInput value={user} onChange={v => { setUser(v); setPage(1) }} placeholder="User ID" className="w-48" />
    </FilterBar>
    <Gate resource={r} />
    <DataTable caption="Generations" columns={columns} rows={r.data?.jobs ?? []} rowKey={g => g.job_id} loading={r.loading && !r.data} pagination={pager(r.data, page, setPage)} onRowClick={g => navigate('/generations/' + g.job_id)} empty={{ title: 'No generations match', body: 'Try a different state, mode or user.' }} />
  </AdminPage>
}

const tone = (type: string): TimelineEvent['tone'] => (/fail|error|revok/i.test(type) ? 'danger' : /complet|stored|success/i.test(type) ? 'success' : /process|start/i.test(type) ? 'info' : /credit|reserve|refund/i.test(type) ? 'accent' : 'primary')

export function GenerationDetail() {
  const { id = '' } = useParams(); const toast = useToast(); const r = useResource(() => api.getAdminGeneration(id), [id], 5000); const [revoking, setRevoking] = useState<Row | null>(null); const action = useAction(r.refresh)
  const crumbs = [{ label: 'Operations' }, { label: 'Generations', to: '/generations' }, { label: id }]
  if (r.error && !r.data) return <NotFound crumbs={crumbs} what="Generation" to="/generations" label="Back to Generations" />
  const d = r.data; const job = d?.job
  const events: TimelineEvent[] = (d?.events ?? []).map((e: Row) => ({ type: e.type, detail: e.detail || '', at: when(e.created_at), tone: tone(e.type) }))
  const linkColumns: Column<Row>[] = [
    { key: 'created', header: 'Created', cell: l => when(l.created_at) },
    { key: 'expires', header: 'Expires', cell: l => when(l.expires_at) },
    { key: 'dl', header: 'Downloads', width: 'w-28', align: 'right', cell: l => l.download_count ?? 0 },
    { key: 'status', header: 'Status', width: 'w-32', cell: l => <StatusChip value={l.is_revoked ? 'revoked' : l.expired ? 'expired' : 'active'} /> },
    { key: 'act', header: '', width: 'w-28', align: 'right', cell: l => !l.is_revoked && !l.expired ? <Button variant="tertiary" size="sm" onClick={() => setRevoking(l)}>Revoke</Button> : <Dash /> },
  ]
  return <AdminPage crumbs={crumbs} roles={['operator']}>
    <PageHeader title={`Generation ${String(id).slice(0, 12)}`} subtitle={job ? `Created ${when(job.created_at)}` : undefined} actions={<Button variant="secondary" icon={RefreshCw} onClick={r.refresh}>Refresh</Button>} />
    <Gate resource={r} />
    {job && <div className="flex items-start gap-6">
      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <Card title="Summary"><KeyValueList items={[['Job ID', <CodeValue value={job.job_id} />], ['User', job.user_email || (job.guest_id ? `Guest · ${job.guest_id}` : 'Guest')], ['Mode', <ModeChip mode={mode(job.mode)} />], ['Experience', <code className="t-mono">{job.experience_id || job.template_id || '—'}</code>], ['State', <StatusChip value={lower(job.state)} />], ['Credit', <StatusChip value={lower(job.credit_state) || 'not_applicable'} />], ['Duration', job.duration_seconds == null ? '—' : `${Math.round(job.duration_seconds)} s`]]} /></Card>
        {d.error_code && <InlineAlert tone="danger" title={d.error_code}>{d.error_message || 'The job failed.'}</InlineAlert>}
        <Card title="Events">{events.length ? <Timeline events={events} /> : <p className="t-body-s text-text-muted">No events recorded.</p>}</Card>
        <section className="flex flex-col gap-3"><h2 className="t-h4">Share links</h2>
          {d.claims?.length ? <DataTable caption="Share links" columns={linkColumns} rows={d.claims} rowKey={(l: Row) => l.claim_id} /> : <div className="rounded-md border border-border bg-surface"><EmptyState title="No share links" body="Links appear here once the user shares a result." /></div>}
        </section>
      </div>
      <div className="flex w-80 shrink-0 flex-col gap-6"><Card title="Result photo"><div className="flex flex-col gap-3"><p className="t-body-s text-text-muted">The result image, download and deletion are on the usage page.</p><Link to={'/usage/generations/' + id} className="t-label-s text-primary hover:underline">Open usage forensics</Link></div></Card></div>
    </div>}
    {revoking && <ConfirmDialog title="Revoke this share link?" description="Anyone with the link will see the photo as unavailable. This can't be undone." confirmLabel="Revoke link" requireReason destructive error={action.error} onClose={() => setRevoking(null)} onConfirm={async reason => { if (await action.run(() => api.revokeAdminResultClaim(revoking.claim_id, { confirm: true, reason }))) { setRevoking(null); toast({ tone: 'success', title: 'Share link revoked' }) } }} />}
  </AdminPage>
}

/* ───────────── Users ───────────── */

export function Users() {
  const navigate = useNavigate(); const [page, setPage] = useState(1); const [q, setQ] = useState(''); const [status, setStatus] = useState('')
  const r = useResource(() => api.getAdminUsers({ page, q, status }), [page, q, status])
  const columns: Column<Row>[] = [
    { key: 'user', header: 'User', cell: u => <div className="flex items-center gap-3"><Avatar text={u.name || u.email || '?'} /><div className="min-w-0"><p className="t-label-s truncate">{u.name || u.email}</p><p className="t-caption truncate text-text-muted">{u.email}</p></div></div> },
    { key: 'signin', header: 'Sign-in', width: 'w-28', cell: u => u.auth_provider || '—' },
    { key: 'status', header: 'Status', width: 'w-32', cell: u => <StatusChip value={lower(u.status)} /> },
    { key: 'plan', header: 'Plan', width: 'w-24', cell: u => u.subscription_plan || 'free' },
    { key: 'credits', header: 'Credits', width: 'w-24', align: 'right', cell: u => <span className="tabular-nums">{u.ai_remaining}</span> },
    { key: 'gens', header: 'Generations', width: 'w-32', align: 'right', cell: u => <span className="tabular-nums">{u.total_generations ?? '—'}</span> },
    { key: 'last', header: 'Last activity', width: 'w-40', cell: u => <span className="text-text-muted">{when(u.last_activity_at)}</span> },
    { key: 'joined', header: 'Joined', width: 'w-40', cell: u => <span className="text-text-muted">{when(u.created_at)}</span> },
  ]
  return <AdminPage crumbs={[{ label: 'Operations' }, { label: 'Users' }]} roles={['operator']}>
    <PageHeader title="Users" subtitle="Find and manage customers" />
    <FilterBar onReset={() => { setQ(''); setStatus(''); setPage(1) }}>
      <SearchInput value={q} onChange={v => { setQ(v); setPage(1) }} placeholder="Search email or name" />
      <InlineSelect aria-label="Status" value={status} onChange={e => { setStatus(e.target.value); setPage(1) }} options={[{ value: '', label: 'Status: All' }, { value: 'active', label: 'Active' }, { value: 'suspended', label: 'Suspended' }]} />
    </FilterBar>
    <Gate resource={r} />
    <DataTable caption="Users" columns={columns} rows={r.data?.users ?? []} rowKey={u => u.id} loading={r.loading && !r.data} pagination={pager(r.data, page, setPage)} onRowClick={u => navigate('/users/' + u.id)} empty={{ title: 'No users match', body: 'Try a different search or status.' }} />
  </AdminPage>
}

type Dialog = null | 'adjust' | 'plan' | 'revoke' | 'suspend'
export function UserDetail() {
  const { id = '' } = useParams(); const navigate = useNavigate(); const toast = useToast(); const [tab, setTab] = useState<'profile' | 'credits' | 'sessions' | 'generations' | 'audit'>('credits'); const [dialog, setDialog] = useState<Dialog>(null); const [amount, setAmount] = useState('+5'); const [plan, setPlan] = useState('')
  const adjustment = useRef<{ payload: string; key: string } | null>(null)
  const r = useResource(async () => { const [profile, credits, sessions, jobs, audit, plans] = await Promise.all([api.getAdminUser(id), api.getAdminUserCredits(id), api.getAdminUserSessions(id), api.getAdminUserGenerations(id), api.getAdminUserAudit(id), api.getAdminPlans()]); return { ...profile, credits, sessions, jobs, audit, plans } }, [id])
  const action = useAction(r.refresh)
  const crumbs = [{ label: 'Operations' }, { label: 'Users', to: '/users' }, { label: r.data?.user?.name || id }]
  if (r.error && !r.data) return <NotFound crumbs={crumbs} what="User" to="/users" label="Back to Users" />
  const u = r.data?.user; const suspended = u?.status === 'suspended'; const balance = r.data?.credits?.balance
  const parsed = Number(amount.replace('−', '-')); const amountValid = amount.trim() !== '' && Number.isInteger(parsed) && parsed !== 0
  async function adjust(reason: string) {
    // Reuse the idempotency key after a lost response so a retry cannot grant credits twice.
    const payload = JSON.stringify({ id, parsed, reason }); if (adjustment.current?.payload !== payload) adjustment.current = { payload, key: crypto.randomUUID() }
    if (await action.run(() => api.adjustAdminUserCredits(id, { amount: parsed, reason, confirm: true, idempotency_key: adjustment.current!.key }))) { adjustment.current = null; setDialog(null); toast({ tone: 'success', title: 'Credits updated' }) }
  }
  const done = (title: string) => () => { setDialog(null); toast({ tone: 'success', title }) }
  const ledgerColumns: Column<Row>[] = [
    { key: 'amount', header: 'Amount', width: 'w-24', align: 'right', cell: l => <span className={`font-semibold tabular-nums ${l.amount > 0 ? 'text-success' : 'text-danger'}`}>{signed(l.amount)}</span> },
    { key: 'type', header: 'Type', width: 'w-44', cell: l => <Chip tone={typeTone(l.type)}>{l.type}</Chip> },
    { key: 'reason', header: 'Reason', cell: l => l.reason || <Dash /> },
    { key: 'gen', header: 'Generation', width: 'w-36', cell: l => l.related_generation_id ? <Link to={'/generations/' + l.related_generation_id} className="t-mono text-primary hover:underline">{String(l.related_generation_id).slice(0, 10)}</Link> : <Dash /> },
    { key: 'actor', header: 'Actor', width: 'w-24', cell: l => l.admin_actor_id ? <code className="t-mono">{l.admin_actor_id}</code> : <span className="text-text-muted">system</span> },
    { key: 'date', header: 'Date', width: 'w-40', cell: l => <span className="text-text-muted">{when(l.created_at)}</span> },
  ]
  return <AdminPage crumbs={crumbs} roles={['operator']}>
    <PageHeader title={u?.name || u?.email || 'User'} subtitle={u ? `${u.email} · ${u.id}` : undefined} actions={u && <>
      <Button variant="secondary" onClick={() => { setAmount('+5'); action.setError(''); setDialog('adjust') }}>Adjust credits</Button>
      <Button variant="secondary" onClick={() => { action.setError(''); setDialog('plan') }}>Assign plan</Button>
      <Button variant="secondary" onClick={() => { action.setError(''); setDialog('revoke') }}>Revoke sessions</Button>
      <Button variant="destructive" onClick={() => { action.setError(''); setDialog('suspend') }}>{suspended ? 'Reinstate' : 'Suspend'}</Button></>} />
    <Gate resource={r} />
    {u && <>
      <div className="flex flex-wrap items-center gap-2"><StatusChip value={lower(u.status)} /><Chip>{u.subscription_plan ? `${u.subscription_plan} plan` : 'Free plan'}</Chip><Chip tone="info">{u.auth_provider}</Chip></div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'profile', label: 'Profile & identities' }, { id: 'credits', label: 'Credits' }, { id: 'sessions', label: 'Sessions' }, { id: 'generations', label: 'Generations' }, { id: 'audit', label: 'Audit' }]} />
      {tab === 'profile' && <KeyValueList items={[['Display name', u.name || '—'], ['Email', u.email], ['Account ID', <code className="t-mono">{u.id}</code>], ['Identity', u.auth_provider], ['Subscription', r.data.subscription?.plan_name || r.data.subscription?.plan_id || 'None'], ['Joined', when(u.created_at)], ['Last activity', when(u.last_activity_at)]]} />}
      {tab === 'credits' && <>
        {balance && <div className="flex gap-4"><StatTile label="Total granted" value={num(balance.total ?? u.ai_total)} /><StatTile label="Used" value={num(balance.used ?? u.ai_used)} /><StatTile label="Reserved" value={num(balance.reserved)} /><StatTile label="Remaining" value={num(balance.remaining ?? u.ai_remaining)} hintTone="success" hint="Available now" /></div>}
        <DataTable caption="Credit ledger" columns={ledgerColumns} rows={r.data.credits.entries} rowKey={(l: Row) => l.id} empty={{ title: 'No credit movements' }} />
      </>}
      {tab === 'sessions' && <DataTable caption="Sessions" columns={[{ key: 'id', header: 'Session', cell: (s: Row) => <code className="t-mono">{s.id}</code> }, { key: 'started', header: 'Started', width: 'w-44', cell: (s: Row) => when(s.created_at) }, { key: 'seen', header: 'Last seen', width: 'w-44', cell: (s: Row) => <span className="text-text-muted">{when(s.last_seen_at)}</span> }, { key: 'exp', header: 'Expires', width: 'w-44', cell: (s: Row) => <span className="text-text-muted">{when(s.expires_at)}</span> }, { key: 'active', header: 'Status', width: 'w-28', cell: (s: Row) => <StatusChip value={s.active ? 'active' : 'expired'} /> }] as Column<Row>[]} rows={r.data.sessions} rowKey={(s: Row) => s.id} empty={{ title: 'No sessions' }} />}
      {tab === 'generations' && <DataTable caption="Generations" columns={[{ key: 'id', header: 'ID', width: 'w-36', cell: (g: Row) => <code className="t-mono text-primary">{String(g.job_id).slice(0, 12)}</code> }, { key: 'mode', header: 'Mode', width: 'w-28', cell: (g: Row) => <ModeChip mode={mode(g.mode)} /> }, { key: 'state', header: 'State', width: 'w-36', cell: (g: Row) => <StatusChip value={lower(g.state)} /> }, { key: 'credit', header: 'Credit', cell: (g: Row) => <StatusChip value={lower(g.credit_state) || 'not_applicable'} /> }, { key: 'created', header: 'Created', width: 'w-44', cell: (g: Row) => <span className="text-text-muted">{when(g.created_at)}</span> }] as Column<Row>[]} rows={rows(r.data.jobs, 'jobs')} rowKey={(g: Row) => g.job_id} onRowClick={(g: Row) => navigate('/generations/' + g.job_id)} empty={{ title: 'No generations' }} />}
      {tab === 'audit' && <DataTable caption="Audit" columns={[{ key: 'action', header: 'Action', width: 'w-56', cell: (a: Row) => <code className="t-mono">{a.action}</code> }, { key: 'reason', header: 'Reason', cell: (a: Row) => a.reason || <Dash /> }, { key: 'actor', header: 'Actor', width: 'w-28', cell: (a: Row) => <code className="t-mono">{a.admin_actor_id}</code> }, { key: 'date', header: 'Date', width: 'w-44', cell: (a: Row) => <span className="text-text-muted">{when(a.created_at)}</span> }] as Column<Row>[]} rows={rows(r.data.audit)} rowKey={(a: Row) => a.id} empty={{ title: 'No audit entries', body: 'Admin actions on this account appear here.' }} />}
    </>}
    {dialog === 'adjust' && u && <ConfirmDialog title="Adjust credits" description={`${u.name || u.email} · ${balance?.remaining ?? u.ai_remaining} remaining`} confirmLabel="Apply adjustment" confirmText="I confirm this credit adjustment" requireReason error={action.error} disabled={!amountValid} onClose={() => setDialog(null)} onConfirm={adjust}><TextField label="Amount" value={amount} onChange={e => setAmount(e.target.value)} inputMode="numeric" error={amount && !amountValid ? 'Enter a whole number other than 0.' : undefined} helper="Use a negative number to deduct. Can't deduct credits already used or reserved." /></ConfirmDialog>}
    {dialog === 'plan' && u && <ConfirmDialog title="Assign plan" description={`Change the plan for ${u.name || u.email}. Billing is not enabled, so no charge is made.`} confirmLabel="Assign plan" requireReason disabled={!plan} error={action.error} onClose={() => setDialog(null)} onConfirm={async reason => { if (await action.run(() => api.changeAdminUserSubscription(id, { action: 'assign', plan_id: plan, reason, confirm: true }))) done('Plan assigned')() }}><SelectField label="Plan" value={plan} onChange={e => setPlan(e.target.value)} options={[{ value: '', label: 'Choose plan' }, ...rows(r.data.plans, 'plans').map((p: Row) => ({ value: p.id, label: p.name }))]} /></ConfirmDialog>}
    {dialog === 'revoke' && u && <ConfirmDialog title="Revoke all sessions?" description={`${u.name || u.email} is signed out on every device and must sign in again.`} confirmLabel="Revoke sessions" requireReason destructive error={action.error} onClose={() => setDialog(null)} onConfirm={async reason => { if (await action.run(() => api.revokeAdminUserSessions(id, { status: u.status, reason, confirm: true }))) done('Sessions revoked')() }} />}
    {dialog === 'suspend' && u && <ConfirmDialog title={suspended ? 'Reinstate this account?' : 'Suspend this account?'} description={suspended ? `${u.name || u.email} can sign in and create again.` : `${u.name || u.email} is signed out and can't create until reinstated. Credits are kept.`} confirmLabel={suspended ? 'Reinstate account' : 'Suspend account'} requireReason destructive={!suspended} error={action.error} onClose={() => setDialog(null)} onConfirm={async reason => { if (await action.run(() => api.changeAdminUserStatus(id, { status: suspended ? 'active' : 'suspended', reason, confirm: true }))) done(suspended ? 'Account reinstated' : 'Account suspended')() }} />}
  </AdminPage>
}

/* ───────────── Credits, audit, subscriptions, settings ───────────── */

export function CreditsLedger() {
  const navigate = useNavigate(); const [page, setPage] = useState(1); const [type, setType] = useState('')
  const r = useResource(() => api.getAdminLedger({ page, entry_type: type }), [page, type])
  const columns: Column<Row>[] = [
    { key: 'amount', header: 'Amount', width: 'w-24', align: 'right', cell: l => <span className={`font-semibold ${l.amount > 0 ? 'text-success' : 'text-danger'}`}>{signed(l.amount)}</span> },
    { key: 'type', header: 'Type', width: 'w-44', cell: l => <Chip tone={typeTone(l.type)}>{l.type}</Chip> },
    { key: 'reason', header: 'Reason', cell: l => l.reason || <Dash /> },
    { key: 'user', header: 'User', width: 'w-56', cell: l => <code className="t-mono">{String(l.user_id).slice(0, 14)}</code> },
    { key: 'gen', header: 'Generation', width: 'w-36', cell: l => l.related_generation_id ? <code className="t-mono text-primary">{String(l.related_generation_id).slice(0, 10)}</code> : <Dash /> },
    { key: 'actor', header: 'Actor', width: 'w-24', cell: l => l.admin_actor_id ? <code className="t-mono">{l.admin_actor_id}</code> : <span className="text-text-muted">system</span> },
    { key: 'date', header: 'Date', width: 'w-40', cell: l => <span className="text-text-muted">{when(l.created_at)}</span> },
  ]
  return <AdminPage crumbs={[{ label: 'Operations' }, { label: 'Credits ledger' }]} roles={['operator']}>
    <PageHeader title="Credits ledger" subtitle="Every credit movement across all users" />
    <FilterBar onReset={() => { setType(''); setPage(1) }}><InlineSelect aria-label="Entry type" value={type} onChange={e => { setType(e.target.value); setPage(1) }} options={opt('Type: All', ['signup_bonus', 'admin_grant', 'admin_adjustment', 'generation_spend', 'generation_refund', 'top_up'])} /></FilterBar>
    <Gate resource={r} />
    <DataTable caption="Credits ledger" columns={columns} rows={r.data?.entries ?? []} rowKey={l => l.id} loading={r.loading && !r.data} pagination={pager(r.data, page, setPage)} onRowClick={l => l.related_generation_id && navigate('/usage/generations/' + l.related_generation_id)} />
  </AdminPage>
}
export function AuditLog() {
  const [action, setAction] = useState(''); const [limit, setLimit] = useState('100'); const [open, setOpen] = useState<string | null>(null)
  const r = useResource(() => api.getAdminAudit({ action, limit }), [action, limit])
  const columns: Column<Row>[] = [
    { key: 'caret', header: '', width: 'w-10', cell: a => <ChevronRight size={16} className={open === a.id ? 'rotate-90' : ''} aria-hidden /> },
    { key: 'when', header: 'When', width: 'w-44', cell: a => <span className="text-text-muted">{when(a.created_at)}</span> },
    { key: 'actor', header: 'Actor', width: 'w-28', cell: a => <code className="t-mono">{a.admin_actor_id || a.actor_id}</code> },
    { key: 'action', header: 'Action', width: 'w-60', cell: a => <code className="t-mono">{a.action}</code> },
    { key: 'target', header: 'Target', width: 'w-60', cell: a => <span><span className="text-text-muted">{a.target_type} · </span><code className="t-mono">{String(a.target_id).slice(0, 14)}</code></span> },
    { key: 'reason', header: 'Reason', cell: a => a.reason || <Dash /> },
  ]
  return <AdminPage crumbs={[{ label: 'System' }, { label: 'Audit log' }]} roles={['operator']}>
    <PageHeader title="Audit log" subtitle="Who changed what. Entries are written automatically and can’t be edited." />
    <FilterBar onReset={() => { setAction(''); setLimit('100') }}>
      <InlineSelect aria-label="Action" value={action} onChange={e => setAction(e.target.value)} options={opt('Action: All', ['credit_granted', 'credit_deducted', 'user_suspended', 'user_unsuspended', 'user_sessions_revoked', 'result_claim_revoked', 'result_photo_deleted'])} />
      <InlineSelect aria-label="Limit" value={limit} onChange={e => setLimit(e.target.value)} options={[{ value: '50', label: 'Latest 50' }, { value: '100', label: 'Latest 100' }, { value: '500', label: 'Latest 500 (max)' }]} />
    </FilterBar>
    <Gate resource={r} />
    <DataTable caption="Audit log" columns={columns} rows={rows(r.data)} rowKey={a => a.id} loading={r.loading && !r.data} onRowClick={a => setOpen(open === a.id ? null : a.id)} expanded={a => open === a.id ? <div><p className="t-label-xs mb-1.5 text-text-muted">METADATA</p><pre className="overflow-x-auto rounded-sm bg-surface-2 p-3 font-mono text-xs leading-5">{JSON.stringify(a.metadata ?? {}, null, 2)}</pre></div> : null} empty={{ title: 'No audit entries' }} />
  </AdminPage>
}
export function Settings() {
  const r = useResource(() => api.getAdminSettings()); const s = r.data
  return <AdminPage crumbs={[{ label: 'System' }, { label: 'Settings' }]} roles={['operator']}>
    <PageHeader title="Settings" subtitle="Read-only. Change these in the server configuration." />
    <Gate resource={r} />
    {s && <Card className="max-w-2xl"><KeyValueList items={Object.entries(s).filter(([, v]) => typeof v !== 'object' || v === null).map(([k, v]) => [k.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()), typeof v === 'boolean' ? <StatusChip value={v ? 'ready' : 'missing'} label={v ? 'Yes' : 'No'} /> : <code className="t-mono">{String(v ?? '—')}</code>] as [string, React.ReactNode])} /></Card>}
  </AdminPage>
}
export function Subscriptions() {
  const [q, setQ] = useState(''); const [status, setStatus] = useState(''); const r = useResource(() => api.getAdminSubscriptions()); const navigate = useNavigate()
  const list = rows(r.data).filter(s => (!q || lower(s.user_email).includes(q.toLowerCase())) && (!status || lower(s.status) === status))
  const columns: Column<Row>[] = [
    { key: 'user', header: 'User', cell: s => s.user_email }, { key: 'plan', header: 'Plan', width: 'w-32', cell: s => s.plan_name || s.plan_id || '—' },
    { key: 'status', header: 'Status', width: 'w-32', cell: s => <StatusChip value={lower(s.status)} /> },
    { key: 'start', header: 'Period start', width: 'w-40', cell: s => <span className="text-text-muted">{when(s.starts_at || s.current_period_start)}</span> },
    { key: 'end', header: 'Period end', width: 'w-40', cell: s => <span className="text-text-muted">{when(s.current_period_end)}</span> },
    { key: 'source', header: 'Source', width: 'w-40', cell: s => <code className="t-mono">{s.source || '—'}</code> },
  ]
  return <AdminPage crumbs={[{ label: 'Business' }, { label: 'Subscriptions' }]} roles={['operator']}>
    <PageHeader title="Subscriptions" subtitle="Latest 200 subscriptions" />
    <FilterBar onReset={() => { setQ(''); setStatus('') }}><SearchInput value={q} onChange={setQ} placeholder="Search user email" /><InlineSelect aria-label="Status" value={status} onChange={e => setStatus(e.target.value)} options={[{ value: '', label: 'Status: All' }, { value: 'active', label: 'Active' }, { value: 'cancelled', label: 'Cancelled' }, { value: 'expired', label: 'Expired' }]} /></FilterBar>
    <Gate resource={r} />
    <DataTable caption="Subscriptions" columns={columns} rows={list} rowKey={s => s.id} loading={r.loading && !r.data} onRowClick={s => s.user_id && navigate('/users/' + s.user_id)} empty={{ title: 'No subscriptions match', body: 'Plans are assigned from a user’s detail page.' }} />
  </AdminPage>
}

/* ───────────── Providers & usage ───────────── */

export function Providers() {
  const r = useResource(async () => ({ overview: await api.getAdminProviderOverview(), accounts: await api.getAdminProviderAccounts() })); const p = r.data?.overview
  const columns: Column<Row>[] = [
    { key: 'ref', header: 'Account', cell: a => <code className="t-mono">{a.provider_account_label || a.provider_account_id}</code> },
    { key: 'jobs', header: 'Jobs', width: 'w-24', align: 'right', cell: a => num(a.jobs_count) }, { key: 'ok', header: 'Succeeded', width: 'w-28', align: 'right', cell: a => num(a.success_count) },
    { key: 'fail', header: 'Failed', width: 'w-24', align: 'right', cell: a => <span className={a.failed_count ? 'text-danger' : undefined}>{num(a.failed_count)}</span> },
    { key: 'rate', header: 'Failure rate', width: 'w-28', align: 'right', cell: a => `${((a.failed_count / Math.max(a.jobs_count, 1)) * 100).toFixed(1)}%` },
    { key: 'tokens', header: 'Total tokens', width: 'w-36', align: 'right', cell: a => num(a.total_tokens) }, { key: 'avg', header: 'Avg. duration', width: 'w-32', align: 'right', cell: a => seconds(a.average_duration_ms) },
    { key: 'last', header: 'Last used', width: 'w-44', cell: a => <span className="text-text-muted">{when(a.last_used_at)}</span> },
  ]
  return <AdminPage crumbs={[{ label: 'Operations' }, { label: 'Providers' }]} roles={['operator']}>
    <PageHeader title="Providers" subtitle="Upstream AI health, from recorded provider runs" actions={<Button variant="secondary" icon={RefreshCw} onClick={r.refresh}>Refresh</Button>} />
    <Gate resource={r} />
    {p && <>
      <div className="flex gap-4"><StatTile label="AI jobs" value={num(p.total_ai_jobs)} /><StatTile label="Success rate" value={`${p.completed + p.failed ? ((p.completed / (p.completed + p.failed)) * 100).toFixed(1) : '0'}%`} /><StatTile label="Total tokens" value={num(p.total_tokens)} /><StatTile label="Avg. duration" value={seconds(p.average_duration_ms)} /></div>
      <div className="flex gap-4"><StatTile label="Avg. attempts" value={p.average_attempts ?? '—'} /><StatTile label="Refunded" value={num(p.refunded)} hint="Returned after failed jobs" /><StatTile label="Jobs with usage data" value={num(p.jobs_with_provider_usage)} hintTone="info" hint="Recorded provider usage" /></div>
      <Card title="Routing strategy" actions={<><Chip tone="primary">{p.configured_strategy || 'Not reported'}</Chip><Chip>Evidence: {String(p.account_distribution_evidence).replace(/_/g, ' ')}</Chip></>}><InlineAlert tone="info">{p.strategy_message}</InlineAlert></Card>
      <Section title="Upstream accounts"><DataTable caption="Upstream accounts" columns={columns} rows={rows(r.data?.accounts)} rowKey={a => String(a.provider_account_label) + String(a.provider_account_id)} empty={{ title: 'No upstream accounts recorded yet' }} /></Section>
    </>}
  </AdminPage>
}

export function Usage() {
  const navigate = useNavigate(); const [tab, setTab] = useState<'generations' | 'users'>('generations'); const [page, setPage] = useState(1); const [md, setMode] = useState(''); const [status, setStatus] = useState(''); const [q, setQ] = useState('')
  const overview = useResource(() => api.getAdminUsageOverview()); const o = overview.data
  const gens = useResource(() => api.getAdminUsageGenerations({ page, mode: md, status }), [page, md, status])
  const usersRes = useResource(() => tab === 'users' ? api.getAdminUsageUsers({ page, q }) : Promise.resolve(null), [tab, page, q])
  const genColumns: Column<Row>[] = [
    { key: 'id', header: 'ID', width: 'w-32', cell: g => <code className="t-mono">{String(g.job_id).slice(0, 12)}</code> }, { key: 'user', header: 'User', cell: g => g.user_email || 'Guest' },
    { key: 'mode', header: 'Mode', width: 'w-24', cell: g => <ModeChip mode={mode(g.mode)} /> }, { key: 'state', header: 'Status', width: 'w-32', cell: g => <StatusChip value={lower(g.status)} /> },
    { key: 'provider', header: 'Provider / model', width: 'w-44', cell: g => g.provider ? <div><p className="truncate">{g.provider}</p><p className="t-caption truncate font-mono text-text-muted">{g.model}</p></div> : <Dash /> },
    { key: 'tokens', header: 'Tokens', width: 'w-20', align: 'right', cell: g => num(g.total_tokens) }, { key: 'duration', header: 'Duration', width: 'w-24', align: 'right', cell: g => seconds(g.duration_ms) },
    { key: 'tries', header: 'Att. / retry / failover', width: 'w-40', align: 'right', cell: g => g.attempt_count ? `${g.attempt_count} / ${g.retry_count} / ${g.failover_count}` : '—' },
    { key: 'created', header: 'Created', width: 'w-40', cell: g => <span className="text-text-muted">{when(g.created_at)}</span> },
  ]
  const userColumns: Column<Row>[] = [
    { key: 'user', header: 'User', cell: u => <div><p className="t-label-s truncate">{u.display_name || u.email}</p><p className="t-caption truncate text-text-muted">{u.email}</p></div> },
    { key: 'status', header: 'Status', width: 'w-32', cell: u => <StatusChip value={lower(u.account_status)} /> }, { key: 'plan', header: 'Plan', width: 'w-20', cell: u => u.plan || 'free' },
    { key: 'granted', header: 'Granted', width: 'w-24', align: 'right', cell: u => u.total_ai_credits_granted }, { key: 'spent', header: 'Spent', width: 'w-20', align: 'right', cell: u => u.total_ai_credits_spent }, { key: 'refunded', header: 'Refunded', width: 'w-24', align: 'right', cell: u => u.total_ai_credits_refunded },
    { key: 'remaining', header: 'Remaining', width: 'w-28', align: 'right', cell: u => u.current_remaining_credits }, { key: 'adv', header: 'Advanced ✓ / ✗', width: 'w-32', align: 'right', cell: u => `${u.successful_advanced_generations} / ${u.failed_advanced_generations}` },
    { key: 'basic', header: 'Basic', width: 'w-20', align: 'right', cell: u => u.total_basic_generations }, { key: 'last', header: 'Last activity', width: 'w-40', cell: u => <span className="text-text-muted">{when(u.last_activity_at)}</span> },
  ]
  return <AdminPage crumbs={[{ label: 'Operations' }, { label: 'Usage' }]} roles={['operator']}>
    <PageHeader title="Usage" subtitle="AI cost and how much of it is covered by recorded provider data" />
    <Gate resource={overview} />
    {o && <>
      <div className="flex gap-4"><StatTile label="Total users" value={num(o.total_users)} hint={`${num(o.active_users)} active`} /><StatTile label="Successful generations" value={num(o.successful_generations)} /><StatTile label="Failed generations" value={num(o.failed_generations)} hintTone="danger" hint={`${((o.failed_generations / Math.max(o.successful_generations + o.failed_generations, 1)) * 100).toFixed(1)}% of finished jobs`} /><StatTile label="AI jobs" value={num(o.ai_jobs)} hint={`${num(o.advanced_jobs)} Advanced`} /></div>
      <div className="flex gap-4"><StatTile label="Credits spent" value={num(o.credits_spent)} /><StatTile label="Credits refunded" value={num(o.credits_refunded)} hint="Returned after failed jobs" /><StatTile label="Usage coverage" value={`${o.usage_coverage_percent}%`} hint="AI jobs with a recorded provider run" hintTone="info" /><StatTile label="Provider account coverage" value={`${o.provider_account_coverage_percent}%`} hint="Runs with a known upstream account" hintTone="info" /></div>
      {o.provider_distribution?.length > 0 && <Card title="Provider distribution"><SimpleBarChart unit="jobs" data={o.provider_distribution.map((p: Row) => ({ label: p.provider, value: p.jobs }))} /></Card>}
    </>}
    <Tabs value={tab} onChange={t => { setTab(t); setPage(1) }} tabs={[{ id: 'generations', label: 'Generations' }, { id: 'users', label: 'Users' }]} />
    {tab === 'generations' ? <>
      <FilterBar onReset={() => { setMode(''); setStatus(''); setPage(1) }}><InlineSelect aria-label="Mode" value={md} onChange={e => { setMode(e.target.value); setPage(1) }} options={opt('Mode: All', ['CLASSIC', 'BASIC', 'ADVANCED'])} /><InlineSelect aria-label="Status" value={status} onChange={e => { setStatus(e.target.value); setPage(1) }} options={opt('Status: All', ['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED'])} /></FilterBar>
      <Gate resource={gens} />
      <DataTable caption="Usage by generation" columns={genColumns} rows={gens.data?.generations ?? []} rowKey={g => g.job_id} loading={gens.loading && !gens.data} onRowClick={g => navigate('/usage/generations/' + g.job_id)} pagination={pager(gens.data, page, setPage)} />
    </> : <>
      <FilterBar onReset={() => { setQ(''); setPage(1) }}><SearchInput value={q} onChange={v => { setQ(v); setPage(1) }} placeholder="Search email, name or ID" /></FilterBar>
      <Gate resource={usersRes} />
      <DataTable caption="Usage by user" columns={userColumns} rows={usersRes.data?.users ?? []} rowKey={u => u.account_id} loading={usersRes.loading && !usersRes.data} pagination={pager(usersRes.data, page, setPage)} />
    </>}
  </AdminPage>
}

export function UsageGenerationDetail() {
  const { id = '' } = useParams(); const toast = useToast(); const r = useResource(() => api.getAdminUsageGeneration(id), [id]); const [confirming, setConfirming] = useState(false); const action = useAction(r.refresh)
  const crumbs = [{ label: 'Operations' }, { label: 'Usage', to: '/usage' }, { label: id }]
  if (r.error && !r.data) return <NotFound crumbs={crumbs} what="Generation" to="/usage" label="Back to Usage" />
  const g = r.data?.generation; const failed = lower(g?.status) === 'failed'; const est = g?.api_price_estimate
  const events: TimelineEvent[] = (r.data?.events ?? []).map((e: Row) => ({ type: e.type, detail: e.detail || '', at: when(e.created_at), tone: tone(e.type) }))
  const runColumns: Column<Row>[] = [
    { key: 'n', header: '#', width: 'w-12', cell: x => x.attempt_count ?? '—' }, { key: 'provider', header: 'Provider', cell: x => x.provider_name }, { key: 'model', header: 'Model', cell: x => <code className="t-mono">{x.provider_model}</code> },
    { key: 'account', header: 'Account', width: 'w-28', cell: x => <code className="t-mono">{x.provider_account_label || x.provider_account_id || '—'}</code> },
    { key: 'status', header: 'Status', width: 'w-28', cell: x => <StatusChip value={x.upstream_status === 'SUCCEEDED' ? 'success' : 'failed'} /> },
    { key: 'in', header: 'Input tokens', width: 'w-28', align: 'right', cell: x => num(x.input_tokens) }, { key: 'out', header: 'Output tokens', width: 'w-32', align: 'right', cell: x => num(x.output_tokens) },
    { key: 'dur', header: 'Duration', width: 'w-24', align: 'right', cell: x => seconds(x.total_duration_ms) }, { key: 'err', header: 'Error', cell: x => x.error_code ? <span className="font-mono text-xs text-danger">{x.error_code}</span> : <Dash /> },
  ]
  return <AdminPage crumbs={crumbs} roles={['operator']}>
    <PageHeader title={`Usage · ${String(id).slice(0, 12)}`} subtitle={g ? `Created ${when(g.created_at)}` : undefined} actions={<Link to={'/generations/' + id} className="t-label-s inline-flex items-center gap-1 text-primary hover:underline">Open generation record <ChevronRight size={14} aria-hidden /></Link>} />
    <Gate resource={r} />
    {g && <div className="flex items-start gap-6">
      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <Card title="Summary"><KeyValueList items={[['Job ID', <CodeValue value={g.job_id} />], ['User', g.user_email || 'Guest'], ['Mode', <ModeChip mode={mode(g.mode)} />], ['Experience', g.experience_id || g.template_id || '—'], ['State', <StatusChip value={lower(g.status)} />], ['Credit', <StatusChip value={lower(g.credit_state) || 'not_applicable'} />], ['Routing strategy', g.routing_strategy ?? '—'], ['Total duration', seconds(g.duration_ms)]]} /></Card>
        {(failed || r.data.error_code) && <InlineAlert tone="danger" title={r.data.error_code || 'FAILED'}>{r.data.error_message || 'The job failed.'}</InlineAlert>}
        <Section title="Provider runs"><DataTable caption="Provider runs" columns={runColumns} rows={r.data.provider_runs} rowKey={(x: Row) => x.id} empty={{ title: 'No provider runs', body: 'Classic strips are composed locally and make no AI provider call.' }} /></Section>
        <div className="flex gap-6">
          <Card title="Credit history" className="flex-1">{r.data.credit_history.length ? <ul className="flex flex-col gap-2.5">{r.data.credit_history.map((c: Row) => <li key={c.id} className="t-body-s flex items-center gap-4"><code className="t-mono w-32">{c.type}</code><span className={`w-8 font-semibold tabular-nums ${c.amount > 0 ? 'text-success' : c.amount < 0 ? 'text-danger' : 'text-text-muted'}`}>{signed(c.amount)}</span><span className="text-text-muted">{c.reason}</span></li>)}</ul> : <p className="t-body-s text-text-muted">No credit movement.</p>}</Card>
          <Card title="Events" className="flex-1">{events.length ? <Timeline events={events} /> : <p className="t-body-s text-text-muted">No events recorded.</p>}</Card>
        </div>
      </div>
      <div className="flex w-80 shrink-0 flex-col gap-6">
        <Card title="Estimated API price" actions={est ? <StatusChip value={lower(est.status)} /> : undefined}>{est?.status === 'estimated' ? <p className="t-h2 tabular-nums">${est.low_usd?.toFixed?.(4)} – ${est.high_usd?.toFixed?.(4)}</p> : <p className="t-h3 text-text-muted">No estimate</p>}{est?.note && <p className="t-caption mt-3 text-text-muted">{est.note}</p>}</Card>
        <Card title="Result photo"><div className="flex flex-col gap-3">
          {g.result_image_url ? <>
            <Thumb src={g.result_image_url + '?thumbnail=true'} alt="Actual generated result" className={'w-full !object-contain ' + (mode(g.mode) === 'classic' ? 'mx-auto aspect-[1/3] w-32' : 'aspect-[2/3]')} />
            <div className="flex gap-2"><a href={g.result_image_url} target="_blank" rel="noreferrer" className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-sm border border-border bg-surface px-4 text-sm font-semibold"><Eye size={16} aria-hidden />View</a><a href={g.result_download_url} className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-sm border border-border bg-surface px-4 text-sm font-semibold"><Download size={16} aria-hidden />Download</a></div>
            <Button variant="destructive" icon={Trash2} onClick={() => { action.setError(''); setConfirming(true) }}>Delete photo</Button></>
            : <div className="flex h-56 flex-col items-center justify-center gap-1 rounded-md bg-surface-2 px-4 text-center text-text-muted"><p className="t-label-s">{g.result_deleted_at ? 'Photo deleted' : failed ? 'No result — job failed' : 'No result yet'}</p>{g.result_deleted_at && <p className="t-caption">The file was removed. The job record is kept.</p>}</div>}
        </div></Card>
      </div>
    </div>}
    {confirming && <ConfirmDialog title="Delete this result photo?" description="The image file is removed permanently and any share link to it stops working. This can't be undone." confirmLabel="Delete photo" confirmText="I understand this is permanent" destructive error={action.error} onClose={() => setConfirming(false)} onConfirm={async () => { if (await action.run(() => api.deleteAdminResultPhoto(id))) { setConfirming(false); toast({ tone: 'success', title: 'Photo deleted' }) } }} />}
  </AdminPage>
}
