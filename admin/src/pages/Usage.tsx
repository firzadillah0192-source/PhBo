import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AdminPage } from '../components/AdminShell'
import { type Column, DataTable, type Sort, sortRows, usePaged } from '../components/DataTable'
import { DateRange, FilterBar, SearchInput } from '../components/overlays'
import { SimpleBarChart } from '../components/panels'
import { Card, CodeValue, InlineSelect, ModeChip, PageHeader, StatTile, StatusChip, Tabs } from '../components/ui'
import { num, seconds, usd } from '../lib/format'
import { type UsageGeneration, usageGenerations, usageOverview as o, type UsageUser, usageUsers } from '../data/mock'

const opt = (all: string, values: string[]) => [{ value: '', label: all }, ...values.map((v) => ({ value: v, label: v }))]
const uniq = (values: Array<string | null>) => [...new Set(values.filter((v): v is string => !!v))].sort()

function UsersTab() {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [plan, setPlan] = useState('')
  const [range, setRange] = useState({ from: '', to: '' })
  const [sort, setSort] = useState<Sort>({ key: 'last_activity', direction: 'desc' })

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const rows = usageUsers.filter(
      (u) =>
        (!needle || [u.email, u.display_name, u.account_id].some((s) => s.toLowerCase().includes(needle))) &&
        (!status || u.account_status === status) &&
        (!plan || u.plan === plan) &&
        (!range.from || u.signup_date >= range.from) &&
        (!range.to || u.signup_date <= range.to),
    )
    const field: Record<string, keyof UsageUser> = { signup_date: 'signup_date', email: 'email', status: 'account_status', last_activity: 'last_activity_at', credits_remaining: 'current_remaining_credits' }
    return sortRows(rows, sort, (r, k) => r[field[k]])
  }, [q, status, plan, range, sort])

  const { rows, pagination } = usePaged(filtered)
  const reset = () => (setQ(''), setStatus(''), setPlan(''), setRange({ from: '', to: '' }))

  const columns: Column<UsageUser>[] = [
    { key: 'user', header: 'User', sortKey: 'email', cell: (u) => (<div><p className="t-label-s truncate">{u.display_name}</p><p className="t-caption truncate text-text-muted">{u.email}</p></div>) },
    { key: 'status', header: 'Status', width: 'w-32', sortKey: 'status', cell: (u) => <StatusChip value={u.account_status} /> },
    { key: 'plan', header: 'Plan', width: 'w-20', cell: (u) => u.plan },
    { key: 'granted', header: 'Granted', width: 'w-24', align: 'right', cell: (u) => u.total_ai_credits_granted },
    { key: 'spent', header: 'Spent', width: 'w-20', align: 'right', cell: (u) => u.total_ai_credits_spent },
    { key: 'refunded', header: 'Refunded', width: 'w-24', align: 'right', cell: (u) => u.total_ai_credits_refunded },
    { key: 'remaining', header: 'Remaining', width: 'w-28', align: 'right', sortKey: 'credits_remaining', cell: (u) => u.current_remaining_credits },
    { key: 'adv', header: 'Advanced ✓ / ✗', width: 'w-32', align: 'right', cell: (u) => `${u.successful_advanced_generations} / ${u.failed_advanced_generations}` },
    { key: 'basic', header: 'Basic', width: 'w-20', align: 'right', cell: (u) => u.total_basic_generations },
    { key: 'signup', header: 'Signed up', width: 'w-28', sortKey: 'signup_date', cell: (u) => <span className="text-text-muted">{u.signup_date}</span> },
    { key: 'last', header: 'Last activity', width: 'w-36', sortKey: 'last_activity', cell: (u) => <span className="text-text-muted">{u.last_activity_at}</span> },
  ]

  return (
    <>
      <FilterBar onReset={reset}>
        <SearchInput value={q} onChange={setQ} placeholder="Search email, name or ID" />
        <InlineSelect aria-label="Account status" value={status} onChange={(e) => setStatus(e.target.value)} options={opt('Status: All', ['active', 'suspended'])} />
        <InlineSelect aria-label="Plan" value={plan} onChange={(e) => setPlan(e.target.value)} options={opt('Plan: All', ['free', 'plus', 'pro'])} />
        <DateRange from={range.from} to={range.to} onChange={(from, to) => setRange({ from, to })} />
      </FilterBar>
      <DataTable caption="Usage by user" columns={columns} rows={rows} rowKey={(u) => u.account_id} sort={sort} onSort={setSort} pagination={pagination} />
    </>
  )
}

function GenerationsTab() {
  const navigate = useNavigate()
  const [f, setF] = useState({ mode: '', status: '', user: '', provider: '', model: '', account: '', strategy: '', from: '', to: '' })
  const set = (patch: Partial<typeof f>) => setF((prev) => ({ ...prev, ...patch }))

  const filtered = useMemo(() => {
    const needle = f.user.trim().toLowerCase()
    return usageGenerations.filter(
      (g) =>
        (!f.mode || g.mode === f.mode) &&
        (!f.status || g.state === f.status) &&
        (!needle || g.user.toLowerCase().includes(needle)) &&
        (!f.provider || g.provider === f.provider) &&
        (!f.model || g.model === f.model) &&
        (!f.account || g.upstream_account === f.account) &&
        (!f.strategy || g.routing_strategy === f.strategy) &&
        (!f.from || g.created_at.slice(0, 10) >= f.from) &&
        (!f.to || g.created_at.slice(0, 10) <= f.to),
    )
  }, [f])

  const { rows, pagination } = usePaged(filtered)

  const columns: Column<UsageGeneration>[] = [
    { key: 'id', header: 'ID', width: 'w-32', cell: (g) => <code className="t-mono">{g.job_id}</code> },
    { key: 'user', header: 'User', cell: (g) => g.user },
    { key: 'mode', header: 'Mode', width: 'w-24', cell: (g) => <ModeChip mode={g.mode} /> },
    { key: 'state', header: 'Status', width: 'w-32', cell: (g) => <StatusChip value={g.state} /> },
    { key: 'provider', header: 'Provider / model', width: 'w-40', cell: (g) => (g.provider ? (<div><p className="truncate">{g.provider}</p><p className="t-caption truncate font-mono text-text-muted">{g.model}</p></div>) : <span className="text-text-muted">—</span>) },
    { key: 'account', header: 'Account', width: 'w-24', cell: (g) => (g.upstream_account ? <code className="t-mono">{g.upstream_account}</code> : <span className="text-text-muted">—</span>) },
    { key: 'tokens', header: 'Tokens', width: 'w-20', align: 'right', cell: (g) => num(g.tokens) },
    { key: 'duration', header: 'Duration', width: 'w-24', align: 'right', cell: (g) => seconds(g.duration_ms) },
    { key: 'tries', header: 'Att. / retry / failover', width: 'w-40', align: 'right', cell: (g) => (g.attempts ? `${g.attempts} / ${g.retries} / ${g.failovers}` : '—') },
    { key: 'price', header: 'Est. API price', width: 'w-36', align: 'right', cell: (g) => (g.api_price_estimate.status === 'estimated' ? `${usd(g.api_price_estimate.low_usd)}–${usd(g.api_price_estimate.high_usd).slice(1)}` : '—') },
    { key: 'created', header: 'Created', width: 'w-36', cell: (g) => <span className="text-text-muted">{g.created_at}</span> },
  ]

  return (
    <>
      <FilterBar onReset={() => setF({ mode: '', status: '', user: '', provider: '', model: '', account: '', strategy: '', from: '', to: '' })}>
        <SearchInput value={f.user} onChange={(user) => set({ user })} placeholder="User email or ID" className="w-56" />
        <InlineSelect aria-label="Mode" value={f.mode} onChange={(e) => set({ mode: e.target.value })} options={opt('Mode: All', ['classic', 'basic', 'advanced'])} />
        <InlineSelect aria-label="Status" value={f.status} onChange={(e) => set({ status: e.target.value })} options={opt('Status: All', ['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED'])} />
        <InlineSelect aria-label="Provider" value={f.provider} onChange={(e) => set({ provider: e.target.value })} options={opt('Provider: All', uniq(usageGenerations.map((g) => g.provider)))} />
        <InlineSelect aria-label="Model" value={f.model} onChange={(e) => set({ model: e.target.value })} options={opt('Model: All', uniq(usageGenerations.map((g) => g.model)))} />
        <InlineSelect aria-label="Upstream account" value={f.account} onChange={(e) => set({ account: e.target.value })} options={opt('Account: All', uniq(usageGenerations.map((g) => g.upstream_account)))} />
        <InlineSelect aria-label="Routing strategy" value={f.strategy} onChange={(e) => set({ strategy: e.target.value })} options={opt('Routing: All', uniq(usageGenerations.map((g) => g.routing_strategy)))} />
        <DateRange from={f.from} to={f.to} onChange={(from, to) => set({ from, to })} />
      </FilterBar>
      <DataTable caption="Usage by generation" columns={columns} rows={rows} rowKey={(g) => g.job_id} onRowClick={(g) => navigate(`/usage/generations/${g.job_id}`)} pagination={pagination} />
    </>
  )
}

export function Usage() {
  const [tab, setTab] = useState<'generations' | 'users'>('generations')
  return (
    <AdminPage crumbs={[{ label: 'Operations' }, { label: 'Usage' }]} roles={['operator']}>
      <PageHeader title="Usage" subtitle="AI cost and how much of it is covered by recorded provider data" />
      <div className="flex gap-4">
        <StatTile label="Total users" value={num(o.total_users)} hint={`${num(o.active_users)} active`} />
        <StatTile label="Successful generations" value={num(o.successful_generations)} />
        <StatTile label="Failed generations" value={num(o.failed_generations)} hintTone="danger" hint={`${((o.failed_generations / (o.successful_generations + o.failed_generations)) * 100).toFixed(1)}% of finished jobs`} />
        <StatTile label="AI jobs" value={num(o.ai_jobs)} hint={`${num(o.advanced_jobs)} Advanced`} />
      </div>
      <div className="flex gap-4">
        <StatTile label="Credits spent" value={num(o.credits_spent)} />
        <StatTile label="Credits refunded" value={num(o.credits_refunded)} hint="Returned after failed jobs" />
        <StatTile label="Usage coverage" value={`${o.usage_coverage_percent}%`} hint="AI jobs with a recorded provider run" hintTone="info" />
        <StatTile label="Provider account coverage" value={`${o.provider_account_coverage_percent}%`} hint="Runs with a known upstream account" hintTone="info" />
      </div>
      <Card title="Provider distribution">
        <SimpleBarChart unit="jobs" data={o.provider_distribution.map((p) => ({ label: p.provider, value: p.jobs }))} />
      </Card>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'generations', label: 'Generations' },
          { id: 'users', label: 'Users' },
        ]}
      />
      {tab === 'generations' ? <GenerationsTab /> : <UsersTab />}
    </AdminPage>
  )
}

export { CodeValue }
