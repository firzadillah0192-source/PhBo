import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Check, Info, Pencil, Plus, RefreshCw, Sparkles } from 'lucide-react'
import { Button, cn, InlineAlert, TextField, Thumb } from '../../components/ui'
import { LiveDropzone } from '../../components/live'
import { BigButton, CatalogCard, FilterChip, ModeBadge, Page, Stepper, StickyCta } from '../../components/customer'
import { useCustomer } from '../../lib/customer'
import { customer as api, message, type Row } from '../../../../shared/api'
// @ts-ignore Shared pure contract validation is also tested in Node.
import { selectionOptions } from '../../../../shared/generation.mjs'
// @ts-ignore Shared wallet policy is tested in Node.
import { canStart, minimumCredits, creditDescription } from '../../../../shared/credits.mjs'
export { Home } from './Create'

function FlowHeader({ current, title, subtitle }: { current: number; title: string; subtitle?: string }) {
  const { mode } = useCustomer()
  return <div className="space-y-4"><div className="flex justify-between gap-3"><Stepper steps={mode === 'classic' ? ['Layout', 'Photos', 'Review'] : ['Photo', 'Style', 'Review']} current={current} /><ModeBadge mode={mode} /></div><div><h1 className="t-h2">{title}</h1>{subtitle && <p className="t-body-s mt-1 text-text-muted">{subtitle}</p>}</div></div>
}
function CatalogNotice() {
  const { loading, error } = useCustomer()
  return <>{loading && <p role="status">Loading available designs…</p>}{error && <InlineAlert tone="danger">{error} <button onClick={() => window.location.reload()}>Retry</button></InlineAlert>}</>
}
export function CreatePhoto() {
  const { uploads, setUploads } = useCustomer(); const navigate = useNavigate(); const has = !!uploads[0]
  return <Page narrow><FlowHeader current={0} title={has ? 'Looking good' : 'Add your photo'} subtitle={has ? 'You can replace it before continuing.' : 'A clear, front-facing photo works best.'} /><div className="mt-5 space-y-4">
    {has ? <div className="flex items-center gap-4 rounded-md border border-border bg-surface p-3">
      <Thumb src={api.uploadPreviewUrl(uploads[0].upload_id)} alt="Your photo" className="h-24 w-[72px] shrink-0" />
      <div className="min-w-0 flex-1"><p className="t-label-s flex items-center gap-1.5 text-success"><Check size={16} aria-hidden />Photo ready</p><p className="t-caption text-text-muted">Kept for 24 h</p></div>
      <Button variant="secondary" icon={RefreshCw} onClick={() => setUploads([])}>Replace</Button>
    </div> : <>
      <LiveDropzone upload={api.uploadPhoto} onUploaded={row => setUploads([row])} />
      <p className="t-caption text-center text-text-muted">We'll ask for camera access only to take your photo here. You can always upload instead.</p>
    </>}
  </div><StickyCta><BigButton disabled={!has} onClick={() => navigate('/app/create/style')}>Continue</BigButton></StickyCta></Page>
}
export function CreateStyle() {
  const c = useCustomer(); const navigate = useNavigate(); const [category, setCategory] = useState('All')
  const advanced = c.mode === 'advanced'; const list: Row[] = c.catalog[advanced ? 'artStyles' : 'templates']; const chosen = advanced ? c.styleId : c.templateId
  const experience = list.find(r => r.id === c.styleId)
  const compatible = (row: Row, key: string) => !experience?.[key]?.length || experience[key].includes(row.id)
  const frames: Row[] = c.catalog.frameStyles.filter((r: Row) => compatible(r, 'compatible_frame_style_ids'))
  const decorations: Row[] = c.catalog.ornaments.filter((r: Row) => compatible(r, 'compatible_ornament_ids'))
  const max = experience?.max_ornaments ?? 3
  function select(id: string) { if (advanced) { c.setStyleId(id); c.setFrameId(''); c.setOrnaments([]) } else c.setTemplateId(id) }
  return <Page><FlowHeader current={1} title={advanced ? 'Choose an art style' : 'Pick a template'} subtitle={advanced ? undefined : 'Your face is blended into the scene.'} /><CatalogNotice />
    {advanced && <div className="mt-4 flex flex-wrap gap-2">{['All', ...new Set(list.map(r => r.category).filter(Boolean))].map(cat => <FilterChip key={cat} label={cat} selected={cat === category} onClick={() => setCategory(cat)} />)}</div>}
    <div className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">{list.filter(r => category === 'All' || !advanced || r.category === category).map(r => <CatalogCard key={r.id} title={r.name} blurb={r.description || ''} src={r.preview_url || r.thumbnail || undefined} selected={chosen === r.id} onSelect={() => select(r.id)} />)}</div>
    {!c.loading && !list.length && <p>No designs are available. Please try later.</p>}
    {advanced && <><section className="mt-8 space-y-3" aria-labelledby="frame"><h2 id="frame" className="t-h4">Frame style</h2><div role="radiogroup" aria-labelledby="frame" className="grid gap-3 md:grid-cols-3">{frames.map(r => <button key={r.id} type="button" role="radio" aria-checked={c.frameId === r.id} aria-label={r.name} onClick={() => c.setFrameId(r.id)} className={cn('flex items-center gap-3 rounded-md border bg-surface p-3 text-left', c.frameId === r.id ? 'border-2 border-primary' : 'border-border')}><span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2', c.frameId === r.id ? 'border-primary' : 'border-border')}>{c.frameId === r.id && <span className="h-2.5 w-2.5 rounded-full bg-primary" />}</span><span><span className="t-label-s block">{r.name}</span>{r.description && <span className="t-caption block text-text-muted">{r.description}</span>}</span></button>)}</div></section>
    <section className="mt-6 space-y-3" aria-labelledby="orn"><div className="flex items-baseline justify-between"><h2 id="orn" className="t-h4">Ornaments</h2><span className="t-caption text-text-muted">{c.ornaments.length}/{max} selected</span></div><p className="t-body-s text-text-muted">Optional finishing touches.</p><div className="flex flex-wrap gap-2">{decorations.map(r => <FilterChip key={r.id} label={r.name} selected={c.ornaments.includes(r.id)} disabled={!c.ornaments.includes(r.id) && c.ornaments.length >= max} onClick={() => c.setOrnaments(c.ornaments.includes(r.id) ? c.ornaments.filter((id: string) => id !== r.id) : [...c.ornaments, r.id])} />)}</div></section></>}
    <StickyCta note={!advanced && chosen ? `${list.find(r => r.id === chosen)?.name} selected` : undefined}><BigButton disabled={!list.some(r => r.id === chosen) || (advanced && !frames.some(r => r.id === c.frameId)) || !c.uploads[0]} onClick={() => navigate('/app/create/review')}>Continue</BigButton></StickyCta>
  </Page>
}
export function ClassicLayoutPick() {
  const c = useCustomer(); const navigate = useNavigate()
  return <Page><FlowHeader current={0} title="Pick a strip layout" subtitle="1 credit per successful strip · prints at 2×6 in." /><CatalogNotice /><div className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-4">{c.catalog.classicLayouts.map((r: Row) => <CatalogCard key={r.id} title={r.name} blurb={`Classic · ${r.shot_count} photos`} src={r.preview_url} tag={r.theme_name} tall selected={r.id === c.layoutId} onSelect={() => c.setLayoutId(r.id)} />)}</div><StickyCta><BigButton disabled={!c.catalog.classicLayouts.some((r: Row) => r.id === c.layoutId)} onClick={() => navigate('/app/create/classic-photos')}>Continue</BigButton></StickyCta></Page>
}
export function ClassicPhotos() {
  const c = useCustomer(); const navigate = useNavigate()
  const layout = c.catalog.classicLayouts.find((r: Row) => r.id === c.layoutId)
  if (!layout) return <Page><Link to="/app/create/layout">Choose a layout first</Link></Page>
  const filledCount = c.uploads.filter(Boolean).length; const remaining = Math.max(layout.shot_count - filledCount, 0)
  return <Page narrow><FlowHeader current={1} title={`Add ${layout.shot_count} photos`} subtitle="They appear top to bottom in this order." />
    <ol className="mt-5 space-y-3">{Array.from({ length: layout.shot_count }, (_, i) => { const up = c.uploads[i]; const active = !up && i === filledCount
      return <li key={i} className="space-y-3 rounded-md border border-border bg-surface p-3"><div className="flex items-center gap-4">
        <span className="t-label-xs flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-white">{i + 1}</span>
        {up ? <Thumb src={api.uploadPreviewUrl(up.upload_id)} alt={`Photo ${i + 1}`} className="h-16 w-20 shrink-0" /> : <div className="flex h-16 w-20 shrink-0 items-center justify-center rounded-md bg-surface-2 text-text-muted"><Plus size={20} aria-hidden /></div>}
        <div className="min-w-0 flex-1"><p className="t-label-s">Photo {i + 1}</p><p className="t-caption text-text-muted">{up ? 'Tap to retake' : active ? 'Take or upload below' : 'Waiting for the previous photo'}</p></div>
        {up && <Button variant="tertiary" icon={RefreshCw} onClick={() => c.setUploads((before: Row[]) => before.slice(0, i))}>Retake</Button>}
      </div>{active && <LiveDropzone title={`Add photo ${i + 1}`} upload={api.uploadPhoto} onUploaded={row => c.setUploads((before: Row[]) => { const next = [...before]; next[i] = row; return next })} />}</li> })}</ol>
    {layout.requires_event_name && <div className="mt-5"><TextField label="Event name" maxLength={80} value={c.eventName} onChange={e => c.setEventName(e.target.value)} required /></div>}
    <StickyCta note={remaining > 0 ? `Add ${remaining} more photo${remaining > 1 ? 's' : ''} to continue` : undefined}><BigButton disabled={remaining > 0 || (layout.requires_event_name && !c.eventName.trim())} onClick={() => navigate('/app/create/review')}>Continue</BigButton></StickyCta></Page>
}
function SummaryRow({ src, title, body, action, to }: { src?: string; title: string; body: string; action: string; to: string }) {
  return <div className="flex items-center gap-4 rounded-md border border-border bg-surface p-3"><Thumb src={src} missing={!src} alt="" className="h-16 w-12 shrink-0" /><div className="min-w-0 flex-1"><p className="t-label-s truncate">{title}</p><p className="t-caption text-text-muted">{body}</p></div><Link to={to} className="t-label-s inline-flex h-8 items-center gap-1 rounded-sm px-2.5 text-primary hover:bg-primary-soft"><Pencil size={14} aria-hidden />{action}</Link></div>
}
export function CreateReview() {
  const c = useCustomer(); const navigate = useNavigate(); const lock = useRef(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const isClassic = c.mode === 'classic'; const selection = c.catalog[isClassic ? 'classicLayouts' : c.mode === 'advanced' ? 'artStyles' : 'templates'].find((r: Row) => r.id === (isClassic ? c.layoutId : c.mode === 'advanced' ? c.styleId : c.templateId))
  async function create() {
    if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    try {
      const options = selectionOptions(c.mode.toUpperCase(), selection, c.frameId, c.uploads, { eventName: c.eventName, capturedAt: c.uploads[0]?.captured_at, ornamentIds: c.ornaments })
      const job = await api.createGeneration(c.uploads[0].upload_id, c.mode.toUpperCase(), c.templateId, c.styleId, options)
      void c.refreshAccount().catch(() => {})
      navigate('/app/processing?job=' + encodeURIComponent(job.job_id))
    } catch (e) { setError(message(e)) }
    finally { lock.current = false; setBusy(false) }
  }
  const count = c.uploads.filter(Boolean).length
  return <Page narrow><FlowHeader current={2} title="Review" /><div className="mt-5 space-y-3">
    <SummaryRow src={c.uploads[0] ? api.uploadPreviewUrl(c.uploads[0].upload_id) : undefined} title="Your photo" body={`${count} photo${count === 1 ? '' : 's'} · kept for 24 h`} action="Replace" to={isClassic ? '/app/create/classic-photos' : '/app/create/photo'} />
    <SummaryRow src={selection?.preview_url || selection?.thumbnail || undefined} title={selection?.name || 'No design selected'} body={isClassic ? 'Classic · Photo strip' : c.mode === 'advanced' ? 'Advanced · AI art styles' : 'Basic · AI themed portrait'} action="Change" to={isClassic ? '/app/create/layout' : '/app/create/style'} />
    <div className="rounded-md bg-accent-soft p-4"><p className="t-label-s">{creditDescription(c.mode)}</p><p className="t-caption mt-0.5 text-text-muted">{c.credits} credits available{isClassic && canStart(c.mode, c.credits) ? ` · ${c.credits - 1} left after success` : ''}</p></div>
    {!canStart(c.mode, c.credits) && <InlineAlert tone="warning">You need at least {minimumCredits(c.mode)} credits. <Link to={c.signedIn ? '/app/account/credits' : '/app/signin'} className="underline">{c.signedIn ? 'View credits' : 'Sign in'}</Link></InlineAlert>}
    {!isClassic && <p className="t-caption flex items-start gap-2 text-text-muted"><Info size={14} className="mt-0.5 shrink-0" aria-hidden />The result is an AI portrait that resembles you. It is not an exact copy of your face.</p>}
    {error && <InlineAlert tone="danger">{error}</InlineAlert>}</div>
    <StickyCta><BigButton disabled={busy || !selection || !c.uploads[0] || !canStart(c.mode, c.credits)} icon={isClassic ? undefined : Sparkles} onClick={create}>{busy ? 'Submitting…' : isClassic ? 'Create my strip' : 'Create my photo'}</BigButton></StickyCta></Page>
}
