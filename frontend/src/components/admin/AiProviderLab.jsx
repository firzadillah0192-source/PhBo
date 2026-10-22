import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { labGet, labSend, labUpload, labImageUrl, labExportUrl, labReportUrl, ApiError } from '../../api.js'
import { COST_TONE, PRICING_METHODS, RATING_LABELS, SCENARIO_KINDS, allowedFrames, capabilities, cleanParams, diffLabel, idr, isTerminal, modelFits, nextInQueue, paramsFor, pricingPayload, quoteKey, scenarioPayload, splitList, tokenLabel, usd, whyNotFit } from '../../labModel.js'

const TABS = [['providers', 'Providers'], ['models', 'Models & Pricing'], ['playground', 'Image Playground'], ['compare', 'Comparison & Benchmarks'], ['history', 'Usage & Cost History']]
const msg = (e, fallback = 'Request failed') => (e instanceof ApiError || e?.message ? e.message : fallback)
const when = (v) => (v ? new Date(v).toLocaleString() : '—')
const ms = (v) => (v === null || v === undefined ? '—' : v < 1000 ? v + ' ms' : (v / 1000).toFixed(1) + ' s')
function Field({ label, hint, children }) { return <label className="admin-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label> }
function Notice({ error, notice }) { return <>{error && <div className="admin-error" role="alert">{error}</div>}{notice && <div className="admin-notice" role="status">{notice}</div>}</> }
function Status({ value }) {
  const tone = { SUCCEEDED: 'ok', ok: 'ok', FAILED: 'bad', failed: 'bad', failing: 'bad' }[value] || ''
  return <span className={`admin-badge ${tone}`}>{value}</span>
}

export default function AiProviderLab() {
  const [tab, setTab] = useState('providers')
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const load = useCallback(() => labGet('/overview').then((d) => { setData(d); setError('') }).catch((e) => setError(msg(e))), [])
  useEffect(() => { load() }, [load])
  const fx = data?.settings
  return <section className="lab">
    <div className="admin-section-head"><div><h2>AI Provider Lab</h2><p className="admin-muted">Isolated sandbox for registering, testing and comparing image providers. It never changes production routing, models or secrets.</p></div></div>
    <div className="admin-error lab-warning" role="note"><strong>Real charges apply.</strong> Sandbox generations call the provider's live API and are billed to the connected account. Every paid run needs your explicit confirmation.</div>
    {data && !data.encryption_ready && <div className="admin-error" role="alert">LAB_ENCRYPTION_KEY is not configured on the server, so provider credentials cannot be stored yet.</div>}
    <div className="admin-filter-row" role="tablist">{TABS.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}</div>
    <Notice error={error} />
    {!data ? !error && <div className="admin-loading">Loading Lab…</div> : <>
      {tab === 'providers' && <ProvidersTab data={data} reload={load} />}
      {tab === 'models' && <ModelsTab data={data} reload={load} />}
      {tab === 'playground' && <RunTab key="single" data={data} reload={load} multi={false} />}
      {tab === 'compare' && <CompareTab data={data} reload={load} />}
      {tab === 'history' && <HistoryTab data={data} fx={fx} />}
    </>}
  </section>
}

function ProvidersTab({ data, reload }) {
  const [form, setForm] = useState({ name: '', type: 'wavespeed', base_url: '' })
  const [secrets, setSecrets] = useState({})
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState('')
  const run = async (key, fn, done) => { setBusy(key); setError(''); setNotice(''); try { const r = await fn(); setNotice(typeof done === 'function' ? done(r) : done); await reload() } catch (e) { setError(msg(e)) } finally { setBusy('') } }
  const add = (e) => { e.preventDefault(); run('add', () => labSend('POST', '/providers', { name: form.name, type: form.type, ...(form.type !== '9router' && form.base_url ? { base_url: form.base_url } : {}) }), () => { setForm({ name: '', type: 'wavespeed', base_url: '' }); return 'Provider registered (disabled until a credential is added).' }) }
  return <div>
    <Notice error={error} notice={notice} />
    <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Provider</th><th>Credential</th><th>Status</th><th>Last success</th><th>Lab</th><th>Actions</th></tr></thead><tbody>
      {data.providers.length === 0 && <tr><td colSpan="6">No providers yet. Register WaveSpeedAI below.</td></tr>}
      {data.providers.map((p) => <tr key={p.id}>
        <td><strong>{p.name}</strong><br /><code>{p.type}</code> · <code>{p.base_url}</code>{!p.adapter_available && <><br /><span className="admin-muted">No safe adapter yet — registration only.</span></>}</td>
        <td>{p.credential.configured ? <code>{p.credential.masked}</code> : <span className="admin-muted">Not set</span>}<br />
          <input type="password" autoComplete="off" spellCheck="false" placeholder={p.credential.configured ? 'New key to rotate' : 'Paste API key'} aria-label={`API key for ${p.name}`} value={secrets[p.id] || ''} onChange={(e) => setSecrets({ ...secrets, [p.id]: e.target.value })} />
          <button disabled={!secrets[p.id] || busy === 'k' + p.id} onClick={() => run('k' + p.id, () => labSend('PUT', `/providers/${p.id}/credential`, { secret: secrets[p.id] }), 'Credential saved (encrypted). It cannot be viewed again.').then(() => setSecrets({ ...secrets, [p.id]: '' }))}>{p.credential.configured ? 'Rotate' : 'Save key'}</button>
          {p.credential.configured && <button onClick={() => window.confirm('Remove this credential? The provider will be disabled.') && run('r' + p.id, () => labSend('DELETE', `/providers/${p.id}/credential`), 'Credential removed.')}>Remove</button>}</td>
        <td><Status value={p.last_test_status} />{p.last_test_message && <><br /><small>{p.last_test_message}</small></>}</td>
        <td>{when(p.last_success_at)}</td>
        <td><label><input type="checkbox" checked={p.enabled} onChange={(e) => run('e' + p.id, () => labSend('PATCH', `/providers/${p.id}`, { enabled: e.target.checked }), e.target.checked ? 'Enabled for Lab only.' : 'Disabled.')} /> Lab enabled</label></td>
        <td>{p.type !== 'custom_rest' && <button disabled={busy === 's' + p.id} onClick={() => run('s' + p.id, () => labSend('POST', `/providers/${p.id}/seed-models`), (r) => `${r.created} models registered, ${r.updated.length} refreshed, ${r.skipped.length} already present${r.unavailable?.length ? `, ${r.unavailable.length} not available on this account (${r.unavailable.join(', ')})` : ''}. ${r.discovered ? 'Read from the provider model list. ' : ''}${r.note ? r.note + ' ' : ''}No image was generated and nothing was billed. Models without a published price show Pricing Unknown until you enter one.`)}>Register models</button>}<button disabled={!p.credential.configured || !p.adapter_available || busy === 't' + p.id} onClick={() => run('t' + p.id, () => labSend('POST', `/providers/${p.id}/test`), (r) => r.message)}>{busy === 't' + p.id ? 'Testing…' : 'Test connection'}</button>
          <button onClick={() => window.confirm(`Delete ${p.name} and its models? Test history is kept.`) && run('d' + p.id, () => labSend('DELETE', `/providers/${p.id}`), 'Provider deleted.')}>Delete</button></td>
      </tr>)}
    </tbody></table></div>
    <form className="admin-card" onSubmit={add}><h3>Register provider</h3><div className="admin-form-grid">
      <Field label="Display name"><input required minLength="2" maxLength="80" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
      <Field label="Provider type"><select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}><option value="wavespeed">WaveSpeedAI</option><option value="fal">fal.ai</option><option value="openai">OpenAI</option><option value="openai_compatible">OpenAI-compatible (any HTTPS host)</option><option value="recraft">Recraft</option><option value="runway">Runway</option><option value="9router">9Router (internal gateway)</option><option value="custom_rest">Custom REST (registration only)</option></select></Field>
      <Field label="API base URL" hint={form.type === '9router' ? 'Uses the gateway configured on this server automatically. Save a 9Router access key, then click Register models to load its image catalog. OpenAI keys and OAuth connections are managed in 9Router.' : 'Leave blank for the official endpoint (required for OpenAI-compatible; include /v1 if the vendor uses it). HTTPS only; validated server-side.'}><input disabled={form.type === '9router'} value={form.type === '9router' ? '' : form.base_url} placeholder={form.type === '9router' ? 'Server-configured 9Router gateway' : 'default'} onChange={(e) => setForm({ ...form, base_url: e.target.value })} /></Field>
    </div><button className="primary" disabled={busy === 'add'}>Register</button></form>
  </div>
}

const blankModel = { id: '', provider_id: '', model_id: '', display_name: '', tasks: ['image-to-image'], sizes: '', max_reference_images: 2, negative_prompt: false, seed: false, size: false, quality: '', output_format: '',
  method: 'unknown', per_image_usd: '', per_megapixel_usd: '', input_usd_per_million_tokens: '', output_usd_per_million_tokens: '', per_second_usd: '', reference_image_fee_usd: '', assumed_input_tokens: '', assumed_output_tokens: '', assumed_seconds: '', source: '', verified_at: '', assumptions: '', enabled: true }
function toForm(m) { return { ...blankModel, ...m.pricing, id: m.id, provider_id: m.provider_id, model_id: m.model_id, display_name: m.display_name, tasks: m.tasks, sizes: m.sizes.join(', '), max_reference_images: m.max_reference_images,
  negative_prompt: m.supports.negative_prompt, seed: m.supports.seed, size: m.supports.size, quality: m.supports.quality.join(', '), output_format: m.supports.output_format.join(', '), verified_at: m.pricing.verified_at ? m.pricing.verified_at.slice(0, 10) : '', enabled: m.enabled } }
const PRICE_FIELDS = { per_image: [['per_image_usd', 'USD per image']], per_megapixel: [['per_megapixel_usd', 'USD per megapixel']], tokens: [['input_usd_per_million_tokens', 'USD / 1M input tokens'], ['output_usd_per_million_tokens', 'USD / 1M output tokens'], ['assumed_input_tokens', 'Assumed input tokens'], ['assumed_output_tokens', 'Assumed output tokens']], compute_time: [['per_second_usd', 'USD per second'], ['assumed_seconds', 'Assumed seconds']], unknown: [] }

function ModelsTab({ data, reload }) {
  const [form, setForm] = useState(null); const [error, setError] = useState(''); const [notice, setNotice] = useState('')
  const providerName = (id) => data.providers.find((p) => p.id === id)?.name || id
  const set = (patch) => setForm({ ...form, ...patch })
  const save = async (e) => {
    e.preventDefault(); setError(''); setNotice('')
    const body = { provider_id: form.provider_id, model_id: form.model_id, display_name: form.display_name, tasks: form.tasks, sizes: splitList(form.sizes), max_reference_images: Number(form.max_reference_images) || 0, enabled: form.enabled,
      supports: { negative_prompt: form.negative_prompt, seed: form.seed, size: form.size, quality: splitList(form.quality), output_format: splitList(form.output_format) }, pricing: pricingPayload(form) }
    try { await (form.id ? labSend('PATCH', `/models/${form.id}`, body) : labSend('POST', '/models', body)); setForm(null); setNotice('Model saved.'); reload() } catch (err) { setError(msg(err)) }
  }
  const quickWave = () => { const p = data.providers.find((x) => x.type === 'wavespeed'); setForm({ ...blankModel, provider_id: p?.id || '', model_id: 'wavespeed-ai/qwen-image/edit-plus', display_name: 'Qwen Image Edit Plus', tasks: ['image-to-image', 'multi-reference-edit'], max_reference_images: 3, seed: true, size: true, output_format: 'jpeg, png, webp' }) }
  return <div>
    <SettingsCard settings={data.settings} reload={reload} />
    <TestQueue data={data} reload={reload} />
    <Notice error={error} notice={notice} />
    <div className="admin-section-head"><h3>Models</h3><div><button className="primary" onClick={() => setForm({ ...blankModel, provider_id: data.providers[0]?.id || '' })}>Add model</button></div></div>
    <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Model</th><th>Tasks</th><th>Pricing</th><th>Status</th><th /></tr></thead><tbody>
      {data.models.length === 0 && <tr><td colSpan="5">No models registered.</td></tr>}
      {data.models.map((m) => <tr key={m.id}><td><strong>{m.display_name}</strong><br /><code>{m.model_id}</code><br />{providerName(m.provider_id)}</td><td>{m.tasks.join(', ')}<br /><small>up to {m.max_reference_images} input images</small></td>
        <td>{m.pricing.method === 'unknown' ? <strong>Pricing Unknown</strong> : <>{PRICING_METHODS.find(([k]) => k === m.pricing.method)?.[1]}</>}{m.params && <><br /><small>{m.params.map((x) => x.name).join(', ')}</small></>}<br /><small>{m.pricing.source || 'no source'} · verified {m.pricing.verified_at ? new Date(m.pricing.verified_at).toLocaleDateString() : 'never'}</small></td>
        <td><Status value={m.status} /> {m.sequence ? <span className="admin-badge">#{m.sequence}</span> : null} <span className={`admin-badge ${m.verification?.status === 'verified' ? 'ok' : m.verification?.status === 'blocked' ? 'bad' : ''}`}>{m.verification?.status || 'unverified'}</span> {!m.enabled && <span className="admin-badge">disabled</span>}</td>
        <td><button onClick={() => setForm(toForm(m))}>Edit</button><button onClick={() => window.confirm(`Delete ${m.display_name}?`) && labSend('DELETE', `/models/${m.id}`).then(reload).catch((e) => setError(msg(e)))}>Delete</button></td></tr>)}
    </tbody></table></div>
    {form && <form className="admin-card" onSubmit={save}><h3>{form.id ? 'Edit' : 'Add'} model</h3><div className="admin-form-grid">
      <Field label="Provider"><select required value={form.provider_id} onChange={(e) => set({ provider_id: e.target.value })}><option value="">Select…</option>{data.providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      <Field label="Model ID"><input required value={form.model_id} onChange={(e) => set({ model_id: e.target.value })} /></Field>
      <Field label="Display name"><input required value={form.display_name} onChange={(e) => set({ display_name: e.target.value })} /></Field>
      <Field label="Max input images (template + references)"><input type="number" min="0" max="16" value={form.max_reference_images} onChange={(e) => set({ max_reference_images: e.target.value })} /></Field>
      <Field label="Sizes / aspect ratios" hint="Comma separated, e.g. 1024*1024, 1536*1024"><input value={form.sizes} onChange={(e) => set({ sizes: e.target.value })} /></Field>
      <Field label="Quality options"><input value={form.quality} onChange={(e) => set({ quality: e.target.value })} placeholder="e.g. low, medium, high" /></Field>
      <Field label="Output formats"><input value={form.output_format} onChange={(e) => set({ output_format: e.target.value })} placeholder="jpeg, png, webp" /></Field>
    </div>
    <fieldset><legend>Tasks</legend>{['text-to-image', 'image-to-image', 'multi-reference-edit'].map((t) => <label key={t}><input type="checkbox" checked={form.tasks.includes(t)} onChange={(e) => set({ tasks: e.target.checked ? [...form.tasks, t] : form.tasks.filter((x) => x !== t) })} /> {t} </label>)}</fieldset>
    <fieldset><legend>Supported parameters</legend>{[['size', 'Size'], ['seed', 'Seed'], ['negative_prompt', 'Negative prompt']].map(([k, l]) => <label key={k}><input type="checkbox" checked={form[k]} onChange={(e) => set({ [k]: e.target.checked })} /> {l} </label>)}</fieldset>
    <h4>Pricing</h4><p className="admin-muted">Enter only prices you have verified from the provider. Leave on "Pricing Unknown" otherwise; nothing is assumed.</p>
    <div className="admin-form-grid"><Field label="Method"><select value={form.method} onChange={(e) => set({ method: e.target.value })}>{PRICING_METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      {(PRICE_FIELDS[form.method] || []).map(([k, l]) => <Field key={k} label={l}><input type="number" min="0" step="any" value={form[k]} onChange={(e) => set({ [k]: e.target.value })} /></Field>)}
      {form.method !== 'unknown' && <Field label="Extra fee per reference image (USD)"><input type="number" min="0" step="any" value={form.reference_image_fee_usd} onChange={(e) => set({ reference_image_fee_usd: e.target.value })} /></Field>}
      <Field label="Price source (URL or note)"><input value={form.source} onChange={(e) => set({ source: e.target.value })} /></Field>
      <Field label="Last verified"><input type="date" value={form.verified_at} onChange={(e) => set({ verified_at: e.target.value })} /></Field>
      <Field label="Calculation assumptions"><input value={form.assumptions} onChange={(e) => set({ assumptions: e.target.value })} /></Field></div>
    <label><input type="checkbox" checked={form.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> Enabled in Lab</label>
    <div><button className="primary">Save model</button> <button type="button" onClick={() => setForm(null)}>Cancel</button></div></form>}
  </div>
}

// One-by-one benchmarking: a model is tested only after the previous one is verified (confirmed billing) or blocked.
function TestQueue({ data, reload }) {
  const [runs, setRuns] = useState([]); const [error, setError] = useState(''); const [notice, setNotice] = useState('')
  useEffect(() => { labGet('/runs').then(setRuns).catch((e) => setError(msg(e))) }, [data.models])
  const queue = data.models.filter((m) => typeof m.sequence === 'number').sort((a, b) => a.sequence - b.sequence), next = nextInQueue(data.models)
  if (!queue.length) return null
  const verify = async (m, status, run_id) => {
    let note = ''
    if (status === 'blocked') { note = window.prompt(`Why is ${m.display_name} blocked?`, ''); if (!note) return }
    try { await labSend('POST', `/models/${m.id}/verification`, { status, ...(run_id ? { run_id } : {}), note }); setNotice(`${m.display_name}: ${status}.`); setError(''); reload() } catch (e) { setError(msg(e)) }
  }
  return <div className="admin-card"><h3>One-by-one test queue</h3><p className="admin-muted">Test each model once, reconcile its provider billing record, then mark it verified (or blocked if it cannot be tested). The next model unlocks only after that. A blocked model never stops registrations or other models.</p>
    <Notice error={error} notice={notice} />
    <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>#</th><th>Model</th><th>State</th><th>Last run</th><th>Quote vs billed</th><th /></tr></thead><tbody>
      {queue.map((m) => { const mine = runs.filter((r) => r.model_ref === m.id), last = mine[0], confirmed = mine.find((r) => r.status === 'SUCCEEDED' && ['confirmed', 'adjusted'].includes(r.billing?.status)), state = m.verification?.status || 'unverified'
        return <tr key={m.id}><td>{m.sequence}</td><td><strong>{m.display_name}</strong><br /><code>{m.model_id}</code></td>
          <td><span className={`admin-badge ${state === 'verified' ? 'ok' : state === 'blocked' ? 'bad' : ''}`}>{state}</span>{next?.id === m.id && <span className="admin-badge warn"> next to test</span>}{m.verification?.note && <><br /><small>{m.verification.note}</small></>}</td>
          <td>{last ? <><Status value={last.status} /> <span className={`admin-badge ${COST_TONE[last.cost_status] || ''}`}>{last.cost_status}</span><br /><small>{when(last.created_at)}</small></> : '—'}</td>
          <td>{confirmed ? <>{usd(confirmed.quote?.discounted_usd)} → {usd(confirmed.billing.confirmed_usd)} <small>({diffLabel(confirmed.cost_difference_usd)})</small></> : '—'}</td>
          <td><button disabled={!confirmed || state === 'verified'} title={confirmed ? '' : 'Needs a successful run with a confirmed billing record'} onClick={() => verify(m, 'verified', confirmed.id)}>Mark verified</button><button disabled={state === 'blocked'} onClick={() => verify(m, 'blocked')}>Mark blocked</button>{state !== 'unverified' && <button onClick={() => verify(m, 'unverified')}>Reset</button>}</td></tr> })}
    </tbody></table></div></div>
}

function ReportCard() {
  const [threshold, setThreshold] = useState(4); const [report, setReport] = useState(null); const [error, setError] = useState('')
  useEffect(() => { labGet(`/report?threshold=${threshold}`).then(setReport).catch((e) => setError(msg(e))) }, [threshold])
  return <div className="admin-card"><div className="admin-section-head"><h3>Model benchmark report</h3><div><Field label="Accepted when overall rating ≥"><select value={threshold} onChange={(e) => setThreshold(Number(e.target.value))}>{[3, 4, 5].map((n) => <option key={n}>{n}</option>)}</select></Field> <a className="button" href={labReportUrl(`?threshold=${threshold}`)}>Export report (CSV)</a></div></div>
    <Notice error={error} />{report && <p className="admin-muted">{report.note}</p>}
    <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Model · task</th><th>Verified</th><th>Runs OK / failed</th><th>Estimated</th><th>Confirmed (billing)</th><th>Δ</th><th>Tokens</th><th>Latency</th><th>Rating</th><th>Cost / accepted</th></tr></thead><tbody>
      {!report || report.rows.length === 0 ? <tr><td colSpan="10">No benchmark data yet.</td></tr> : report.rows.map((r) => <tr key={r.model_ref}>
        <td><strong>{r.model}</strong><br /><small>{r.task}</small></td><td>{r.verification}</td><td>{r.succeeded} / {r.failed}</td><td>{usd(r.avg_estimated_usd)}</td>
        <td>{r.avg_confirmed_usd === null ? (r.pending_billing ? 'Pending billing' : '—') : <>{usd(r.avg_confirmed_usd)} <small>({r.confirmed_runs} confirmed)</small></>}</td><td>{diffLabel(r.avg_cost_difference_usd)}</td>
        <td>{r.tokens.total === null ? 'N/A' : r.tokens.total.toLocaleString()}</td><td>{ms(r.avg_latency_ms)}</td><td>{r.avg_overall_rating === null ? '—' : `${r.avg_overall_rating} (${r.rated} rated)`}</td>
        <td>{r.cost_per_accepted_usd === null ? 'n/a' : usd(r.cost_per_accepted_usd)} <small>({r.accepted} accepted)</small></td></tr>)}
    </tbody></table></div></div>
}

function SettingsCard({ settings, reload }) {
  const [f, setF] = useState(null); const [error, setError] = useState(''); const [notice, setNotice] = useState('')
  const v = f || { ...settings, fx_date: settings.fx_date ? settings.fx_date.slice(0, 10) : '' }
  const save = async (e) => { e.preventDefault(); setError(''); setNotice('')
    try { await labSend('PUT', '/settings', { fx_usd_to_idr: v.fx_usd_to_idr === '' || v.fx_usd_to_idr === null ? null : Number(v.fx_usd_to_idr), fx_source: v.fx_source || '', fx_date: v.fx_date ? new Date(v.fx_date).toISOString() : null,
      per_request_usd: Number(v.per_request_usd), daily_usd: Number(v.daily_usd), monthly_usd: Number(v.monthly_usd), max_unpriced_runs_per_day: Number(v.max_unpriced_runs_per_day), retention_days: Number(v.retention_days),
      max_active_runs: Number(v.max_active_runs), max_runs_per_request: Number(v.max_runs_per_request), enforce_sequence: Boolean(v.enforce_sequence) }); setF(null); setNotice('Settings saved.'); reload() } catch (err) { setError(msg(err)) } }
  const set = (patch) => setF({ ...v, ...patch })
  return <form className="admin-card" onSubmit={save}><h3>Budget safeguards, exchange rate &amp; retention</h3>
    <p className="admin-muted">Automatic retries are always off because retries can bill again. Conservative defaults apply until you change them.{settings.fx_stale && <strong> Exchange rate is {settings.fx_usd_to_idr === null ? 'not set' : 'stale'}; IDR figures are hidden or flagged.</strong>}</p>
    <Notice error={error} notice={notice} />
    <div className="admin-form-grid">
      <Field label="USD → IDR rate"><input type="number" min="1" step="any" value={v.fx_usd_to_idr ?? ''} onChange={(e) => set({ fx_usd_to_idr: e.target.value })} /></Field>
      <Field label="Rate source"><input value={v.fx_source} onChange={(e) => set({ fx_source: e.target.value })} /></Field>
      <Field label="Rate date"><input type="date" value={v.fx_date} onChange={(e) => set({ fx_date: e.target.value })} /></Field>
      <Field label="Per-request ceiling (USD)"><input type="number" min="0" step="any" value={v.per_request_usd} onChange={(e) => set({ per_request_usd: e.target.value })} /></Field>
      <Field label="Daily Lab limit (USD)"><input type="number" min="0" step="any" value={v.daily_usd} onChange={(e) => set({ daily_usd: e.target.value })} /></Field>
      <Field label="Monthly Lab limit (USD)"><input type="number" min="0" step="any" value={v.monthly_usd} onChange={(e) => set({ monthly_usd: e.target.value })} /></Field>
      <Field label="Max unpriced runs / day"><input type="number" min="0" value={v.max_unpriced_runs_per_day} onChange={(e) => set({ max_unpriced_runs_per_day: e.target.value })} /></Field>
      <Field label="Active paid generations at once" hint="Initial testing: 1"><input type="number" min="1" max="6" value={v.max_active_runs} onChange={(e) => set({ max_active_runs: e.target.value })} /></Field>
      <Field label="Runs per request" hint="1 = no batch / comparison"><input type="number" min="1" max="6" value={v.max_runs_per_request} onChange={(e) => set({ max_runs_per_request: e.target.value })} /></Field>
      <label className="admin-field"><span>One-by-one order</span><span><input type="checkbox" checked={Boolean(v.enforce_sequence)} onChange={(e) => set({ enforce_sequence: e.target.checked })} /> Require the previous model to be verified or blocked</span></label>
      <Field label="Keep images (days)"><input type="number" min="1" max="90" value={v.retention_days} onChange={(e) => set({ retention_days: e.target.value })} /></Field>
    </div><button className="primary">Save settings</button></form>
}

// Shared by Image Playground (one model) and Comparison (several models, identical inputs).
// Flow: Get price quote (non-billable) -> review -> explicit confirmation -> exactly one submission per model.
function RunTab({ data, reload, multi, onSession }) {
  const allUsable = data.models.filter((m) => m.enabled && data.providers.find((p) => p.id === m.provider_id && p.enabled && p.credential.configured))
  const [selected, setSelected] = useState([]); const [files, setFiles] = useState({ template: null, reference: null, extra: [] })
  const [form, setForm] = useState({ prompt: '', negative_prompt: '' }); const [values, setValues] = useState({})
  const [quote, setQuote] = useState(null); const [quoting, setQuoting] = useState(false); const [confirming, setConfirming] = useState(false); const [override, setOverride] = useState('')
  const [kind, setKind] = useState('freeform'); const [catalog, setCatalog] = useState(null); const [face, setFace] = useState(null); const [variant, setVariant] = useState('all')
  const [sel, setSel] = useState({ template_id: '', experience_id: '', frame_style_id: '' });
  const [ack, setAck] = useState(false); const [runs, setRuns] = useState([]); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  useEffect(() => { if (kind !== 'freeform' && !catalog) labGet('/scenarios').then(setCatalog).catch((e) => setError(msg(e))) }, [kind])
  const scenarioMode = kind !== 'freeform'
  const models = selected.map((id) => allUsable.find((m) => m.id === id)).filter(Boolean)
  const lead = models[0], caps = capabilities(lead), specs = paramsFor(lead)
  const settings = data.settings
  const inputKey = quoteKey({ selected, kind, sel, prompt: form.prompt, neg: form.negative_prompt, values, face: face && [face.name, face.size, face.lastModified],
    files: [files.template, files.reference, ...files.extra].map((f) => f && [f.name, f.size, f.lastModified]) })
  const fresh = quote && quote.key === inputKey
  const touch = () => { setConfirming(false); setError('') }
  const setValue = (name, v) => { setValues({ ...values, [name]: v }); touch() }
  const payloadFor = (m) => ({ model_ref: m.id, ...(scenarioMode ? { scenario: scenarioPayload(kind, sel) } : { prompt: form.prompt, ...(capabilities(m).negative && form.negative_prompt ? { negative_prompt: form.negative_prompt } : {}) }), params: cleanParams(m, values) })
  const upload = scenarioMode ? { face: [face] } : { template: files.template ? [files.template] : [], reference: files.reference ? [files.reference] : [], extra: files.extra }
  const getQuote = async () => {
    setQuoting(true); setError(''); setConfirming(false)
    try { const rows = []; for (const m of models) rows.push({ model: m, q: await labUpload('/quote', payloadFor(m), upload) }); setQuote({ key: inputKey, rows }) }
    catch (e) { setQuote(null); setError(msg(e)) } finally { setQuoting(false) }
  }
  const rows = fresh ? quote.rows : []
  const allAvailable = rows.length > 0 && rows.every((r) => r.q.available)
  const unavailable = rows.some((r) => r.q.unavailable)
  const unknownLegacy = rows.length > 0 && !unavailable && rows.some((r) => !r.q.available)
  const blockedReason = rows.map((r) => r.q.blocked_reason).find(Boolean)
  const total = allAvailable ? Math.round(rows.reduce((s, r) => s + r.q.usd, 0) * 1e6) / 1e6 : null
  const fx = rows[0]?.q.fx; const totalIdr = total !== null && fx?.rate ? total * fx.rate : null
  const problems = []
  if (!models.length) problems.push(multi ? 'Pick at least two models.' : 'Select a model.')
  if (multi && models.length < 2) problems.push('Comparison needs at least two models.')
  if (multi && settings.max_runs_per_request < 2) problems.push('Batch generation is off. Raise "Runs per request" in Models & Pricing → Budget safeguards to compare models.')
  if (!scenarioMode && !form.prompt.trim()) problems.push('Enter a prompt.')
  if (!scenarioMode && models.some((m) => m.max_reference_images > 0 && !m.tasks.includes('text-to-image')) && !files.template) problems.push('Upload at least a template image.')
  if (scenarioMode && !face) problems.push('Upload a customer face photo.')
  if (kind === 'basic' && !sel.template_id) problems.push('Choose a Basic template.')
  if (kind === 'advanced' && (!sel.experience_id || !sel.frame_style_id)) problems.push('Choose an experience and a frame style.')
  if (scenarioMode && models.some((m) => !modelFits(m, kind))) problems.push('A selected model cannot run this scenario.')
  const submit = async () => {
    setBusy(true); setError('')
    try {
      const extra = { confirm: true, ...(override.trim() ? { override_reason: override.trim() } : {}), ...(unknownLegacy ? { acknowledge_unknown_cost: true } : {}) }
      if (multi) { const { model_ref: _m, ...base } = payloadFor(models[0]); const session = await labUpload('/compare', { ...base, ...extra, model_refs: selected, confirmed_total_usd: total }, upload); onSession(session.id) }
      else { const run = await labUpload('/runs', { ...payloadFor(models[0]), ...extra, confirmed_estimate_usd: total }, upload); setRuns([run, ...runs]) }
      setConfirming(false); setQuote(null); reload()
    } catch (e) { setError(msg(e)); setQuote(null); setConfirming(false) } finally { setBusy(false) }
  }
  const nameOf = (id) => data.providers.find((p) => p.id === id)?.name
  const fits = (m) => modelFits(m, kind)
  return <div>
    <div className="admin-card"><h3>{multi ? 'Run one test case on several models' : 'Generate a test image'}</h3><Notice error={error} />
      <Field label="Test type" hint="Basic and Advanced reproduce the real customer request: the same server-owned prompt and image preparation as production."><select value={kind} onChange={(e) => { setKind(e.target.value); touch(); setSelected([]); setQuote(null) }}>{SCENARIO_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      {scenarioMode && <p className="admin-muted">Pick the template (or experience), upload the customer face, then pick a model. Only image-editing models can take a photo; text-to-image models (Z-Image Turbo, Seedream 5.0 Flash/Pro, Qwen Image 3.0, GPT Image text-to-image, Nano Banana text-to-image) are for prompt-only tests and are greyed out here.</p>}
      {scenarioMode && <ScenarioPicker kind={kind} catalog={catalog} sel={sel} setSel={(v) => { setSel(v); touch() }} variant={variant} setVariant={setVariant} setFace={(f) => { setFace(f); touch() }} />}
      <div className="admin-form-grid">
        {multi ? <fieldset><legend>Models (same prompt, same images)</legend>{allUsable.map((m) => <label key={m.id}><input type="checkbox" disabled={!fits(m)} checked={selected.includes(m.id)} onChange={(e) => { setSelected(e.target.checked ? [...selected, m.id].slice(0, 6) : selected.filter((x) => x !== m.id)); touch() }} /> {m.display_name} <small>({nameOf(m.provider_id)})</small> </label>)}</fieldset>
          : <Field label="Provider · model"><select value={selected[0] || ''} onChange={(e) => { setSelected(e.target.value ? [e.target.value] : []); setValues({}); touch() }}><option value="">Select…</option>{[['Text-to-image (prompt only)', (m) => m.tasks.includes('text-to-image')], ['Image editing (template / face photo)', (m) => !m.tasks.includes('text-to-image')]].map(([label, test]) => <optgroup key={label} label={label}>{allUsable.filter(test).map((m) => <option key={m.id} value={m.id} disabled={!fits(m)}>{nameOf(m.provider_id)} · {m.display_name}{m.sequence ? ` (#${m.sequence})` : ''}{fits(m) ? '' : ` (${whyNotFit(m, kind)})`}</option>)}</optgroup>)}</select></Field>}
        {allUsable.length === 0 && <p className="admin-muted">No usable models. Enable a provider with a credential and register models first.</p>}
        {!scenarioMode && <><Field label="Primary template image" hint={caps.images ? '' : 'This model takes no input images'}><input type="file" accept="image/jpeg,image/png,image/webp" disabled={!caps.images} onChange={(e) => { setFiles({ ...files, template: e.target.files[0] || null }); touch() }} /></Field>
          <Field label="User / reference image"><input type="file" accept="image/jpeg,image/png,image/webp" disabled={caps.images < 2} onChange={(e) => { setFiles({ ...files, reference: e.target.files[0] || null }); touch() }} /></Field>
          <Field label="Additional references" hint={caps.images > 2 ? `Up to ${caps.images - 2} more` : 'Not supported by this model'}><input type="file" multiple accept="image/jpeg,image/png,image/webp" disabled={caps.images < 3} onChange={(e) => { setFiles({ ...files, extra: [...e.target.files].slice(0, Math.max(0, caps.images - 2)) }); touch() }} /></Field></>}
      </div>
      {lead?.notes && <p className="admin-muted">{lead.notes}</p>}
      {!scenarioMode && <><Field label="Positive prompt" hint={lead?.prompt_max ? `Max ${lead.prompt_max} characters (${form.prompt.length})` : ''}><textarea rows="4" maxLength={lead?.prompt_max || 4000} value={form.prompt} onChange={(e) => { setForm({ ...form, prompt: e.target.value }); touch() }} /></Field>
        {caps.negative && <Field label="Negative prompt"><input value={form.negative_prompt} onChange={(e) => { setForm({ ...form, negative_prompt: e.target.value }); touch() }} /></Field>}</>}
      {lead && <fieldset className="lab-params"><legend>Model parameters{lead.schema_verified_at ? ` — schema verified ${new Date(lead.schema_verified_at).toLocaleDateString()}` : ''}</legend>
        <div className="admin-form-grid">{specs.length === 0 && <p className="admin-muted">This model has no adjustable parameters.</p>}
          {specs.map((s) => <Field key={s.name} label={s.label + (s.billing_relevant ? ' · affects price' : '')} hint={scenarioMode && s.name === 'size' ? 'Empty = production canvas (keeps the template ratio)' : s.note || (s.default !== undefined ? `Provider default: ${String(s.default)}` : 'Empty = provider default')}>
            {s.type === 'enum' ? <select value={values[s.name] ?? ''} onChange={(e) => setValue(s.name, e.target.value)}><option value="">Provider default</option>{(s.values || []).map((v) => <option key={v}>{v}</option>)}</select>
              : s.type === 'bool' ? <select value={values[s.name] === true ? 'true' : (values[s.name] ?? '')} onChange={(e) => setValue(s.name, e.target.value)}><option value="">Provider default ({s.default === true ? 'on' : 'off'})</option><option value="true">On</option><option value="false">Off</option></select>
              : <input type={s.type === 'int' ? 'number' : 'text'} step={s.type === 'int' ? 1 : undefined} min={s.min} max={s.max} placeholder={s.pattern ? 'e.g. 1024*1024' : ''} value={values[s.name] ?? ''} onChange={(e) => setValue(s.name, e.target.value)} />}</Field>)}</div></fieldset>}
      <div className="lab-quote-actions"><button disabled={problems.length > 0 || quoting} onClick={getQuote}>{quoting ? 'Asking the provider…' : fresh ? 'Refresh price quote' : 'Get price quote'}</button> <small className="admin-muted">Non-billable. Recalculated whenever a price-relevant input changes.</small></div>
      {quote && !fresh && <div className="admin-notice" role="status">Inputs changed since the last quote — get a new quote before generating.</div>}
      {fresh && rows.map(({ model, q }) => <QuoteCard key={model.id} model={model} q={q} />)}
      {problems.length > 0 && <ul className="admin-muted">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
      {blockedReason && <div className="admin-error" role="alert">{blockedReason}</div>}
      {!confirming ? <button className="primary" disabled={problems.length > 0 || !fresh || blockedReason || unavailable || (!allAvailable && !unknownLegacy)} onClick={() => setConfirming(true)}>{multi ? 'Review & generate on all models' : 'Review & generate'}</button>
        : <div className="admin-card lab-confirm" role="alertdialog" aria-label="Confirm paid generation"><h4>Confirm paid generation</h4>
          <p>{allAvailable ? <>You are about to be charged an expected <strong>{usd(total)}</strong>{totalIdr !== null && <> (≈ {idr(totalIdr)})</>} for {multi ? `${rows.length} models` : '1 image'}, as quoted by the provider.</> : <><strong>Pricing is unknown</strong> for at least one selected model; the cost cannot be estimated and will be billed by the provider.</>} The request is submitted exactly once and is never retried automatically. If the connection drops mid-request it may still be billed — it will be flagged for reconciliation.</p>
          {unknownLegacy && <label><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I understand the cost is unknown.</label>}
          <Field label="Budget override reason (only if a limit is exceeded)"><input value={override} onChange={(e) => setOverride(e.target.value)} placeholder="Leave empty normally. Audited when used." /></Field>
          <button className="primary" disabled={busy || (unknownLegacy && !ack)} onClick={submit}>{busy ? 'Submitting…' : `Confirm and pay ${total !== null ? usd(total) : ''}`}</button> <button onClick={() => setConfirming(false)}>Cancel</button></div>}
    </div>
    {!multi && runs.map((r) => <RunViewer key={r.id} initial={r} onChange={reload} fx={settings} />)}
  </div>
}

function QuoteCard({ model, q }) {
  const ok = q.available, quote = q.quote
  return <div className="admin-card lab-estimate" aria-live="polite"><h4>{model.display_name} <span className={`admin-badge ${ok ? '' : 'bad'}`}>{ok ? (quote.source === 'provider' ? 'Estimated · provider quote' : 'Estimated · configured price') : q.unavailable ? 'Pricing Unavailable' : 'Pricing Unknown'}</span></h4>
    {!ok && <p className="admin-error">{q.reason || 'No reliable price could be obtained.'}{q.unavailable && ' No base price is substituted and generation is blocked.'}</p>}
    {ok && <dl className="admin-dl"><dt>Original price</dt><dd>{usd(quote.original_usd)}</dd><dt>Discounted (payable)</dt><dd><strong>{usd(quote.discounted_usd)}</strong> {quote.currency}</dd>
      <dt>Effective discount</dt><dd>{quote.effective_discount_percent === null ? '—' : quote.effective_discount_percent + '%'}</dd>
      <dt>Estimated in IDR</dt><dd>{q.idr === null ? 'Set the exchange rate in Models & Pricing' : <>{idr(q.idr)}{q.fx.stale && ' (stale rate)'}</>}</dd>
      <dt>Quoted at</dt><dd>{when(quote.quoted_at)}</dd>
      {q.comparison_to_base && <><dt>Published base price</dt><dd>{usd(q.comparison_to_base.base_discounted_usd)} {q.comparison_to_base.equal ? '(equal to this quote)' : `(this quote differs by ${diffLabel(q.comparison_to_base.difference_usd)})`}</dd></>}
      <dt>Parameters sent</dt><dd><code>{JSON.stringify(q.params_sent)}</code>{q.ignored.length > 0 && <small> · not supported, dropped: {q.ignored.join(', ')}</small>}</dd>
      <dt>Input images</dt><dd>{q.images}</dd>{q.adapted?.length > 0 && <><dt>Prompt adjusted for this model</dt><dd>{q.adapted.join('; ')}</dd></>}</dl>}
    {ok && <p className="admin-muted">Today {usd(q.budget.spent.today_usd)} of {usd(q.budget.limits.daily_usd)} · per-test ceiling {usd(q.budget.limits.per_request_usd)}{!q.within_limits.per_request && <strong> · over the per-test ceiling</strong>}{!q.within_limits.daily && <strong> · would exceed the daily limit</strong>}</p>}
  </div>
}

function ScenarioPicker({ kind, catalog, sel, setSel, variant, setVariant, setFace }) {
  if (!catalog) return <div className="admin-loading">Loading NXBooth catalog…</div>
  const templates = catalog.basic.filter((t) => variant === 'all' || t.variant === variant)
  const frames = allowedFrames(catalog, sel.experience_id)
  return <div className="admin-card lab-scenario"><h4>{kind === 'basic' ? 'Basic: template + customer face' : 'Advanced: experience + frame style + customer face'}</h4>
    <p className="admin-muted">Prompt, template preparation, canvas size and finishing follow the production flow. The prompt is server-owned and not editable here. Ornaments are camera effects and never reach the provider.</p>
    <div className="admin-form-grid">
      {kind === 'basic' ? <>
        <Field label="Variant"><select value={variant} onChange={(e) => setVariant(e.target.value)}><option value="all">All</option><option value="man">Man</option><option value="woman">Woman</option><option value="hijab">Hijab woman</option></select></Field>
        <Field label="Template (theme)"><select value={sel.template_id} onChange={(e) => setSel({ ...sel, template_id: e.target.value })}><option value="">Select…</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name} · {t.variant}{t.width ? ` · ${t.width}×${t.height}` : ''}</option>)}</select></Field></> : <>
        <Field label="Experience"><select value={sel.experience_id} onChange={(e) => setSel({ ...sel, experience_id: e.target.value, frame_style_id: '' })}><option value="">Select…</option>{catalog.advanced.experiences.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.category})</option>)}</select></Field>
        <Field label="Frame style"><select value={sel.frame_style_id} onChange={(e) => setSel({ ...sel, frame_style_id: e.target.value })}><option value="">Select…</option>{frames.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></Field></>}
      <Field label="Customer face photo" hint="Use a consented or synthetic test photo. It is stored privately and expires with the run."><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFace(e.target.files[0] || null)} /></Field>
    </div></div>
}

function CostPanel({ run, onRun }) {
  const [busy, setBusy] = useState(''); const [error, setError] = useState(''); const [form, setForm] = useState({ outcome: 'not_billed', actual: '', reason: '' })
  const act = async (key, path, body) => { setBusy(key); setError(''); try { onRun(await labSend('POST', `/runs/${run.id}/${path}`, body)) } catch (e) { setError(msg(e)) } finally { setBusy('') } }
  const q = run.quote, b = run.billing, status = run.cost_status || 'Estimated'
  return <div className="lab-cost"><div className="admin-section-head"><h4>Cost <span className={`admin-badge ${COST_TONE[status] || ''}`}>{status}</span></h4></div><Notice error={error} />
    <dl className="admin-dl">
      <dt>Estimated (provider quote)</dt><dd>{usd(q?.discounted_usd ?? run.cost.estimated_usd)}{(run.estimated_idr ?? null) !== null && <small> ≈ {idr(run.estimated_idr)}</small>}{run.unpriced && ' (Pricing Unknown)'}</dd>
      {q?.source === 'provider' && <><dt>Original / discount</dt><dd>{usd(q.original_usd)} → {usd(q.discounted_usd)} ({q.effective_discount_percent}% off) · quoted {when(q.quoted_at)}</dd></>}
      <dt>Confirmed billing charge</dt><dd>{run.billing?.confirmed_usd === null || run.billing?.confirmed_usd === undefined ? (status === 'Pending Billing' ? 'Pending billing record' : status === 'Unavailable' ? 'Unavailable' : '—') : <strong>{usd(run.billing.confirmed_usd)}</strong>}</dd>
      <dt>Difference (confirmed − estimated)</dt><dd>{diffLabel(run.cost_difference_usd)}</dd>
      <dt>Billing verification</dt><dd>{b ? `${b.status.replace('_', ' ')}${b.message ? ' — ' + b.message : ''}` : '—'}{b?.checked_at && <small> · checked {when(b.checked_at)} ({b.attempts}×)</small>}</dd>
      <dt>Prediction ID</dt><dd><code>{run.provider_request_id || '—'}</code></dd>
      <dt>Token usage</dt><dd>{tokenLabel(run.tokens)}{run.tokens?.availability === 'reported' ? <small> · source: {run.tokens.source}</small> : <small> · not reported by the provider</small>}</dd>
    </dl>
    {b?.records?.length > 0 && <details><summary>Billing records ({b.records.length})</summary><ul>{b.records.map((r) => <li key={r.uuid}><code>{r.uuid.slice(0, 8)}</code> {r.billing_type} {usd(r.price)} · {when(r.created_at)}</li>)}</ul></details>}
    <div>{(run.provider_request_id || run.status === 'AMBIGUOUS') && <button disabled={busy === 'b'} onClick={() => act('b', 'billing')}>{busy === 'b' ? 'Checking…' : 'Check billing'}</button>}
      {run.provider_request_id && run.status !== 'SUCCEEDED' && <button disabled={busy === 'r'} onClick={() => act('r', 'recheck')}>Re-check result (free)</button>}</div>
    {run.status === 'AMBIGUOUS' && <div className="admin-card"><h4>Submission outcome unknown</h4><p className="admin-muted">The request was sent once but the answer was lost, so it may have been billed. It was not retried and its quoted amount stays reserved. Use Check billing, or verify in the WaveSpeed dashboard and resolve manually.</p>
      <div className="admin-form-grid"><Field label="Outcome"><select value={form.outcome} onChange={(e) => setForm({ ...form, outcome: e.target.value })}><option value="not_billed">Not billed</option><option value="billed">Billed</option></select></Field>
        {form.outcome === 'billed' && <Field label="Amount billed (USD)"><input type="number" min="0" step="any" value={form.actual} onChange={(e) => setForm({ ...form, actual: e.target.value })} /></Field>}
        <Field label="Reason / evidence (min 10 chars)"><input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field></div>
      <button disabled={form.reason.trim().length < 10 || (form.outcome === 'billed' && form.actual === '')} onClick={() => act('x', 'resolve', { outcome: form.outcome, reason: form.reason.trim(), ...(form.outcome === 'billed' ? { actual_usd: Number(form.actual) } : {}) })}>Resolve (audited)</button></div>}
  </div>
}

function RunViewer({ initial, onChange }) {
  const [run, setRun] = useState(initial); const [error, setError] = useState('')
  const timer = useRef(null)
  useEffect(() => {
    let stop = false, billingPolls = 0
    const poll = async () => {
      try {
        const r = await labGet('/runs/' + initial.id); if (stop) return; setRun(r)
        if (isTerminal(r)) { if (billingPolls === 0) onChange?.(); if (!(r.cost_status === 'Pending Billing' && billingPolls++ < 75)) return }
      } catch (e) { if (!stop) setError(msg(e)) }
      timer.current = setTimeout(poll, isTerminal(run) ? 8000 : 2500)
    }
    if (!isTerminal(initial) || initial.cost_status === 'Pending Billing') poll()
    return () => { stop = true; clearTimeout(timer.current) }
  }, [initial.id])
  return <div className="admin-card lab-result"><div className="admin-section-head"><h3>{run.model_name} <Status value={run.status} /></h3><small>{run.provider_name} · <code>{run.id.slice(0, 8)}</code></small></div><Notice error={error} />
    {!isTerminal(run) && <div className="admin-loading">Processing at the provider… this page updates automatically. Do not resubmit — a second request is billed again.</div>}
    {(run.status === 'FAILED' || run.status === 'AMBIGUOUS') && <div className="admin-error" role="alert"><strong>{run.error_code}</strong>: {run.error_message}</div>}
    <div className="lab-images">{run.inputs.map((i) => <figure key={i.slot}><img src={labImageUrl(run.id, i.slot)} alt={i.slot} loading="lazy" /><figcaption>{i.slot} · {i.width}×{i.height}</figcaption></figure>)}
      {run.output && <figure><img src={labImageUrl(run.id, 'output')} alt="Generated" /><figcaption>{run.raw_output ? 'Finished like production' : 'Generated'} · {run.output.width}×{run.output.height} · <a href={labImageUrl(run.id, 'output', true)}>Download</a></figcaption></figure>}
      {run.raw_output && <figure><img src={labImageUrl(run.id, 'raw')} alt="Raw provider output" loading="lazy" /><figcaption>Raw provider output · <a href={labImageUrl(run.id, 'raw', true)}>Download</a></figcaption></figure>}</div>
    <dl className="admin-dl">{run.scenario && <><dt>NXBooth test</dt><dd>{run.scenario.label}{run.scenario.production_model && <small> · production model today: {run.scenario.production_model}</small>}</dd></>}
      <dt>Model · task</dt><dd><code>{run.model_id}</code></dd><dt>Execution duration</dt><dd>{ms(run.duration_ms)}</dd>
      <dt>Prompt</dt><dd>{run.scenario ? <details><summary>Production prompt (server-owned)</summary><pre style={{ whiteSpace: 'pre-wrap' }}>{run.prompt}</pre></details> : run.prompt}</dd>
      <dt>Parameters</dt><dd><code>{JSON.stringify(run.params)}</code></dd>{run.params?.prompt_adapted?.length > 0 && <><dt>Prompt adjusted for this model</dt><dd>{run.params.prompt_adapted.join('; ')}</dd></>}{run.override && <><dt>Budget override</dt><dd>{run.override.reason}</dd></>}</dl>
    <CostPanel run={run} onRun={setRun} />
    {run.status === 'SUCCEEDED' && <Rater run={run} onSaved={setRun} />}
    {(run.output || run.inputs.length > 0) && <button onClick={() => window.confirm('Delete the stored images for this run now? Cost history is kept.') && labSend('DELETE', `/runs/${run.id}/files`).then(() => labGet('/runs/' + run.id).then(setRun)).catch((e) => setError(msg(e)))}>Delete images now</button>}
  </div>
}

function Rater({ run, onSaved }) {
  const [scores, setScores] = useState(run.rating?.scores || {}); const [notes, setNotes] = useState(run.rating?.notes || ''); const [error, setError] = useState(''); const [saved, setSaved] = useState(false)
  const save = async () => { try { onSaved(await labSend('POST', `/runs/${run.id}/rating`, { scores, notes })); setSaved(true); setError('') } catch (e) { setError(msg(e)) } }
  return <details className="lab-rating"><summary>Manual quality rating (1–5, subjective)</summary><Notice error={error} notice={saved ? 'Rating saved.' : ''} />
    <div className="admin-form-grid">{RATING_LABELS.map(([k, l]) => <Field key={k} label={l}><select value={scores[k] || ''} onChange={(e) => { const v = e.target.value ? Number(e.target.value) : undefined; const n = { ...scores }; if (v) n[k] = v; else delete n[k]; setScores(n) }}><option value="">Not rated</option>{[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</select></Field>)}</div>
    <Field label="Notes"><input maxLength="1000" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field><button onClick={save} disabled={!Object.keys(scores).length}>Save rating</button></details>
}

function CompareTab({ data, reload }) {
  const [sessionId, setSessionId] = useState(null); const [sessions, setSessions] = useState([]); const [bench, setBench] = useState([]); const [threshold, setThreshold] = useState(4)
  const [candidates, setCandidates] = useState([]); const [error, setError] = useState(''); const [notice, setNotice] = useState('')
  const refresh = useCallback(() => Promise.all([labGet('/sessions'), labGet(`/benchmarks?threshold=${threshold}`), labGet('/candidates')]).then(([s, b, c]) => { setSessions(s); setBench(b); setCandidates(c) }).catch((e) => setError(msg(e))), [threshold])
  useEffect(() => { refresh() }, [refresh])
  const mark = async (b) => { const note = window.prompt(`Mark ${b.model_name} as a production candidate?\nThis only records the benchmark. It does NOT change production.`, ''); if (note === null) return
    try { await labSend('POST', '/candidates', { model_ref: b.model_ref, note, threshold }); setNotice('Recorded as candidate. Production configuration was not changed.'); refresh() } catch (e) { setError(msg(e)) } }
  return <div><Notice error={error} notice={notice} />
    <ReportCard />
    <RunTab key="compare" data={data} reload={reload} multi onSession={(id) => { setSessionId(id); refresh() }} />
    {sessionId && <SessionView id={sessionId} onChange={() => { refresh(); reload() }} />}
    <div className="admin-card"><div className="admin-section-head"><h3>Benchmarks</h3><Field label="Acceptance threshold (overall ≥)"><select value={threshold} onChange={(e) => setThreshold(Number(e.target.value))}>{[3, 4, 5].map((n) => <option key={n}>{n}</option>)}</select></Field></div>
      <p className="admin-muted">Cost per Accepted Image = total Lab spend ÷ successful runs whose overall manual rating meets the threshold. Ratings are subjective, not measured scores.</p>
      <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Model</th><th>Runs</th><th>Success</th><th>Accepted</th><th>Spend</th><th>Cost / accepted</th><th>Avg time</th><th /></tr></thead><tbody>
        {bench.length === 0 && <tr><td colSpan="8">No runs yet.</td></tr>}
        {bench.map((b) => <tr key={b.model_ref}><td>{b.provider_name} · {b.model_name}</td><td>{b.runs}</td><td>{b.succeeded}/{b.runs}</td><td>{b.accepted_count}/{b.rated} rated</td><td>{usd(b.total_spend_usd)}</td><td>{b.cost_per_accepted_usd === null ? 'n/a (none accepted)' : usd(b.cost_per_accepted_usd)}</td><td>{ms(b.avg_duration_ms)}</td><td><button onClick={() => mark(b)}>Mark as Production Candidate</button></td></tr>)}
      </tbody></table></div></div>
    <div className="admin-card"><h3>Production candidates (record only)</h3>{candidates.length === 0 ? <p className="admin-muted">None.</p> : <ul>{candidates.map((c) => <li key={c.id}><strong>{c.provider_name} · {c.model_name}</strong> — {when(c.created_at)} · <em>not activated</em>{c.note && <> · {c.note}</>}</li>)}</ul>}</div>
    <div className="admin-card"><h3>Saved comparison sessions</h3>{sessions.length === 0 ? <p className="admin-muted">None yet.</p> : <ul>{sessions.map((s) => <li key={s.id}><button onClick={() => setSessionId(s.id)}>{s.name}</button> <small>{when(s.created_at)}</small></li>)}</ul>}</div>
  </div>
}

function SessionView({ id, onChange }) {
  const [session, setSession] = useState(null); const [error, setError] = useState('')
  useEffect(() => { let stop = false, t; const load = async () => { try { const s = await labGet('/sessions/' + id); if (stop) return; setSession(s); if (s.runs.some((r) => !isTerminal(r))) t = setTimeout(load, 2500); else onChange?.() } catch (e) { if (!stop) setError(msg(e)) } }; load(); return () => { stop = true; clearTimeout(t) } }, [id])
  if (error) return <Notice error={error} />
  if (!session) return <div className="admin-loading">Loading comparison…</div>
  return <div className="admin-card"><h3>{session.name}</h3><div className="lab-compare-grid">{session.runs.map((r) => <div key={r.id} className="lab-compare-col">
    <h4>{r.provider_name} · {r.model_name} <Status value={r.status} /></h4>
    <p><small>{r.scenario?.label}</small></p>{r.output ? <img src={labImageUrl(r.id, 'output')} alt={`Output from ${r.model_name}`} loading="lazy" /> : <div className="admin-empty">{isTerminal(r) ? (r.error_message || 'No image') : 'Processing…'}</div>}
    <p><small>{ms(r.duration_ms)} · est. {usd(r.cost.estimated_usd)}{r.unpriced && ' (unknown)'} · {r.output ? `${r.output.width}×${r.output.height}` : '—'}</small></p>
    {r.status === 'SUCCEEDED' && <Rater run={r} onSaved={(u) => setSession({ ...session, runs: session.runs.map((x) => (x.id === u.id ? u : x)) })} />}</div>)}</div></div>
}

function HistoryTab({ data, fx }) {
  const [filters, setFilters] = useState({ provider_id: '', model_ref: '', status: '', from: '', to: '' }); const [analytics, setAnalytics] = useState(null); const [runs, setRuns] = useState([]); const [error, setError] = useState(''); const [open, setOpen] = useState(null)
  const qs = useMemo(() => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v); const s = p.toString(); return s ? '?' + s : '' }, [filters])
  useEffect(() => { let stop = false; Promise.all([labGet('/analytics' + qs), labGet('/runs' + qs)]).then(([a, r]) => { if (!stop) { setAnalytics(a); setRuns(r); setError('') } }).catch((e) => !stop && setError(msg(e))); return () => { stop = true } }, [qs])
  const a = analytics
  return <div><Notice error={error} />
    <div className="admin-card"><div className="admin-form-grid">
      <Field label="Provider"><select value={filters.provider_id} onChange={(e) => setFilters({ ...filters, provider_id: e.target.value })}><option value="">All</option>{data.providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      <Field label="Model"><select value={filters.model_ref} onChange={(e) => setFilters({ ...filters, model_ref: e.target.value })}><option value="">All</option>{data.models.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}</select></Field>
      <Field label="Status"><select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}><option value="">All</option><option>SUCCEEDED</option><option>FAILED</option><option>PROCESSING</option></select></Field>
      <Field label="From"><input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></Field>
      <Field label="To"><input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></Field></div>
      <a className="button" href={labExportUrl(qs)}>Export sanitized CSV</a></div>
    {!a ? <div className="admin-loading">Loading…</div> : <>
      <section className="admin-metric-grid">{[['Requests', a.totals.requests], ['Succeeded / failed', `${a.totals.succeeded} / ${a.totals.failed}`], ['Estimated spend', usd(a.totals.estimated_usd) + (a.estimated_idr !== null ? ` · ${idr(a.estimated_idr)}` : '')],
        ['Provider-reported', a.totals.provider_reported_usd === null ? 'Not exposed' : usd(a.totals.provider_reported_usd)], ['Latency avg / p50 / p95', `${ms(a.latency_ms.average)} / ${ms(a.latency_ms.p50)} / ${ms(a.latency_ms.p95)}`], ['Today / month (all Lab)', `${usd(a.spend.today_usd)} / ${usd(a.spend.month_usd)}`]].map(([l, v]) => <article className="admin-metric" key={l}><span>{l}</span><strong>{v}</strong></article>)}</section>
      <p className="admin-muted">{a.note}{a.fx.stale && ' Exchange rate is missing or stale.'}</p>
      <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Model</th><th>Runs</th><th>OK / failed</th><th>Estimated</th><th>Reported</th><th>p50</th><th>p95</th></tr></thead><tbody>{a.by_model.map((m) => <tr key={m.model_ref}><td>{m.provider_name} · {m.model_name}</td><td>{m.runs}</td><td>{m.succeeded} / {m.failed}</td><td>{usd(m.estimated_usd)}</td><td>{m.provider_reported_usd === null ? '—' : usd(m.provider_reported_usd)}</td><td>{ms(m.p50_ms)}</td><td>{ms(m.p95_ms)}</td></tr>)}</tbody></table></div>
      <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Day</th><th>Requests</th><th>Estimated</th><th>Trend</th></tr></thead><tbody>{a.daily.map((d) => { const peak = Math.max(...a.daily.map((x) => x.runs)); return <tr key={d.date}><td>{d.date}</td><td>{d.runs}</td><td>{usd(d.estimated_usd)}</td><td><span className="lab-bar" style={{ width: `${Math.round((d.runs / peak) * 100)}%` }} /></td></tr> })}</tbody></table></div></>}
    <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>When</th><th>Model</th><th>Status</th><th>Time</th><th>Cost</th><th /></tr></thead><tbody>
      {runs.length === 0 && <tr><td colSpan="6">No test runs match.</td></tr>}
      {runs.map((r) => <React.Fragment key={r.id}><tr><td>{when(r.created_at)}</td><td>{r.provider_name} · {r.model_name}</td><td><Status value={r.status} /></td><td>{ms(r.duration_ms)}</td><td>{usd(r.effective_cost_usd)}<br /><small>{r.cost.basis}</small></td><td><button onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? 'Hide' : 'Details'}</button></td></tr>
        {open === r.id && <tr><td colSpan="6"><RunViewer initial={r} /></td></tr>}</React.Fragment>)}
    </tbody></table></div></div>
}
