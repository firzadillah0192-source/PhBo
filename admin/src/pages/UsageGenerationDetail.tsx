import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ChevronRight, Download, Eye, Trash2 } from 'lucide-react'
import { AdminPage } from '../components/AdminShell'
import { type Column, DataTable } from '../components/DataTable'
import { ConfirmDialog, useToast } from '../components/overlays'
import { Timeline, type TimelineEvent } from '../components/panels'
import { Button, Card, CodeValue, EmptyState, InlineAlert, KeyValueList, ModeChip, PageHeader, StatusChip, Thumb } from '../components/ui'
import { num, seconds, usd } from '../lib/format'
import { usageGenerations } from '../data/mock'

type Run = { attempt: number; provider: string; model: string; account: string; status: 'success' | 'failed'; input_tokens: number | null; output_tokens: number | null; duration_ms: number; error: string | null }

export function UsageGenerationDetail() {
  const { id = '' } = useParams()
  const toast = useToast()
  const g = usageGenerations.find((x) => x.job_id === id)
  const [deleted, setDeleted] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const crumbs = [{ label: 'Operations' }, { label: 'Usage', to: '/usage' }, { label: id }]

  if (!g)
    return (
      <AdminPage crumbs={crumbs} roles={['operator']}>
        <div className="rounded-md border border-border bg-surface">
          <EmptyState title="Generation not found" body="It may have been removed, or the ID is wrong." action={<Link to="/usage" className="t-label-s text-primary hover:underline">Back to Usage</Link>} />
        </div>
      </AdminPage>
    )

  const failed = g.state === 'FAILED'
  const ai = g.mode !== 'classic'

  // Derived sample rows; the API returns these as `provider_runs[]`.
  const runs: Run[] = ai
    ? Array.from({ length: g.attempts }, (_, i) => {
        const last = i === g.attempts - 1
        const ok = last && !failed
        return {
          attempt: i + 1,
          provider: g.provider!,
          model: g.model!,
          account: i === 0 || !g.failovers ? g.upstream_account! : `${g.upstream_account!.slice(0, -1)}9`,
          status: ok ? 'success' : 'failed',
          input_tokens: ok ? Math.round((g.tokens ?? 0) * 0.35) : null,
          output_tokens: ok ? Math.round((g.tokens ?? 0) * 0.65) : null,
          duration_ms: ok ? g.duration_ms ?? 0 : 100_000,
          error: ok ? null : 'AI_PROVIDER_ERROR: upstream timeout',
        }
      })
    : []

  const time = g.created_at.slice(11)
  const events: TimelineEvent[] = [
    { type: 'Queued', detail: 'Job accepted', at: time },
    ...(ai ? [{ type: 'Credit reserved', detail: '1 AI credit on hold', at: time, tone: 'accent' as const }] : []),
    { type: 'Processing', detail: 'Worker picked up the job', at: time, tone: 'info' },
    ...(g.state === 'COMPLETED' ? [{ type: 'Completed', detail: 'Result stored', at: time, tone: 'success' as const }] : []),
    ...(failed ? [{ type: 'Failed', detail: 'AI_PROVIDER_ERROR', at: time, tone: 'danger' as const }, { type: 'Credit refunded', detail: '1 AI credit returned', at: time, tone: 'success' as const }] : []),
  ]

  const credit = ai
    ? [
        { type: 'reserve', amount: -1, note: 'Held at submit' },
        failed ? { type: 'refund', amount: 1, note: 'Returned after failure' } : g.state === 'COMPLETED' ? { type: 'commit', amount: 0, note: 'Reservation committed as spend' } : null,
      ].filter((x): x is { type: string; amount: number; note: string } => !!x)
    : []

  const runColumns: Column<Run>[] = [
    { key: 'n', header: '#', width: 'w-12', cell: (r) => r.attempt },
    { key: 'provider', header: 'Provider', cell: (r) => r.provider },
    { key: 'model', header: 'Model', cell: (r) => <code className="t-mono">{r.model}</code> },
    { key: 'account', header: 'Account', width: 'w-24', cell: (r) => <code className="t-mono">{r.account}</code> },
    { key: 'status', header: 'Status', width: 'w-28', cell: (r) => <StatusChip value={r.status} /> },
    { key: 'in', header: 'Input tokens', width: 'w-28', align: 'right', cell: (r) => num(r.input_tokens) },
    { key: 'out', header: 'Output tokens', width: 'w-32', align: 'right', cell: (r) => num(r.output_tokens) },
    { key: 'dur', header: 'Duration', width: 'w-24', align: 'right', cell: (r) => seconds(r.duration_ms) },
    { key: 'err', header: 'Error', cell: (r) => (r.error ? <span className="font-mono text-xs text-danger">{r.error}</span> : <span className="text-text-muted">—</span>) },
  ]

  const est = g.api_price_estimate
  const hasResult = g.state === 'COMPLETED' && !deleted

  return (
    <AdminPage crumbs={crumbs} roles={['operator']}>
      <PageHeader
        title={`Usage · ${g.job_id}`}
        subtitle={`Created ${g.created_at}`}
        actions={
          <Link to="/generations" className="t-label-s inline-flex items-center gap-1 text-primary hover:underline">
            Open generation record <ChevronRight size={14} aria-hidden />
          </Link>
        }
      />
      <div className="flex items-start gap-6">
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <Card title="Summary">
            <KeyValueList
              items={[
                ['Job ID', <CodeValue value={g.job_id} />],
                ['User', g.user],
                ['Mode', <ModeChip mode={g.mode} />],
                ['Style', g.style],
                ['State', <StatusChip value={g.state} />],
                ['Credit', <StatusChip value={g.credit_state} />],
                ['Routing strategy', g.routing_strategy ?? '—'],
                ['Total duration', seconds(g.duration_ms)],
              ]}
            />
          </Card>

          {failed && (
            <InlineAlert tone="danger" title="AI_PROVIDER_ERROR">
              The AI provider did not return a result before the timeout. The reserved credit was refunded.
            </InlineAlert>
          )}

          <section className="flex flex-col gap-3">
            <h2 className="t-h4">Provider runs</h2>
            <DataTable caption="Provider runs" columns={runColumns} rows={runs} rowKey={(r) => String(r.attempt)} empty={{ title: 'No provider runs', body: 'Classic strips are composed locally and make no AI provider call.' }} />
          </section>

          <div className="flex gap-6">
            <Card title="Credit history" className="flex-1">
              {credit.length ? (
                <ul className="flex flex-col gap-2.5">
                  {credit.map((c) => (
                    <li key={c.type} className="t-body-s flex items-center gap-4">
                      <code className="t-mono w-20">{c.type}</code>
                      <span className={`w-8 font-semibold tabular-nums ${c.amount > 0 ? 'text-success' : c.amount < 0 ? 'text-danger' : 'text-text-muted'}`}>{c.amount > 0 ? `+${c.amount}` : c.amount === 0 ? '0' : `−${Math.abs(c.amount)}`}</span>
                      <span className="text-text-muted">{c.note}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="t-body-s text-text-muted">Classic is free — no credit movement.</p>
              )}
            </Card>
            <Card title="Events" className="flex-1">
              <Timeline events={events} />
            </Card>
          </div>
        </div>

        <div className="flex w-80 shrink-0 flex-col gap-6">
          <Card title="Estimated API price" actions={<StatusChip value={est.status} />}>
            {est.status === 'estimated' ? (
              <p className="t-h2 tabular-nums">
                {usd(est.low_usd)} – {usd(est.high_usd)}
              </p>
            ) : (
              <p className="t-h3 text-text-muted">No estimate</p>
            )}
            <p className="t-caption mt-3 text-text-muted">{est.note}</p>
          </Card>

          <Card title="Result photo">
            <div className="flex flex-col gap-3">
              {hasResult ? (
                <Thumb seed={g.job_id.charCodeAt(5)} alt="Generated result" className={g.mode === 'classic' ? 'mx-auto aspect-[1/3] w-32' : 'aspect-[2/3] w-full'} />
              ) : (
                <div className="flex h-56 flex-col items-center justify-center gap-1 rounded-md bg-surface-2 px-4 text-center text-text-muted">
                  <p className="t-label-s">{deleted ? 'Photo deleted' : failed ? 'No result — job failed' : 'No result yet'}</p>
                  {deleted && <p className="t-caption">The file was removed. The job record is kept.</p>}
                </div>
              )}
              {hasResult && (
                <>
                  <div className="flex gap-2">
                    <Button variant="secondary" icon={Eye} className="flex-1">
                      View
                    </Button>
                    <Button variant="secondary" icon={Download} className="flex-1">
                      Download
                    </Button>
                  </div>
                  <Button variant="destructive" icon={Trash2} onClick={() => setConfirming(true)}>
                    Delete photo
                  </Button>
                </>
              )}
            </div>
          </Card>
        </div>
      </div>

      {confirming && (
        <ConfirmDialog
          title="Delete this result photo?"
          description="The image file is removed permanently and any share link to it stops working. This can't be undone."
          confirmLabel="Delete photo"
          confirmText="I understand this is permanent"
          destructive
          onClose={() => setConfirming(false)}
          onConfirm={() => {
            setDeleted(true)
            setConfirming(false)
            toast({ tone: 'success', title: 'Photo deleted', body: `Result for ${g.job_id} was removed.` })
          }}
        />
      )}
    </AdminPage>
  )
}
