import React, { useEffect, useMemo, useState } from 'react'
import {
  adjustAdminUserCredits, changeAdminUserStatus, changeAdminUserSubscription,
  createAdminExperience, createAdminPlan, createAdminTemplate, createAdminUser,
  deleteAdminExperience, deleteAdminTemplate, getAdminActors, getAdminAudit,
  getAdminExperiences, getAdminGeneration, getAdminGenerations, getAdminLedger,
  getAdminOverview, getAdminPlans, getAdminSettings, getAdminSubscriptions,
  getAdminTemplates, getAdminUser, getAdminUserAudit, getAdminUserCredits,
  getAdminUserGenerations, getAdminUserSessions, getAdminUsers, loginAdmin,
  logoutAdmin, replaceAdminExperienceThumbnail, replaceAdminTemplateImage,
  deleteAdminExperienceThumbnail, generateAdminExperiencePreview,
  generateMissingAdminPreviews, getAdminPreviewSources, publishReadyAdminExperiences,
  uploadAdminPreviewSource,
  updateAdminExperience, updateAdminPlan, updateAdminTemplate, updateAdminUser,
} from './api.js'
import { ApiError } from './api.js'
import { toError } from './components/common.jsx'
import BasicTemplatePanel from './components/admin/BasicTemplatePanel.jsx'

const SECTIONS = [
  ['overview', 'Overview'], ['users', 'Users'], ['credits', 'Credits'],
  ['subscriptions', 'Subscriptions'], ['generations', 'Generations'],
  ['experiences', 'Advanced Experiences'], ['templates', 'Basic Templates'],
  ['admin-users', 'Admin Users'], ['audit', 'Audit Log'], ['settings', 'Settings'],
]

const emptyExperience = { id: '', name: '', description: '', internal_prompt: '', status: 'draft', category: 'Design', enabled: true, sort_order: 0 }
const emptyTemplate = { id: '', name: '', description: '', enabled: true, sort_order: 0 }
const emptyPlan = { id: '', code: '', name: '', description: '', monthly_ai_credits: 0, billing_period: 'month', price_amount: '', currency: '', is_active: true }

function date(value) { return value ? new Date(value).toLocaleString() : '—' }
function money(value, currency) { return value === null || value === undefined ? '—' : `${value} ${currency || ''}`.trim() }
function keyId() { return window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}` }
function errorMessage(error, fallback = 'Request failed') {
  if (error instanceof ApiError) return error.message || fallback
  return error?.message || fallback
}
function confirmAction(message) { return window.confirm(message) }

function Field({ label, children, hint }) {
  return <label className="admin-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>
}
function Button({ children, className = '', ...props }) { return <button className={className} {...props}>{children}</button> }
function Empty({ children = 'No records found.' }) { return <div className="admin-empty">{children}</div> }
function Busy({ children = 'Loading…' }) { return <div className="admin-loading">{children}</div> }
function Badge({ children, tone = '' }) { return <span className={`admin-badge ${tone}`}>{children}</span> }
function Table({ children }) { return <div className="admin-table-wrap"><table className="admin-table">{children}</table></div> }

function OverviewPanel({ onOpen }) {
  const [data, setData] = useState(null); const [error, setError] = useState('')
  useEffect(() => { getAdminOverview().then(setData).catch((e) => setError(errorMessage(e))) }, [])
  if (error) return <div className="admin-error">{error}</div>
  if (!data) return <Busy />
  const cards = [
    ['Total users', data.total_users], ['New users today', data.new_users_today],
    ['Active users', data.active_users], ['Advanced today', data.advanced_generations_today],
    ['Successful generations', data.successful_generations], ['Failed generations', data.failed_generations],
    ['Queued / processing', `${data.queued_jobs} / ${data.processing_jobs}`], ['AI credits consumed', data.ai_credits_consumed],
    ['Active subscriptions', data.active_subscriptions],
    ['Total experiences', data.total_experiences], ['Published', data.published_experiences],
    ['Draft', data.draft_experiences], ['Disabled', data.disabled_experiences],
    ['Missing previews', data.missing_experience_previews],
  ]
  return <>
    <section className="admin-metric-grid">{cards.map(([label, value]) => <article className="admin-metric" key={label}><span>{label}</span><strong>{value}</strong></article>)}</section>
    <section className="admin-card"><div className="admin-section-head"><div><h2>Operational pulse</h2><p className="admin-muted">Metrics are calculated from current database records.</p></div><Button onClick={() => onOpen('generations')}>Open jobs</Button></div><p className="admin-muted">Use Users for account support, Credits for immutable accounting, and Generations for queue operations.</p></section>
  </>
}

function UserDetail({ userId, onBack, onChanged }) {
  const [detail, setDetail] = useState(null); const [credits, setCredits] = useState(null); const [generations, setGenerations] = useState([]); const [sessions, setSessions] = useState([]); const [audit, setAudit] = useState([]); const [plans, setPlans] = useState([]); const [tab, setTab] = useState('overview'); const [amount, setAmount] = useState('1'); const [reason, setReason] = useState(''); const [planId, setPlanId] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('')
  const reload = async () => { setBusy(true); setError(''); try { const [u, c, g, s, a, p] = await Promise.all([getAdminUser(userId), getAdminUserCredits(userId), getAdminUserGenerations(userId), getAdminUserSessions(userId), getAdminUserAudit(userId), getAdminPlans()]); setDetail(u); setCredits(c); setGenerations(g); setSessions(s); setAudit(a); setPlans(p); setPlanId(u.subscription?.plan_id || p.find((x) => x.is_active)?.id || '') } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) } }
  useEffect(() => { reload() }, [userId])
  const mutate = async (fn, success) => { setBusy(true); setError(''); setNotice(''); try { await fn(); setNotice(success); await reload(); onChanged?.() } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) } }
  if (!detail) return <Busy />
  const user = detail.user
  return <section className="admin-detail">
    <div className="admin-section-head"><div><Button className="admin-back" onClick={onBack}>← Users</Button><h2>{user.name || user.email}</h2><p className="admin-muted">{user.email} · {user.status} · {user.auth_provider}</p></div><Badge tone={user.status === 'active' ? 'ok' : 'warn'}>{user.status}</Badge></div>
    {error && <div className="admin-error">{error}</div>}{notice && <div className="admin-notice">{notice}</div>}
    <nav className="admin-subtabs">{[['overview','Overview'],['credits','Credits'],['subscription','Subscription'],['generations','Generations'],['sessions','Sessions'],['audit','Audit']].map(([id,label]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}</nav>
    {tab === 'overview' && <div className="admin-detail-grid"><article className="admin-card"><h3>Account</h3><dl className="admin-dl"><dt>Created</dt><dd>{date(user.created_at)}</dd><dt>Last activity</dt><dd>{date(user.last_activity_at)}</dd><dt>Generations</dt><dd>{user.total_generations}</dd><dt>Identity</dt><dd>{user.auth_provider}</dd></dl></article><article className="admin-card"><h3>Credit balance</h3><p className="admin-balance">{user.ai_remaining} <small>available</small></p><p className="admin-muted">Total {user.ai_total} · Spent {user.ai_used}</p></article><article className="admin-card"><h3>Account actions</h3><div className="admin-actions"><Button disabled={busy} onClick={() => mutate(() => changeAdminUserStatus(user.id, { status: user.status === 'active' ? 'suspended' : 'active', reason: user.status === 'active' ? 'Operational suspension' : 'Operational unsuspension', confirm: true }), user.status === 'active' ? 'User suspended.' : 'User unsuspended.')}>{user.status === 'active' ? 'Suspend user' : 'Unsuspend user'}</Button><Button disabled={busy} onClick={() => mutate(() => revokeSessions(user.id), 'Sessions revoked.')}>Revoke sessions</Button></div></article></div>}
    {tab === 'credits' && <div className="admin-detail-grid"><article className="admin-card"><h3>Auditable adjustment</h3><p className="admin-muted">Positive amount grants credits; negative amount deducts available credits.</p><Field label="Amount"><input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field><Field label="Reason"><textarea rows="3" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Required support reason" /></Field><Button className="primary" disabled={busy || !reason.trim()} onClick={() => { if (!confirmAction('Apply this credit adjustment?')) return; mutate(() => adjustAdminUserCredits(user.id, { amount: Number(amount), reason, confirm: true, idempotency_key: keyId() }), 'Credit ledger updated.') }}>Apply adjustment</Button></article><article className="admin-card"><h3>Balance</h3><p className="admin-balance">{credits?.balance?.remaining ?? user.ai_remaining} <small>available</small></p><p className="admin-muted">Total {credits?.balance?.total ?? user.ai_total} · Reserved {credits?.balance?.reserved ?? 0}</p></article><article className="admin-card admin-span-2"><h3>Ledger</h3><LedgerRows entries={credits?.entries || []} /></article></div>}
    {tab === 'subscription' && <div className="admin-card"><h3>Manual subscription</h3><div className="admin-inline-form"><Field label="Plan"><select value={planId} onChange={(e) => setPlanId(e.target.value)}><option value="">Select plan</option>{plans.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.monthly_ai_credits} credits</option>)}</select></Field><Button disabled={busy || !planId} onClick={() => mutate(() => changeAdminUserSubscription(user.id, { action: 'assign', plan_id: planId, reason: 'Manual admin assignment', confirm: true }), 'Subscription assigned.')}>Assign / change</Button>{detail.subscription && <><Button disabled={busy} onClick={() => mutate(() => changeAdminUserSubscription(user.id, { action: 'cancel', reason: 'Manual admin cancellation', confirm: true }), 'Subscription cancelled.')}>Cancel</Button><Button disabled={busy} onClick={() => mutate(() => changeAdminUserSubscription(user.id, { action: 'expire', reason: 'Manual admin expiry', confirm: true }), 'Subscription expired.')}>Expire</Button></>}</div>{detail.subscription ? <pre className="admin-json">{JSON.stringify(detail.subscription, null, 2)}</pre> : <Empty>No active subscription.</Empty>}</div>}
    {tab === 'generations' && <div className="admin-card"><h3>User generations</h3><GenerationRows jobs={generations} /></div>}
    {tab === 'sessions' && <div className="admin-card"><h3>Customer sessions</h3><Table><thead><tr><th>Session</th><th>Created</th><th>Last seen</th><th>Expires</th><th>Status</th></tr></thead><tbody>{sessions.map((s) => <tr key={s.id}><td><code>…{s.id}</code></td><td>{date(s.created_at)}</td><td>{date(s.last_seen_at)}</td><td>{date(s.expires_at)}</td><td>{s.active ? 'Active' : 'Expired'}</td></tr>)}</tbody></Table>{!sessions.length && <Empty />}</div>}
    {tab === 'audit' && <div className="admin-card"><h3>User audit</h3><AuditRows entries={audit} /></div>}
  </section>
}

function revokeSessions(id) { return revokeAdminUserSessions(id, { status: 'active', reason: 'Manual session revocation', confirm: true }) }
function LedgerRows({ entries }) { return entries.length ? <Table><thead><tr><th>Type</th><th>Amount</th><th>Reason</th><th>Time</th></tr></thead><tbody>{entries.map((row) => <tr key={row.id}><td><Badge>{row.type}</Badge></td><td className={row.amount < 0 ? 'negative' : 'positive'}>{row.amount > 0 ? '+' : ''}{row.amount}</td><td>{row.reason}</td><td>{date(row.created_at)}</td></tr>)}</tbody></Table> : <Empty /> }
function GenerationRows({ jobs, onSelect }) { return jobs.length ? <Table><thead><tr><th>Job</th><th>Mode</th><th>Asset</th><th>Status</th><th>Credit</th><th>Created</th></tr></thead><tbody>{jobs.map((job) => <tr key={job.job_id} onClick={() => onSelect?.(job)} className={onSelect ? 'clickable' : ''}><td><code>{job.job_id.slice(0, 10)}</code></td><td>{job.mode}</td><td>{job.experience_id || job.template_id || '—'}</td><td><Badge tone={job.state === 'COMPLETED' ? 'ok' : job.state === 'FAILED' ? 'warn' : ''}>{job.state}</Badge></td><td>{job.credit_state}</td><td>{date(job.created_at)}</td></tr>)}</tbody></Table> : <Empty /> }
function AuditRows({ entries }) { return entries.length ? <Table><thead><tr><th>Action</th><th>Target</th><th>Actor</th><th>Reason</th><th>Time</th></tr></thead><tbody>{entries.map((row) => <tr key={row.id}><td>{row.action}</td><td>{row.target_type}/{row.target_id.slice(0, 12)}</td><td><code>{row.admin_actor_id}</code></td><td>{row.reason || '—'}</td><td>{date(row.created_at)}</td></tr>)}</tbody></Table> : <Empty /> }

function UsersPanel() {
  const [data, setData] = useState(null); const [search, setSearch] = useState(''); const [status, setStatus] = useState(''); const [selected, setSelected] = useState(null); const [error, setError] = useState(''); const [page, setPage] = useState(1)
  const load = () => getAdminUsers({ search, status, page, page_size: 50 }).then(setData).catch((e) => setError(errorMessage(e)))
  useEffect(() => { load() }, [status, page])
  if (selected) return <UserDetail userId={selected} onBack={() => setSelected(null)} onChanged={load} />
  return <section><div className="admin-section-head"><div><h2>Users</h2><p className="admin-muted">Search and support customer accounts without editing balances directly.</p></div></div><div className="admin-toolbar"><input placeholder="Search name or email" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} /><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option><option value="active">Active</option><option value="suspended">Suspended</option></select><Button onClick={load}>Search</Button></div>{error && <div className="admin-error">{error}</div>}{!data ? <Busy /> : data.users.length ? <><Table><thead><tr><th>User</th><th>Provider</th><th>Status</th><th>Plan</th><th>Credits</th><th>Generations</th><th>Activity</th></tr></thead><tbody>{data.users.map((user) => <tr key={user.id} className="clickable" onClick={() => setSelected(user.id)}><td><strong>{user.name || 'Unnamed'}</strong><br /><span className="admin-muted">{user.email}</span></td><td>{user.auth_provider}</td><td><Badge tone={user.status === 'active' ? 'ok' : 'warn'}>{user.status}</Badge></td><td>{user.subscription_plan || '—'}</td><td>{user.ai_remaining} / {user.ai_total}</td><td>{user.total_generations}</td><td>{date(user.last_activity_at)}</td></tr>)}</tbody></Table><div className="admin-pagination"><span>Page {data.page} / {data.pages}</span><Button disabled={data.page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button disabled={data.page >= data.pages} onClick={() => setPage(page + 1)}>Next</Button></div></> : <Empty />}</section>
}

function CreditsPanel() { const [data, setData] = useState(null); const [type, setType] = useState(''); useEffect(() => { getAdminLedger(type ? { entry_type: type } : {}).then(setData).catch(() => setData({ entries: [] })) }, [type]); return <section><div className="admin-section-head"><div><h2>Credits</h2><p className="admin-muted">Immutable credit ledger. Reservations, spends, refunds and admin mutations are visible here.</p></div><select value={type} onChange={(e) => setType(e.target.value)}><option value="">All transactions</option><option value="signup_bonus">Signup bonus</option><option value="admin_grant">Admin grant</option><option value="admin_adjustment">Admin adjustment</option><option value="generation_spend">Generation spend</option><option value="generation_refund">Generation refund</option><option value="subscription_grant">Subscription grant</option></select></div>{data ? <LedgerRows entries={data.entries} /> : <Busy />}</section> }

function PlansPanel() { const [plans, setPlans] = useState(null); const [form, setForm] = useState({ ...emptyPlan }); const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const load = () => getAdminPlans().then(setPlans).catch((e) => setError(errorMessage(e))); useEffect(load, []); const save = async (e) => { e.preventDefault(); setError(''); try { const body = { ...form, monthly_ai_credits: Number(form.monthly_ai_credits), price_amount: form.price_amount === '' ? null : Number(form.price_amount) }; if (form.id) await updateAdminPlan(form.id, body); else await createAdminPlan(body); setForm({ ...emptyPlan }); setNotice('Plan saved.'); load() } catch (x) { setError(errorMessage(x)) } }; return <section><div className="admin-section-head"><div><h2>Subscriptions</h2><p className="admin-muted">Manual domain foundation. Payment providers are intentionally deferred.</p></div></div>{error && <div className="admin-error">{error}</div>}{notice && <div className="admin-notice">{notice}</div>}<form className="admin-card admin-form-grid" onSubmit={save}><h3>{form.id ? 'Edit plan' : 'Add plan'}</h3>{[['id','ID'],['code','Code'],['name','Name'],['description','Description'],['monthly_ai_credits','AI credits'],['billing_period','Billing period'],['price_amount','Price amount'],['currency','Currency']].map(([key,label]) => <Field key={key} label={label}><input disabled={form.id && key === 'id'} required={['id','code','name'].includes(key)} type={key.includes('credits') || key === 'price_amount' ? 'number' : 'text'} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} /></Field>)}<Field label="Active"><select value={String(form.is_active)} onChange={(e) => setForm({ ...form, is_active: e.target.value === 'true' })}><option value="true">Active</option><option value="false">Inactive</option></select></Field><div className="admin-actions"><Button className="primary" type="submit">Save plan</Button>{form.id && <Button type="button" onClick={() => setForm({ ...emptyPlan })}>Cancel</Button>}</div></form>{plans ? <Table><thead><tr><th>Plan</th><th>Allowance</th><th>Billing</th><th>Price</th><th>Status</th><th /></tr></thead><tbody>{plans.map((plan) => <tr key={plan.id}><td><strong>{plan.name}</strong><br /><span className="admin-muted">{plan.code}</span></td><td>{plan.monthly_ai_credits}</td><td>{plan.billing_period}</td><td>{money(plan.price_amount, plan.currency)}</td><td>{plan.is_active ? 'Active' : 'Inactive'}</td><td><Button onClick={() => setForm({ ...plan, price_amount: plan.price_amount ?? '' })}>Edit</Button></td></tr>)}</tbody></Table> : <Busy />}</section> }

function SubscriptionList() { const [rows, setRows] = useState(null); useEffect(() => { getAdminSubscriptions().then(setRows).catch(() => setRows([])) }, []); return <section><div className="admin-section-head"><div><h2>Subscriptions</h2><p className="admin-muted">Current and historical manual assignments.</p></div></div>{rows ? <Table><thead><tr><th>User</th><th>Plan</th><th>Status</th><th>Period</th><th>Source</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{row.user_email || row.user_id}</td><td>{row.plan_name || row.plan_code || '—'}</td><td>{row.status}</td><td>{date(row.current_period_start)} → {date(row.current_period_end)}</td><td>{row.source}</td></tr>)}</tbody></Table> : <Busy />}</section> }

function GenerationsPanel() { const [data, setData] = useState(null); const [state, setState] = useState(''); const [mode, setMode] = useState(''); const [detail, setDetail] = useState(null); const load = () => getAdminGenerations({ state, mode }).then(setData).catch(() => setData({ jobs: [] })); useEffect(load, [state, mode]); return <section><div className="admin-section-head"><div><h2>Generations</h2><p className="admin-muted">Queue and credit state for operational support.</p></div><div className="admin-filter-row"><select value={state} onChange={(e) => setState(e.target.value)}><option value="">All states</option><option>QUEUED</option><option>PROCESSING</option><option>COMPLETED</option><option>FAILED</option></select><select value={mode} onChange={(e) => setMode(e.target.value)}><option value="">All modes</option><option>BASIC</option><option>ADVANCED</option></select></div></div>{detail && <div className="admin-card"><div className="admin-section-head"><h3>Job {detail.job.job_id}</h3><Button onClick={() => setDetail(null)}>Close</Button></div><p>{detail.error_code || 'No error'} {detail.error_message || ''}</p><Table><thead><tr><th>Event</th><th>Detail</th><th>Time</th></tr></thead><tbody>{detail.events.map((event, index) => <tr key={index}><td>{event.type}</td><td>{event.detail}</td><td>{date(event.created_at)}</td></tr>)}</tbody></Table></div>}{data ? <GenerationRows jobs={data.jobs} onSelect={(job) => getAdminGeneration(job.job_id).then(setDetail)} /> : <Busy />}</section> }

function PreviewFactoryPanel({ items, onReload, onError, onNotice }) {
  const [sources, setSources] = useState([])
  const [sourceFile, setSourceFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const source = sources.find((item) => item.id === 'portrait-default')
  const loadSources = () => getAdminPreviewSources().then(setSources).catch((e) => onError(errorMessage(e, 'Could not load canonical preview sources.')))
  useEffect(loadSources, [])
  const uploadSource = async () => {
    if (!sourceFile) return
    setBusy(true); onError('')
    try { await uploadAdminPreviewSource('portrait-default', sourceFile); setSourceFile(null); onNotice('Canonical portrait source updated.'); await loadSources() }
    catch (e) { onError(errorMessage(e, 'Could not save the canonical source.')) }
    finally { setBusy(false) }
  }
  const generateMissing = async () => {
    const count = items.filter((item) => item.preview_status !== 'READY' || item.preview_missing).length
    if (!count || !source?.has_asset) return
    if (!confirmAction(`Generate ${count} missing previews? This will use the external AI provider and may incur cost.`)) return
    setBusy(true); onError('')
    try { const result = await generateMissingAdminPreviews({ confirm: true, source_id: source.id }); onNotice(`${result.queued} preview job${result.queued === 1 ? '' : 's'} queued. Existing ready previews were skipped.`); await onReload() }
    catch (e) { onError(errorMessage(e, 'Could not queue missing previews.')) }
    finally { setBusy(false) }
  }
  const publishReady = async () => {
    if (!confirmAction('Publish every draft experience with a READY marketing preview?')) return
    setBusy(true); onError('')
    try { const result = await publishReadyAdminExperiences(true); onNotice(`${result.published} ready experience${result.published === 1 ? '' : 's'} published.`); await onReload() }
    catch (e) { onError(errorMessage(e, 'Could not publish ready experiences.')) }
    finally { setBusy(false) }
  }
  return <section className="admin-card admin-preview-factory"><div className="admin-section-head"><div><h3>Preview Factory</h3><p className="admin-muted">Internal provider jobs use the canonical source and never consume customer credits.</p></div><Badge tone={source?.has_asset ? 'ok' : 'warn'}>{source?.has_asset ? 'Source ready' : 'Source missing'}</Badge></div><div className="admin-inline-form"><Field label="Canonical portrait"><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setSourceFile(e.target.files?.[0] || null)} /><small>Adult, neutral, well-lit demo subject. Stored separately from customer uploads.</small></Field><Button disabled={busy || !sourceFile} onClick={uploadSource}>Upload source</Button></div><div className="admin-actions"><Button className="primary" disabled={busy || !source?.has_asset} onClick={generateMissing}>Generate Missing Previews ({items.filter((item) => item.preview_status !== 'READY' || item.preview_missing).length})</Button><Button disabled={busy} onClick={publishReady}>Publish All Ready</Button></div></section>
}

function ContentPanel({ kind }) {
  const experience = kind === 'experience'
  const [items, setItems] = useState([])
  const [editor, setEditor] = useState(null)
  const [filter, setFilter] = useState('all')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const load = () => (experience ? getAdminExperiences() : getAdminTemplates()).then(setItems).catch((e) => setError(errorMessage(e)))
  useEffect(load, [kind])
  const save = async (event) => {
    event.preventDefault(); setError('')
    try {
      const body = experience
        ? { name: editor.data.name, description: editor.data.description, internal_prompt: editor.data.internal_prompt, status: editor.data.status, category: editor.data.category, enabled: editor.data.enabled, sort_order: Number(editor.data.sort_order) }
        : { name: editor.data.name, description: editor.data.description, enabled: editor.data.enabled, sort_order: Number(editor.data.sort_order) }
      const saved = editor.isNew
        ? await (experience ? createAdminExperience({ id: editor.data.id, ...body }) : createAdminTemplate({ id: editor.data.id, ...body }))
        : await (experience ? updateAdminExperience(editor.data.id, body) : updateAdminTemplate(editor.data.id, body))
      if (editor.file) await (experience ? replaceAdminExperienceThumbnail(saved.id, editor.file) : replaceAdminTemplateImage(saved.id, editor.file))
      setEditor(null); setNotice('Saved successfully.'); load()
    } catch (e) { setError(errorMessage(e, 'Could not save changes.')) }
  }
  const changeStatus = async (item, status) => {
    if (status === 'published' && item.preview_missing && !confirmAction(`${item.name} has no marketing preview. Publish anyway?`)) return
    try { await updateAdminExperience(item.id, { status }); setNotice(`Moved to ${status}.`); load() } catch (e) { setError(errorMessage(e)) }
  }
  const remove = async (item) => {
    if (!confirmAction(`Delete ${item.name}?`)) return
    try { await (experience ? deleteAdminExperience(item.id) : deleteAdminTemplate(item.id)); setNotice('Deleted successfully.'); load() } catch (e) { setError(errorMessage(e)) }
  }
  const visible = experience && filter !== 'all' ? items.filter((item) => item.status === filter) : items
  return <section>
    <div className="admin-section-head"><div><h2>{experience ? 'Advanced Experiences' : 'Basic Templates'}</h2><p className="admin-muted">{experience ? 'Customer visibility is controlled by explicit publication status.' : 'Customer-facing deterministic template assets.'}</p></div><Button className="primary" onClick={() => setEditor({ isNew: true, data: { ...(experience ? emptyExperience : emptyTemplate) }, file: null })}>Add</Button></div>
    {experience && <div className="admin-filter-row admin-catalog-filters">{[['all', 'All'], ['draft', 'Draft'], ['published', 'Published'], ['disabled', 'Disabled']].map(([value, label]) => <Button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{label}</Button>)}</div>}
    {error && <div className="admin-error">{error}</div>}{notice && <div className="admin-notice">{notice}</div>}
    {experience && <PreviewFactoryPanel items={items} onReload={load} onError={setError} onNotice={setNotice} />}
    {editor && <form className="admin-card" onSubmit={save}><div className="admin-section-head"><h3>{editor.isNew ? 'Add' : 'Edit'} {experience ? 'Advanced Experience' : 'Basic Template'}</h3><Button type="button" onClick={() => setEditor(null)}>Cancel</Button></div><div className="admin-form-grid"><Field label="ID"><input value={editor.data.id} disabled={!editor.isNew} required onChange={(e) => setEditor({ ...editor, data: { ...editor.data, id: e.target.value } })} /></Field><Field label="Name"><input value={editor.data.name} required onChange={(e) => setEditor({ ...editor, data: { ...editor.data, name: e.target.value } })} /></Field><Field label="Sort order"><input type="number" value={editor.data.sort_order} onChange={(e) => setEditor({ ...editor, data: { ...editor.data, sort_order: e.target.value } })} /></Field>{experience ? <><Field label="Publication status"><select value={editor.data.status || 'draft'} onChange={(e) => setEditor({ ...editor, data: { ...editor.data, status: e.target.value } })}><option value="draft">Draft</option><option value="published">Published</option><option value="disabled">Disabled</option></select></Field><Field label="Category"><input value={editor.data.category || 'Design'} onChange={(e) => setEditor({ ...editor, data: { ...editor.data, category: e.target.value } })} /></Field></> : <Field label="Enabled"><select value={String(editor.data.enabled)} onChange={(e) => setEditor({ ...editor, data: { ...editor.data, enabled: e.target.value === 'true' } })}><option value="true">Enabled</option><option value="false">Disabled</option></select></Field>}</div><Field label="Description"><textarea rows="3" value={editor.data.description} onChange={(e) => setEditor({ ...editor, data: { ...editor.data, description: e.target.value } })} /></Field>{experience && <Field label="Internal prompt" hint="Never returned by customer APIs."><textarea className="admin-prompt" rows="10" required value={editor.data.internal_prompt} onChange={(e) => setEditor({ ...editor, data: { ...editor.data, internal_prompt: e.target.value } })} /></Field>}<Field label={experience ? 'Marketing preview' : 'Template image'}><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setEditor({ ...editor, file: e.target.files?.[0] || null })} /></Field><div className="admin-actions"><Button className="primary" type="submit">Save</Button><Button type="button" onClick={() => setEditor(null)}>Cancel</Button></div></form>}
    <div className="admin-content-grid">{visible.map((item) => <article className="admin-card admin-content-card" key={item.id}><div className="admin-content-preview">{experience ? !item.preview_missing ? <img src={`/api/admin/experiences/${encodeURIComponent(item.id)}/thumbnail?v=${encodeURIComponent(item.updated_at)}`} alt="" /> : <Empty>Preview missing</Empty> : <img src={`/api/templates/${encodeURIComponent(item.id)}/preview?v=${encodeURIComponent(item.updated_at)}`} alt="" />}</div><div><div className="admin-section-head"><div><h3>{item.name}</h3><code>{item.id}</code></div>{experience ? <Badge tone={item.status === 'published' ? 'ok' : item.status === 'disabled' ? 'warn' : ''}>{item.status}</Badge> : <Badge tone={item.enabled ? 'ok' : 'warn'}>{item.enabled ? 'enabled' : 'disabled'}</Badge>}</div><p className="admin-muted">{item.description || 'No description.'}</p>{experience && <><p className="admin-muted">{item.category} · {item.preview_status || (item.preview_missing ? 'MISSING' : 'READY')}</p><p className="admin-muted">{item.provider} · {item.model}</p></>}<div className="admin-actions">{experience && <Button disabled={item.preview_status === 'GENERATING'} onClick={async () => { try { await generateAdminExperiencePreview(item.id); setNotice(`Preview generation started for ${item.name}.`); load() } catch (e) { setError(errorMessage(e)) } }}>{item.preview_status === 'READY' ? 'Regenerate Preview' : 'Generate Preview'}</Button>}{experience && !item.preview_missing && <Button onClick={async () => { if (!confirmAction(`Delete the marketing preview for ${item.name}?`)) return; try { await deleteAdminExperienceThumbnail(item.id); setNotice('Preview removed.'); load() } catch (e) { setError(errorMessage(e)) } }}>Delete Preview</Button>}<Button onClick={() => setEditor({ isNew: false, data: { ...item }, file: null })}>Edit / Upload</Button>{experience ? <><Button onClick={() => changeStatus(item, 'published')} disabled={item.status === 'published'}>Publish</Button><Button onClick={() => changeStatus(item, 'draft')} disabled={item.status === 'draft'}>Move to Draft</Button><Button onClick={() => changeStatus(item, 'disabled')} disabled={item.status === 'disabled'}>Disable</Button></> : <Button onClick={async () => { try { await updateAdminTemplate(item.id, { enabled: !item.enabled }); load() } catch (e) { setError(errorMessage(e)) } }}>{item.enabled ? 'Disable' : 'Enable'}</Button>}<Button className="danger" onClick={() => remove(item)}>Delete</Button></div></div></article>)}</div>{!visible.length && !error && <Empty />}</section>
}

function ActorsPanel() { const [actors, setActors] = useState(null); const [form, setForm] = useState({ id: '', name: '', email: '', role: 'operator', is_active: true }); const [error, setError] = useState(''); const load = () => getAdminActors().then(setActors).catch((e) => setError(errorMessage(e))); useEffect(load, []); const save = async (e) => { e.preventDefault(); try { if (form.id && actors.some((a) => a.id === form.id)) await updateAdminUser(form.id, { name: form.name, email: form.email || null, role: form.role, is_active: form.is_active }); else await createAdminUser({ ...form, email: form.email || null }); setForm({ id: '', name: '', email: '', role: 'operator', is_active: true }); load() } catch (x) { setError(errorMessage(x)) } }; return <section><div className="admin-section-head"><div><h2>Admin Users</h2><p className="admin-muted">Role registry for future individual admin authentication. The configured token remains the current superadmin bootstrap.</p></div></div>{error && <div className="admin-error">{error}</div>}<form className="admin-card admin-inline-form" onSubmit={save}><Field label="ID"><input required value={form.id} disabled={actors?.some((a) => a.id === form.id)} onChange={(e) => setForm({ ...form, id: e.target.value })} /></Field><Field label="Name"><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field><Field label="Email"><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field><Field label="Role"><select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}><option value="operator">Operator</option><option value="content_manager">Content manager</option><option value="superadmin">Superadmin</option></select></Field><Button className="primary" type="submit">Save actor</Button></form>{actors ? <Table><thead><tr><th>Actor</th><th>Email</th><th>Role</th><th>Status</th><th /></tr></thead><tbody>{actors.map((actor) => <tr key={actor.id}><td>{actor.name}<br /><code>{actor.id}</code></td><td>{actor.email || '—'}</td><td>{actor.role}</td><td>{actor.is_active ? 'Active' : 'Disabled'}</td><td><Button onClick={() => setForm({ ...actor })}>Edit</Button></td></tr>)}</tbody></Table> : <Busy />}</section> }
function AuditPanel() { const [rows, setRows] = useState(null); useEffect(() => { getAdminAudit().then(setRows).catch(() => setRows([])) }, []); return <section><div className="admin-section-head"><div><h2>Audit Log</h2><p className="admin-muted">Immutable admin action history.</p></div></div>{rows ? <AuditRows entries={rows} /> : <Busy />}</section> }
function SettingsPanel() { const [data, setData] = useState(null); useEffect(() => { getAdminSettings().then(setData).catch(() => setData(null)) }, []); return <section><div className="admin-section-head"><div><h2>Settings</h2><p className="admin-muted">Read-only runtime configuration. Secrets are never displayed.</p></div></div>{data ? <div className="admin-card"><dl className="admin-dl"><dt>Environment</dt><dd>{data.environment}</dd><dt>AI provider</dt><dd>{data.ai_provider}</dd><dt>Google OIDC</dt><dd>{data.google_configured ? 'Configured' : 'Not configured'}</dd><dt>Upload limit</dt><dd>{Math.round(data.upload_max_bytes / 1024 / 1024)} MB</dd><dt>Dimensions</dt><dd>{data.upload_min_dimension}px — {data.upload_max_dimension}px</dd><dt>Default admin role</dt><dd>{data.admin_default_role}</dd></dl></div> : <Busy />}</section> }

export default function AdminPage() {
  const [token, setToken] = useState(''); const [unlocked, setUnlocked] = useState(false); const [section, setSection] = useState('overview'); const [error, setError] = useState(''); const [loading, setLoading] = useState(false)
  useEffect(() => { getAdminOverview().then(() => setUnlocked(true)).catch(() => setUnlocked(false)) }, [])
  const unlock = async (event) => { event.preventDefault(); setLoading(true); setError(''); try { await loginAdmin(token); setToken(''); setUnlocked(true) } catch (e) { setError(errorMessage(e, 'Admin authentication failed.')) } finally { setLoading(false) } }
  const lock = async () => { try { await logoutAdmin() } catch {} setUnlocked(false); setToken(''); setSection('overview') }
  if (!unlocked) return <div className="app admin-app"><main className="admin-gate admin-card"><p className="admin-eyebrow">Photobooth AI / Operations</p><h1>Admin access</h1><p className="admin-muted">Enter the configured admin token. It is held only in this page session.</p>{error && <div className="admin-error">{error}</div>}<form onSubmit={unlock}><Field label="Admin token"><input type="password" autoFocus required value={token} onChange={(e) => setToken(e.target.value)} /></Field><Button className="primary" disabled={loading} type="submit">{loading ? 'Checking…' : 'Unlock admin'}</Button></form></main></div>
  const content = { overview: <OverviewPanel onOpen={setSection} />, users: <UsersPanel />, credits: <CreditsPanel />, subscriptions: <><PlansPanel /><SubscriptionList /></>, generations: <GenerationsPanel />, experiences: <ContentPanel kind="experience" />, templates: <BasicTemplatePanel />, 'admin-users': <ActorsPanel />, audit: <AuditPanel />, settings: <SettingsPanel /> }[section]
  return <div className="app admin-app"><aside className="admin-sidebar"><div><p className="admin-eyebrow">Photobooth AI</p><h1>Operations</h1><p className="admin-muted">Control plane</p></div><nav aria-label="Admin sections">{SECTIONS.map(([id, label]) => <button key={id} className={section === id ? 'active' : ''} onClick={() => setSection(id)}>{label}</button>)}</nav><Button onClick={lock}>Lock session</Button></aside><main className="admin-shell"><header className="admin-topbar"><div><span className="admin-kicker">{SECTIONS.find(([id]) => id === section)?.[1]}</span><h2>{section === 'overview' ? 'Good morning, operator.' : SECTIONS.find(([id]) => id === section)?.[1]}</h2></div><span className="admin-session-status">Secure session</span></header>{content}</main></div>
}
