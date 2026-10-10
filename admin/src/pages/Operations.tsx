import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Download, Eye, RefreshCw, Trash2 } from 'lucide-react'
import { AdminPage } from '../components/AdminShell'
import { type Column, DataTable, usePaged } from '../components/DataTable'
import { ConfirmDialog, FilterBar, useToast } from '../components/overlays'
import { Timeline } from '../components/panels'
import { Button, Card, Chip, CodeValue, EmptyState, InlineAlert, InlineSelect, KeyValueList, ModeChip, PageHeader, StatTile, StatusChip, Thumb } from '../components/ui'
import { genExtras, type GenRow, genRows, overview, type ShareLink } from '../data/ops'
import { num } from '../lib/format'

/* ───────────── Overview ───────────── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3" aria-label={title}>
      <h2 className="t-h4">{title}</h2>
      {children}
    </section>
  )
}

const jump = (to: string, label: string) => (
  <Link to={to} className="text-primary hover:underline">
    {label}
  </Link>
)

export function Overview() {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const o = overview
  const refresh = () => {
    setBusy(true)
    window.setTimeout(() => {
      setBusy(false)
      toast({ tone: 'success', title: 'Overview refreshed' })
    }, 700)
  }
  return (
    <AdminPage crumbs={[{ label: 'Operations' }, { label: 'Overview' }]} roles={['operator']}>
      <PageHeader
        title="Overview"
        subtitle="Business and pipeline health · updated just now"
        actions={
          <Button variant="secondary" icon={RefreshCw} loading={busy} onClick={refresh}>
            Refresh
          </Button>
        }
      />

      <Section title="Users">
        <div className="flex gap-4">
          <StatTile label="Total users" value={num(o.users.total)} hint="+128 today" hintTone="success" />
          <StatTile label="New today" value={num(o.users.new_today)} hint="+12% vs yesterday" hintTone="success" />
          <StatTile label="Active (30 days)" value={num(o.users.active_30d)} />
        </div>
      </Section>

      <Section title="Generations">
        <div className="flex gap-4">
          <StatTile label="Completed" value={num(o.generations.completed)} />
          <StatTile label="Failed" value={num(o.generations.failed)} hint={jump('/generations?state=failed', 'View failed →')} />
          <StatTile label="Queued" value={num(o.generations.queued)} hint={jump('/generations?state=queued', 'View queue →')} />
          <StatTile label="Processing" value={num(o.generations.processing)} />
          <StatTile label="Advanced today" value={num(o.generations.advanced_today)} />
        </div>
      </Section>

      <div className="flex gap-6">
        <div className="flex flex-1 flex-col gap-6">
          <Section title="Credits & business">
            <div className="flex gap-4">
              <StatTile label="AI credits consumed" value={num(o.business.credits_consumed)} />
              <StatTile label="Active subscriptions" value={o.business.active_subscriptions} hint="Billing not enabled" />
            </div>
          </Section>
          <Section title="Catalog">
            <div className="flex gap-4">
              <StatTile label="Published" value={o.catalog.published} />
              <StatTile label="Draft" value={o.catalog.draft} />
              <StatTile label="Disabled" value={o.catalog.disabled} />
              <StatTile label="Missing previews" value={o.catalog.missing_previews} hint={jump('/experiences', 'Generate previews →')} hintTone="warning" />
            </div>
          </Section>
        </div>
        <div className="w-80 shrink-0">
          <Section title="System status">
            <Card>
              <ul className="flex flex-col gap-3">
                {o.system.map((s) => (
                  <li key={s.name} className="t-body-s flex items-center justify-between">
                    <span>{s.name}</span>
                    {s.status === 'ok' ? <StatusChip value="ok" label="OK" /> : <Chip tone={s.status === 'degraded' ? 'warning' : 'danger'}>{s.status === 'degraded' ? 'Degraded' : 'Down'}</Chip>}
                  </li>
                ))}
              </ul>
            </Card>
          </Section>
        </div>
      </div>
    </AdminPage>
  )
}

/* ───────────── Generations ───────────── */

const STATES = ['queued', 'processing', 'completed', 'failed'] as const
const MODES = ['classic', 'basic', 'advanced'] as const

export function Generations() {
  const navigate = useNavigate()
  const initialState = new URLSearchParams(window.location.search).get('state') ?? ''
  const [state, setState] = useState(initialState)
  const [mode, setMode] = useState('')
  const [userId, setUserId] = useState('')
  const filtered = useMemo(
    () => genRows.filter((g) => (!state || g.state === state) && (!mode || g.mode === mode) && (!userId || g.user.toLowerCase().includes(userId.toLowerCase()))),
    [state, mode, userId],
  )
  const { rows, pagination } = usePaged(filtered, 50)
  const reset = () => {
    setState('')
    setMode('')
    setUserId('')
  }

  const columns: Column<GenRow>[] = [
    { key: 'id', header: 'ID', width: 'w-36', cell: (g) => <code className="t-mono text-primary">{g.job_id}</code> },
    { key: 'user', header: 'User', cell: (g) => (g.user === 'Guest' ? <span className="text-text-muted">Guest</span> : g.user) },
    { key: 'mode', header: 'Mode', width: 'w-28', cell: (g) => <ModeChip mode={g.mode} /> },
    { key: 'style', header: 'Style', cell: (g) => g.style },
    { key: 'state', header: 'State', width: 'w-36', cell: (g) => <StatusChip value={g.state} /> },
    { key: 'credit', header: 'Credit', width: 'w-40', cell: (g) => <StatusChip value={g.credit} /> },
    { key: 'created', header: 'Created', width: 'w-36', cell: (g) => <span className="text-text-muted">{g.created}</span> },
    { key: 'duration', header: 'Duration', width: 'w-24', align: 'right', cell: (g) => (g.duration_s == null ? <span className="text-text-muted">—</span> : `${g.duration_s} s`) },
  ]

  return (
    <AdminPage crumbs={[{ label: 'Operations' }, { label: 'Generations' }]} roles={['operator']}>
      <PageHeader title="Generations" subtitle="Monitor and inspect jobs" />
      <FilterBar onReset={reset}>
        <InlineSelect aria-label="State" value={state} onChange={(e) => setState(e.target.value)} options={[{ value: '', label: 'State: All' }, ...STATES.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))]} />
        <InlineSelect aria-label="Mode" value={mode} onChange={(e) => setMode(e.target.value)} options={[{ value: '', label: 'Mode: All' }, ...MODES.map((m) => ({ value: m, label: m[0].toUpperCase() + m.slice(1) }))]} />
        <input
          aria-label="User ID"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder="User ID"
          className="t-body-s h-10 w-48 rounded-sm border border-border bg-surface px-3 placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </FilterBar>
      <DataTable
        caption="Generations"
        columns={columns}
        rows={rows}
        rowKey={(g) => g.job_id}
        pagination={pagination}
        onRowClick={(g) => navigate(`/generations/${g.job_id}`)}
        empty={{ title: 'No generations match', body: 'Try a different state, mode or user.' }}
      />
    </AdminPage>
  )
}

/* ───────────── Generation detail (completed + failed) ───────────── */

export function GenerationDetail() {
  const { id = '' } = useParams()
  const toast = useToast()
  const g = genRows.find((x) => x.job_id === id)
  const extra = genExtras[id]
  const [links, setLinks] = useState<ShareLink[]>(extra?.links ?? [])
  const [revoking, setRevoking] = useState<number | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleted, setDeleted] = useState(false)
  const crumbs = [{ label: 'Operations' }, { label: 'Generations', to: '/generations' }, { label: id }]

  if (!g)
    return (
      <AdminPage crumbs={crumbs} roles={['operator']}>
        <div className="rounded-md border border-border bg-surface">
          <EmptyState title="Generation not found" body="It may have been removed, or the ID is wrong." action={<Link to="/generations" className="t-label-s text-primary hover:underline">Back to Generations</Link>} />
        </div>
      </AdminPage>
    )

  const failed = g.state === 'failed'
  const guest = g.user === 'Guest'
  const ai = g.mode !== 'classic'
  const events =
    extra?.events ??
    [
      { type: 'Queued', detail: 'Job accepted', at: g.created.slice(-5) },
      ...(ai ? [{ type: 'Credit reserved', detail: '1 AI credit on hold', at: g.created.slice(-5), tone: 'accent' as const }] : []),
      ...(g.state !== 'queued' ? [{ type: 'Processing', detail: 'Worker picked up the job', at: g.created.slice(-5), tone: 'info' as const }] : []),
      ...(g.state === 'completed' ? [{ type: 'Completed', detail: 'Result stored', at: g.created.slice(-5), tone: 'success' as const }] : []),
    ]
  const linkColumns: Column<ShareLink & { i: number }>[] = [
    { key: 'created', header: 'Created', cell: (l) => l.created },
    { key: 'expires', header: 'Expires', cell: (l) => l.expires },
    { key: 'opened', header: 'First opened', cell: (l) => l.first_opened ?? <span className="text-text-muted">—</span> },
    { key: 'dl', header: 'Downloads', width: 'w-28', align: 'right', cell: (l) => l.downloads },
    { key: 'status', header: 'Status', width: 'w-32', cell: (l) => <StatusChip value={l.status} /> },
    {
      key: 'act',
      header: '',
      width: 'w-28',
      align: 'right',
      cell: (l) =>
        l.status === 'active' ? (
          <Button variant="tertiary" size="sm" onClick={() => setRevoking(l.i)}>
            Revoke
          </Button>
        ) : (
          <span className="text-text-muted">—</span>
        ),
    },
  ]

  return (
    <AdminPage crumbs={crumbs} roles={['operator']}>
      <PageHeader title={`Generation ${g.job_id}`} subtitle="Created 10 Oct 2026" />
      <div className="flex items-start gap-6">
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <Card title="Summary">
            <KeyValueList
              items={[
                ['Job ID', <CodeValue value={g.job_id} />],
                ['User', guest ? <span>Guest{extra?.guest_id ? ` · ${extra.guest_id}` : ''}</span> : g.user],
                ['Mode', <ModeChip mode={g.mode} />],
                ['Experience', <code className="t-mono">{extra?.experience ?? g.style.toLowerCase().replace(/\s+/g, '-')}</code>],
                ['State', <StatusChip value={g.state} />],
                ['Credit', <StatusChip value={g.credit} />],
                ['Duration', g.duration_s == null ? '—' : `${g.duration_s} s`],
              ]}
            />
          </Card>

          {failed && extra?.error && (
            <InlineAlert tone="danger" title={extra.error.code}>
              {extra.error.message}
            </InlineAlert>
          )}

          <Card title="Events">
            <Timeline events={events} />
          </Card>

          <section className="flex flex-col gap-3">
            <h2 className="t-h4">Share links</h2>
            {links.length ? (
              <DataTable caption="Share links" columns={linkColumns} rows={links.map((l, i) => ({ ...l, i }))} rowKey={(l) => String(l.i)} />
            ) : (
              <div className="rounded-md border border-border bg-surface">
                <EmptyState title="No share links" body={`Links appear here once the ${guest ? 'guest' : 'user'} shares a result.`} />
              </div>
            )}
          </section>
        </div>

        <div className="flex w-80 shrink-0 flex-col gap-6">
          <Card title="Result photo">
            <div className="flex flex-col gap-3">
              {g.state === 'completed' && !deleted ? (
                <>
                  <Thumb seed={g.job_id.charCodeAt(5)} alt="Generated result" className={g.mode === 'classic' ? 'mx-auto aspect-[1/3] w-32' : 'aspect-[2/3] w-full'} />
                  <div className="flex gap-2">
                    <Button variant="secondary" icon={Eye} className="flex-1">View</Button>
                    <Button variant="secondary" icon={Download} className="flex-1">Download</Button>
                  </div>
                  <Button variant="destructive" icon={Trash2} onClick={() => setDeleting(true)}>Delete photo</Button>
                </>
              ) : (
                <div className="flex h-56 flex-col items-center justify-center gap-1 rounded-md bg-surface-2 px-4 text-center text-text-muted">
                  <p className="t-label-s">{deleted ? 'Photo deleted' : failed ? 'No result — job failed' : 'No result yet'}</p>
                  {deleted && <p className="t-caption">The file was removed. The job record is kept.</p>}
                </div>
              )}
              <Link to={`/usage/generations/${g.job_id}`} className="t-label-s text-primary hover:underline">
                Open usage forensics
              </Link>
            </div>
          </Card>
        </div>
      </div>

      {revoking !== null && (
        <ConfirmDialog
          title="Revoke this share link?"
          description="Anyone with the link will see the photo as unavailable. This can't be undone."
          confirmLabel="Revoke link"
          requireReason
          destructive
          onClose={() => setRevoking(null)}
          onConfirm={() => {
            setLinks((ls) => ls.map((l, i) => (i === revoking ? { ...l, status: 'revoked' } : l)))
            setRevoking(null)
            toast({ tone: 'success', title: 'Share link revoked' })
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete this result photo?"
          description="The image file is removed permanently and any share link to it stops working. This can't be undone."
          confirmLabel="Delete photo"
          confirmText="I understand this is permanent"
          requireReason
          destructive
          onClose={() => setDeleting(false)}
          onConfirm={() => {
            setDeleted(true)
            setDeleting(false)
            toast({ tone: 'success', title: 'Photo deleted', body: `Result for ${g.job_id} was removed.` })
          }}
        />
      )}
    </AdminPage>
  )
}
