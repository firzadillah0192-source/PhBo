import { AdminPage } from '../components/AdminShell'
import { type Column, DataTable } from '../components/DataTable'
import { Card, Chip, InlineAlert, PageHeader, StatTile } from '../components/ui'
import { num, seconds } from '../lib/format'
import { providerAccounts, providerOverview as p } from '../data/mock'

type Account = (typeof providerAccounts)[number]

export function Providers() {
  const columns: Column<Account>[] = [
    { key: 'provider', header: 'Provider', cell: (a) => a.provider },
    { key: 'ref', header: 'Account', cell: (a) => <code className="t-mono">{a.account_ref}</code> },
    { key: 'jobs', header: 'Jobs', width: 'w-24', align: 'right', cell: (a) => num(a.jobs_count) },
    { key: 'ok', header: 'Succeeded', width: 'w-28', align: 'right', cell: (a) => num(a.success_count) },
    { key: 'fail', header: 'Failed', width: 'w-24', align: 'right', cell: (a) => <span className={a.failed_count ? 'text-danger' : undefined}>{num(a.failed_count)}</span> },
    { key: 'rate', header: 'Failure rate', width: 'w-28', align: 'right', cell: (a) => `${((a.failed_count / a.jobs_count) * 100).toFixed(1)}%` },
    { key: 'tokens', header: 'Total tokens', width: 'w-36', align: 'right', cell: (a) => num(a.total_tokens) },
    { key: 'avg', header: 'Avg. duration', width: 'w-32', align: 'right', cell: (a) => seconds(a.average_duration_ms) },
    { key: 'last', header: 'Last used', width: 'w-40', cell: (a) => <span className="text-text-muted">{a.last_used_at}</span> },
  ]

  return (
    <AdminPage crumbs={[{ label: 'Operations' }, { label: 'Providers' }]} roles={['operator']}>
      <PageHeader title="Providers" subtitle="Upstream AI health, from recorded provider runs" />
      <div className="flex gap-4">
        <StatTile label="AI jobs" value={num(p.total_jobs)} />
        <StatTile label="Success rate" value={`${p.success_rate_percent}%`} />
        <StatTile label="Total tokens" value={num(p.total_tokens)} />
        <StatTile label="Avg. duration" value={seconds(p.average_duration_ms)} />
      </div>
      <div className="flex gap-4">
        <StatTile label="Attempts" value={num(p.total_attempts)} hint={`${(p.total_attempts / p.total_jobs).toFixed(2)} per job`} />
        <StatTile label="Retries" value={num(p.retries)} />
        <StatTile label="Failovers" value={num(p.failovers)} hint="Moved to another account" />
      </div>
      <Card
        title="Routing strategy"
        actions={
          <>
            <Chip tone="primary">{p.routing_strategy}</Chip>
            <Chip>Evidence: {p.strategy_evidence}</Chip>
          </>
        }
      >
        <InlineAlert tone="info">{p.strategy_message}</InlineAlert>
      </Card>
      <section className="flex flex-col gap-3">
        <h2 className="t-h4">Upstream accounts</h2>
        <DataTable caption="Upstream accounts" columns={columns} rows={providerAccounts} rowKey={(a) => a.account_ref} />
      </section>
    </AdminPage>
  )
}
