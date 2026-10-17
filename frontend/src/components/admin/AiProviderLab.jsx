import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { labGet, labSend, labUpload, labImageUrl, labExportUrl, ApiError } from '../../api.js'
import { PRICING_METHODS, RATING_LABELS, SCENARIO_KINDS, allowedFrames, capabilities, costLabel, idr, isTerminal, modelFits, pricingPayload, runBody, scenarioBody, scenarioPayload, scenarioRefCount, splitList, usd } from '../../labModel.js'

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
  const add = (e) => { e.preventDefault(); run('add', () => labSend('POST', '/providers', { name: form.name, type: form.type, ...(form.base_url ? { base_url: form.base_url } : {}) }), 'Provider registered (disabled until a credential is added).').then(() => setForm({ name: '', type: 'wavespeed', base_url: '' })) }
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
        <td><button disabled={!p.credential.configured || !p.adapter_available || busy === 't' + p.id} onClick={() => run('t' + p.id, () => labSend('POST', `/providers/${p.id}/test`), (r) => r.message)}>{busy === 't' + p.id ? 'Testing…' : 'Test connection'}</button>
          <button onClick={() => window.confirm(`Delete ${p.name} and its models? Test history is kept.`) && run('d' + p.id, () => labSend('DELETE', `/providers/${p.id}`), 'Provider deleted.')}>Delete</button></td>
      </tr>)}
    </tbody></table></div>
    <form className="admin-card" onSubmit={add}><h3>Register provider</h3><div className="admin-form-grid">
      <Field label="Display name"><input required minLength="2" maxLength="80" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
      <Field label="Provider type"><select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}><option value="wavespeed">WaveSpeedAI</option><option value="fal">fal.ai</option><option value="openai">OpenAI</option><option value="openai_compatible">OpenAI-compatible (any HTTPS host)</option><option value="9router">9Router (internal gateway)</option><option value="custom_rest">Custom REST (registration only)</option></select></Field>
      <Field label="API base URL" hint="Leave blank for the official endpoint (required for OpenAI-compatible; include /v1 if the vendor uses it). HTTPS only; validated server-side."><input value={form.base_url} placeholder="default" onChange={(e) => setForm({ ...form, base_url: e.target.value })} /></Field>
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
    <Notice error={error} notice={notice} />
    <div className="admin-section-head"><h3>Models</h3><div><button onClick={quickWave}>Prefill WaveSpeed qwen-image/edit-plus</button> <button className="primary" onClick={() => setForm({ ...blankModel, provider_id: data.providers[0]?.id || '' })}>Add model</button></div></div>
    <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Model</th><th>Tasks</th><th>Pricing</th><th>Status</th><th /></tr></thead><tbody>
      {data.models.length === 0 && <tr><td colSpan="5">No models registered.</td></tr>}
      {data.models.map((m) => <tr key={m.id}><td><strong>{m.display_name}</strong><br /><code>{m.model_id}</code><br />{providerName(m.provider_id)}</td><td>{m.tasks.join(', ')}<br /><small>up to {m.max_reference_images} input images</small></td>
        <td>{m.pricing.method === 'unknown' ? <strong>Pricing Unknown</strong> : <>{PRICING_METHODS.find(([k]) => k === m.pricing.method)?.[1]}</>}<br /><small>{m.pricing.source || 'no source'} · verified {m.pricing.verified_at ? new Date(m.pricing.verified_at).toLocaleDateString() : 'never'}</small></td>
        <td><Status value={m.status} /> {!m.enabled && <span className="admin-badge">disabled</span>}</td>
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

function SettingsCard({ settings, reload }) {
  const [f, setF] = useState(null); const [error, setError] = useState(''); const [notice, setNotice] = useState('')
  const v = f || { ...settings, fx_date: settings.fx_date ? settings.fx_date.slice(0, 10) : '' }
  const save = async (e) => { e.preventDefault(); setError(''); setNotice('')
    try { await labSend('PUT', '/settings', { fx_usd_to_idr: v.fx_usd_to_idr === '' || v.fx_usd_to_idr === null ? null : Number(v.fx_usd_to_idr), fx_source: v.fx_source || '', fx_date: v.fx_date ? new Date(v.fx_date).toISOString() : null,
      per_request_usd: Number(v.per_request_usd), daily_usd: Number(v.daily_usd), monthly_usd: Number(v.monthly_usd), max_unpriced_runs_per_day: Number(v.max_unpriced_runs_per_day), retention_days: Number(v.retention_days) }); setF(null); setNotice('Settings saved.'); reload() } catch (err) { setError(msg(err)) } }
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
      <Field label="Keep images (days)"><input type="number" min="1" max="90" value={v.retention_days} onChange={(e) => set({ retention_days: e.target.value })} /></Field>
    </div><button className="primary">Save settings</button></form>
}

// Shared by Image Playground (one model) and Comparison (several models, identical inputs).
function RunTab({ data, reload, multi, onSession }) {
  const allUsable = data.models.filter((m) => m.enabled && data.providers.find((p) => p.id === m.provider_id && p.enabled && p.credential.configured))
  const [selected, setSelected] = useState([]); const [files, setFiles] = useState({ template: null, reference: null, extra: [] })
  const [form, setForm] = useState({ prompt: '', negative_prompt: '', size: '', quality: '', seed: '', output_format: '' })
  const [preview, setPreview] = useState(null); const [confirming, setConfirming] = useState(false); const [override, setOverride] = useState('')
  const [kind, setKind] = useState('freeform'); const [catalog, setCatalog] = useState(null); const [face, setFace] = useState(null); const [variant, setVariant] = useState('all')
  const [sel, setSel] = useState({ template_id: '', experience_id: '', frame_style_id: '' })
  useEffect(() => { if (kind !== 'freeform' && !catalog) labGet('/scenarios').then(setCatalog).catch((e) => setError(msg(e))) }, [kind])
  const [ack, setAck] = useState(false); const [runs, setRuns] = useState([]); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const usable = allUsable // models that cannot run the chosen scenario stay visible but disabled
  const models = selected.map((id) => usable.find((m) => m.id === id)).filter(Boolean)
  const caps = capabilities(models[0]) // single mode: that model; compare: the first model drives shown options, server drops unsupported ones per model
  const scenarioMode = kind !== 'freeform'
  const imageCount = scenarioMode ? (kind === 'basic' ? 2 : 1) : (files.template ? 1 : 0) + (files.reference ? 1 : 0) + files.extra.length
  const chosenTemplate = catalog?.basic.find((t) => t.id === sel.template_id)
  const scenarioSize = !scenarioMode ? form.size : kind === 'basic' ? (chosenTemplate?.width ? `${chosenTemplate.width}x${chosenTemplate.height}` : '') : '1024x1024'
  const set = (patch) => { setForm({ ...form, ...patch }); setConfirming(false) }
  useEffect(() => { // live estimate before any paid call
    setConfirming(false); setPreview(null)
    if (!models.length) return
    let cancelled = false
    Promise.all(models.map((m) => labSend('POST', '/estimate', { model_ref: m.id, reference_images: scenarioMode ? scenarioRefCount(kind) : Math.max(0, imageCount - 1), ...(scenarioSize ? { size: scenarioSize } : {}) }).then((r) => [m, r])))
      .then((rows) => { if (!cancelled) setPreview(rows) }).catch((e) => !cancelled && setError(msg(e)))
    return () => { cancelled = true }
  }, [selected.join(','), imageCount, scenarioSize, kind])
  const known = preview?.every(([, r]) => r.estimate.known)
  const total = known ? Math.round(preview.reduce((s, [, r]) => s + r.estimate.usd, 0) * 1e6) / 1e6 : null
  const totalIdr = preview && preview[0]?.[1].fx.rate && known ? total * preview[0][1].fx.rate : null
  const problems = []
  if (!models.length) problems.push(multi ? 'Pick at least two models.' : 'Select a model.')
  if (multi && models.length < 2) problems.push('Comparison needs at least two models.')
  if (!scenarioMode && !form.prompt.trim()) problems.push('Enter a prompt.')
  if (scenarioMode && !face) problems.push('Upload a customer face photo.')
  if (kind === 'basic' && !sel.template_id) problems.push('Choose a Basic template.')
  if (kind === 'advanced' && (!sel.experience_id || !sel.frame_style_id)) problems.push('Choose an experience and a frame style.')
  if (scenarioMode && models.some((m) => !modelFits(m, kind))) problems.push('A selected model cannot run this scenario (needs ' + (kind === 'basic' ? 'at least 2' : '1') + ' input image slots).')
  if (models.some((m) => m.max_reference_images < imageCount)) problems.push('A selected model accepts fewer input images than provided.')
  if (!scenarioMode && models.some((m) => m.max_reference_images > 0 && !m.tasks.includes('text-to-image')) && imageCount === 0) problems.push('Upload at least a template image.')
  const submit = async () => {
    setBusy(true); setError('')
    try {
      const payload = { ...(scenarioMode ? { ...scenarioBody(form, caps), scenario: scenarioPayload(kind, sel) } : runBody(form, caps)), confirm: true, ...(override.trim() ? { override_reason: override.trim() } : {}), ...(known ? {} : { acknowledge_unknown_cost: true }) }
      const upload = scenarioMode ? { face: [face] } : { template: files.template ? [files.template] : [], reference: files.reference ? [files.reference] : [], extra: files.extra }
      if (multi) { const session = await labUpload('/compare', { ...payload, model_refs: selected, confirmed_total_usd: total }, upload); onSession(session.id) }
      else { const run = await labUpload('/runs', { ...payload, model_ref: selected[0], confirmed_estimate_usd: total }, upload); setRuns([run]) }
      setConfirming(false); reload()
    } catch (e) { setError(msg(e)) } finally { setBusy(false) }
  }
  return <div>
    <div className="admin-card"><h3>{multi ? 'Run one test case on several models' : 'Generate a test image'}</h3><Notice error={error} />
      <Field label="Test type" hint="Basic and Advanced reproduce the real customer request: the same server-owned prompt and image preparation as production."><select value={kind} onChange={(e) => { setKind(e.target.value); setConfirming(false); setSelected([]) }}>{SCENARIO_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      {scenarioMode && <ScenarioPicker kind={kind} catalog={catalog} sel={sel} setSel={(v) => { setSel(v); setConfirming(false) }} variant={variant} setVariant={setVariant} setFace={setFace} />}
      <div className="admin-form-grid">
        {multi ? <fieldset><legend>Models (same prompt, same images)</legend>{usable.map((m) => <label key={m.id}><input type="checkbox" disabled={!modelFits(m, kind)} checked={selected.includes(m.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, m.id].slice(0, 6) : selected.filter((x) => x !== m.id))} /> {m.display_name} <small>({data.providers.find((p) => p.id === m.provider_id)?.name})</small> </label>)}</fieldset>
          : <Field label="Provider · model"><select value={selected[0] || ''} onChange={(e) => { setSelected(e.target.value ? [e.target.value] : []); setForm({ ...form, size: '', quality: '', output_format: '' }) }}><option value="">Select…</option>{usable.map((m) => <option key={m.id} value={m.id} disabled={!modelFits(m, kind)}>{data.providers.find((p) => p.id === m.provider_id)?.name} · {m.display_name}{modelFits(m, kind) ? '' : ' (cannot run this test type)'}</option>)}</select></Field>}
        {usable.length === 0 && <p className="admin-muted">No usable models. Enable a provider with a credential and register a model first.</p>}
        {!scenarioMode && <><Field label="Primary template image"><input type="file" accept="image/jpeg,image/png,image/webp" disabled={!caps.images} onChange={(e) => { setFiles({ ...files, template: e.target.files[0] || null }) }} /></Field>
        <Field label="User / reference image"><input type="file" accept="image/jpeg,image/png,image/webp" disabled={caps.images < 2} onChange={(e) => setFiles({ ...files, reference: e.target.files[0] || null })} /></Field>
        <Field label="Additional references" hint={caps.images > 2 ? `Up to ${caps.images - 2} more` : 'Not supported by this model'}><input type="file" multiple accept="image/jpeg,image/png,image/webp" disabled={caps.images < 3} onChange={(e) => setFiles({ ...files, extra: [...e.target.files].slice(0, Math.max(0, caps.images - 2)) })} /></Field></>}
      </div>
      {!scenarioMode && <><Field label="Positive prompt"><textarea rows="4" maxLength="4000" value={form.prompt} onChange={(e) => set({ prompt: e.target.value })} /></Field>
      </>}
      <div className="admin-form-grid">
        {!scenarioMode && <Field label="Negative prompt" hint={caps.negative ? '' : 'Not supported by this model — not sent'}><input disabled={!caps.negative} value={form.negative_prompt} onChange={(e) => set({ negative_prompt: e.target.value })} /></Field>}
        {!scenarioMode && <Field label="Size / aspect ratio" hint={caps.size ? '' : 'Not supported — not sent'}>{caps.sizes.length ? <select disabled={!caps.size} value={form.size} onChange={(e) => set({ size: e.target.value })}><option value="">Provider default</option>{caps.sizes.map((s) => <option key={s}>{s}</option>)}</select> : <input disabled={!caps.size} placeholder="e.g. 1024*1024" value={form.size} onChange={(e) => set({ size: e.target.value })} />}</Field>}
        <Field label="Quality" hint={caps.quality.length ? '' : 'Not supported — not sent'}><select disabled={!caps.quality.length} value={form.quality} onChange={(e) => set({ quality: e.target.value })}><option value="">Provider default</option>{caps.quality.map((s) => <option key={s}>{s}</option>)}</select></Field>
        <Field label="Output format" hint={caps.formats.length ? '' : 'Not supported — not sent'}><select disabled={!caps.formats.length} value={form.output_format} onChange={(e) => set({ output_format: e.target.value })}><option value="">Provider default</option>{caps.formats.map((s) => <option key={s}>{s}</option>)}</select></Field>
        <Field label="Seed" hint={caps.seed ? 'Optional integer' : 'Not supported — not sent'}><input type="number" step="1" disabled={!caps.seed} value={form.seed} onChange={(e) => set({ seed: e.target.value })} /></Field>
      </div>
      <div className="admin-card lab-estimate" aria-live="polite"><h4>Estimated cost</h4>
        {!models.length ? <p className="admin-muted">Select a model to see the estimate.</p> : !preview ? <p className="admin-muted">Calculating…</p> : <>
          <table className="admin-table"><tbody>{preview.map(([m, r]) => <tr key={m.id}><td>{m.display_name}</td><td><strong>{costLabel(r.estimate)}</strong>{r.estimate.known && <small> ≈ {idr(r.estimated_idr)}{r.fx.stale && r.estimated_idr !== null ? ' (stale rate)' : ''}</small>}{!r.estimate.known && <small> — {r.estimate.reason}</small>}
            {r.estimate.breakdown.map((b) => <div key={b.label}><small>{b.label}: {usd(b.usd)}</small></div>)}</td></tr>)}</tbody></table>
          <p className="admin-muted">Estimate from your configured price schedule — not the provider's final billed amount. Today: {usd(preview[0][1].budget.spent.today_usd)} of {usd(preview[0][1].budget.limits.daily_usd)} · Month: {usd(preview[0][1].budget.spent.month_usd)} of {usd(preview[0][1].budget.limits.monthly_usd)}.</p>
          {preview[0][1].fx.rate === null && <p className="admin-muted">Set the exchange rate in Models &amp; Pricing to see IDR.</p>}</>}
      </div>
      {problems.length > 0 && <ul className="admin-muted">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
      {!confirming ? <button className="primary" disabled={problems.length > 0 || !preview} onClick={() => setConfirming(true)}>{multi ? 'Review & generate on all models' : 'Review & generate'}</button>
        : <div className="admin-card lab-confirm" role="alertdialog" aria-label="Confirm paid generation"><h4>Confirm paid generation</h4>
          <p>{known ? <>This will send a live request{multi ? ' to each model' : ''} with an estimated total of <strong>{usd(total)}</strong>{totalIdr !== null && <> (≈ {idr(totalIdr)})</>}.</> : <><strong>Pricing is unknown</strong> for at least one selected model. The cost cannot be estimated and will be billed by the provider.</>} Failed or timed-out requests may still be billed. Nothing is retried automatically.</p>
          {!known && <label><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I understand the cost is unknown.</label>}
          <Field label="Budget override reason (only if the server reports a limit is exceeded)"><input value={override} onChange={(e) => setOverride(e.target.value)} placeholder="Leave empty normally. Audited when used." /></Field>
          <button className="primary" disabled={busy || (!known && !ack)} onClick={submit}>{busy ? 'Submitting…' : 'Confirm and generate'}</button> <button onClick={() => setConfirming(false)}>Cancel</button></div>}
    </div>
    {!multi && runs.map((r) => <RunViewer key={r.id} initial={r} onChange={reload} />)}
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

function RunViewer({ initial, onChange }) {
  const [run, setRun] = useState(initial); const [error, setError] = useState('')
  const timer = useRef(null)
  useEffect(() => {
    let stop = false
    const poll = async () => { try { const r = await labGet('/runs/' + initial.id); if (stop) return; setRun(r); if (isTerminal(r)) { onChange?.(); return } } catch (e) { if (!stop) setError(msg(e)) } timer.current = setTimeout(poll, 2500) }
    if (!isTerminal(initial)) poll()
    return () => { stop = true; clearTimeout(timer.current) }
  }, [initial.id])
  const cost = run.cost
  return <div className="admin-card lab-result"><div className="admin-section-head"><h3>{run.model_name} <Status value={run.status} /></h3><small>{run.provider_name} · <code>{run.id.slice(0, 8)}</code></small></div><Notice error={error} />
    {!isTerminal(run) && <div className="admin-loading">Processing at the provider… this page updates automatically. Do not resubmit — a second request is billed again.</div>}
    {run.status === 'FAILED' && <div className="admin-error" role="alert"><strong>{run.error_code}</strong>: {run.error_message}</div>}
    <div className="lab-images">{run.inputs.map((i) => <figure key={i.slot}><img src={labImageUrl(run.id, i.slot)} alt={i.slot} loading="lazy" /><figcaption>{i.slot} · {i.width}×{i.height}</figcaption></figure>)}
      {run.output && <figure><img src={labImageUrl(run.id, 'output')} alt="Generated" /><figcaption>{run.raw_output ? 'Finished like production' : 'Generated'} · {run.output.width}×{run.output.height} · <a href={labImageUrl(run.id, 'output', true)}>Download</a></figcaption></figure>}
      {run.raw_output && <figure><img src={labImageUrl(run.id, 'raw')} alt="Raw provider output" loading="lazy" /><figcaption>Raw provider output · <a href={labImageUrl(run.id, 'raw', true)}>Download</a></figcaption></figure>}</div>
    <dl className="admin-dl">{run.scenario && <><dt>NXBooth test</dt><dd>{run.scenario.label}{run.scenario.production_model && <small> · production model today: {run.scenario.production_model}</small>}</dd></>}<dt>Duration</dt><dd>{ms(run.duration_ms)}</dd><dt>Provider request ID</dt><dd>{run.provider_request_id || '—'}</dd>
      <dt>Estimated cost</dt><dd>{usd(cost.estimated_usd)}{run.unpriced && ' (Pricing Unknown)'}</dd>
      <dt>Provider-reported cost</dt><dd>{cost.provider_reported_usd === null ? 'Not exposed by this provider' : usd(cost.provider_reported_usd)}</dd>
      <dt>Calculated from usage</dt><dd>{cost.calculated_usd === null ? '—' : usd(cost.calculated_usd)}</dd><dt>Cost basis</dt><dd>{cost.basis} — not necessarily the final billed amount</dd>
      <dt>Prompt</dt><dd>{run.scenario ? <details><summary>Production prompt (server-owned)</summary><pre style={{ whiteSpace: 'pre-wrap' }}>{run.prompt}</pre></details> : run.prompt}</dd><dt>Parameters</dt><dd><code>{JSON.stringify(run.params)}</code></dd>{run.override && <><dt>Budget override</dt><dd>{run.override.reason}</dd></>}</dl>
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
