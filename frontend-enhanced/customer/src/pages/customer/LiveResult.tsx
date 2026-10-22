import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Check, Clock, Copy, Download, Loader2, QrCode, RefreshCw, Trash2, TriangleAlert } from 'lucide-react'
import { Button, cn, InlineAlert, Thumb } from '../../components/ui'
import { BigButton, Logo, ModeBadge, Page, Sheet, StatusBlock } from '../../components/customer'
import { useToast } from '../../components/overlays'
import { customer as api, date, message } from '../../../../shared/api'
import { useCustomer } from '../../lib/customer'
import { useResource } from '../../../../shared/useResource'
import { QRCode } from '../../../../shared/QRCode'
// @ts-ignore Shared contract validation is tested in Node.
import { jobDestination } from '../../../../shared/generation.mjs'
import { useSearchParams } from 'react-router-dom'

export function Processing() {
  const [params] = useSearchParams(); const id = params.get('job'); const navigate = useNavigate()
  const resource = useResource(async () => { if (!id) throw new Error('No generation job was selected.'); return api.getGeneration(id) }, [id], 2000)
  const { refreshAccount } = useCustomer()
  const job = resource.data; const destination = job && jobDestination(job)
  useEffect(() => { if (destination) navigate(destination, { replace: true }) }, [destination, navigate])
  useEffect(() => { if (job?.state === 'COMPLETED' || job?.state === 'FAILED') void refreshAccount().catch(() => {}) }, [job?.state, job?.credit_charge?.status, refreshAccount])
  const failed = job?.state === 'FAILED'; const state = job?.state
  const refunded = /REFUND/i.test(job?.credit_charge?.status || '')
  return <div className="min-h-screen bg-stage-bg text-stage-text">
    <header className="flex h-14 items-center justify-between border-b border-stage-border bg-stage-surface px-4 md:px-8">
      <Logo dark />
      {job && !failed && <span className="t-label-xs inline-flex h-6 items-center gap-1 rounded-full bg-stage-info-soft px-2 text-stage-info">{state === 'PROCESSING' ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <Clock size={12} aria-hidden />}{state === 'PROCESSING' ? 'Creating' : 'In line'}</span>}
    </header>
    <main className="mx-auto flex max-w-md flex-col items-center justify-center px-4 py-16">
      {resource.error && <StatusBlock dark icon={TriangleAlert} tone="danger" title="We couldn't check your photo" body={resource.error}><BigButton icon={RefreshCw} onClick={resource.refresh}>Retry status check</BigButton><Link to="/app" className="t-label inline-flex h-12 items-center justify-center rounded-md text-stage-primary hover:bg-stage-primary-soft">Back to Create</Link></StatusBlock>}
      {!resource.error && failed && <StatusBlock dark icon={TriangleAlert} tone="danger" title="We couldn't create this photo" body={refunded ? 'Something went wrong on our side. Your credit was returned.' : 'Something went wrong on our side. Please try again.'}>
        {refunded && <span className="t-label-s inline-flex h-8 items-center gap-1.5 rounded-full bg-stage-success-soft px-3 text-stage-success"><Check size={16} aria-hidden />Credit returned</span>}
        <p className="t-mono text-stage-muted">Reference ID: {String(job.job_id || id).slice(0, 8)}</p>
        <div className="flex w-full flex-col gap-2"><BigButton icon={RefreshCw} onClick={() => navigate('/app/create/review')}>Try again</BigButton><Link to="/app/create/style" className="t-label inline-flex h-12 items-center justify-center rounded-md text-stage-primary hover:bg-stage-primary-soft">Choose another style</Link></div>
      </StatusBlock>}
      {!resource.error && !failed && state === 'PROCESSING' && <StatusBlock dark icon={Loader2} tone="primary" title="Creating your photo…" body="Still working. Busy moments can take a little longer."><div className="h-1.5 w-56 overflow-hidden rounded-full bg-stage-surface-2" role="progressbar" aria-label="Creating"><div className="h-full w-2/3 animate-pulse rounded-full bg-stage-primary" /></div><p className="t-caption text-stage-muted">You can leave this page. Find it later in My Creations.</p></StatusBlock>}
      {!resource.error && !failed && state === 'COMPLETED' && <StatusBlock dark icon={Loader2} tone="primary" title={job.credit_charge?.status === 'NEEDS_TOP_UP' ? 'More credits needed' : 'Confirming final cost…'} body={job.credit_charge?.credits != null ? `This result costs ${job.credit_charge.credits} credits. It stays protected until payment is confirmed.` : 'Your result is saved. Waiting for usage details before calculating the final cost.'}><Link to="/app/account/credits" className="underline">View credits</Link><BigButton onClick={resource.refresh}>Check again</BigButton></StatusBlock>}
      {!resource.error && !failed && state !== 'PROCESSING' && state !== 'COMPLETED' && <StatusBlock dark icon={Clock} tone="info" title="In line…" body="You're next. This usually takes under a minute."><p className="t-caption text-stage-muted">You can leave this page. We'll keep working.</p></StatusBlock>}
    </main>
  </div>
}

export function Result() {
  const { refreshAccount } = useCustomer()
  useEffect(() => { void refreshAccount().catch(() => {}) }, [refreshAccount])
  const { kind: id = '' } = useParams(); const navigate = useNavigate(); const toast = useToast()
  const resource = useResource(() => api.getResult(id), [id])
  const jobInfo = useResource(async () => resource.data?.job_id ? api.getGeneration(resource.data.job_id).catch(() => null) : null, [resource.data?.job_id])
  const [sheet, setSheet] = useState<'share' | 'exists' | 'delete' | null>(null)
  const [claim, setClaim] = useState<any>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const row = resource.data
  const isClassic = !!row?.print_download_url || String(jobInfo.data?.mode).toUpperCase() === 'CLASSIC'
  const mode = String(jobInfo.data?.mode || (isClassic ? 'CLASSIC' : '')).toLowerCase() as 'classic' | 'basic' | 'advanced' | ''
  async function share(refresh = false) {
    setBusy(true); setError('')
    try { setClaim(await api.createResultClaim(id, claim?.claim_url?.split('/').pop() || null, refresh)); setSheet('share') }
    catch (e) { setError(message(e)) } finally { setBusy(false) }
  }
  async function remove() {
    setBusy(true); setError('')
    try { await api.deleteResultPhoto(id); toast({ tone: 'success', title: 'Photo deleted' }); navigate('/app/account/creations') }
    catch (e) { setError(message(e)) } finally { setBusy(false) }
  }
  if (resource.loading) return <Page><p role="status">Loading result…</p></Page>
  if (resource.error) return <Page><InlineAlert tone="danger">{resource.error}</InlineAlert><BigButton onClick={resource.refresh}>Retry</BigButton></Page>
  return <Page className="md:pt-10">
    <div className="grid gap-6 md:grid-cols-[minmax(0,420px)_1fr] md:gap-12">
      <div className="mx-auto w-full max-w-sm md:max-w-none"><Thumb src={api.resultImageUrl(id)} alt="Your completed photo" className={cn('w-full shadow-e2', isClassic ? 'aspect-[1/3] max-h-[560px] !rounded-md !object-contain' : 'aspect-[2/3] !object-contain')} /></div>
      <div className="space-y-5 md:pt-6">
        <div className="space-y-2"><h1 className="t-h2 md:t-h1">Your photo is ready</h1>{jobInfo.data?.credit_charge?.credits != null && <p className="t-body-s text-text-muted">{jobInfo.data.credit_charge.credits} credits charged</p>}<p className="t-body-s flex items-center gap-2 text-text-muted">{mode && <ModeBadge mode={mode} />}{date(row.created_at)}</p></div>
        <div className="flex flex-col gap-3 md:max-w-sm">
          <a href={api.resultDownloadUrl(id)} className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-primary px-5 font-semibold text-white hover:bg-primary-hover" onClick={() => toast({ tone: 'success', title: 'Download started' })}><Download size={20} aria-hidden />Download</a>
          {row.print_download_url && <a href={row.print_download_url} className="inline-flex h-12 items-center justify-center gap-2 rounded-md border border-border bg-surface px-5 font-semibold"><Download size={20} aria-hidden />Download print strip (2×6 in, 300 dpi)</a>}
          <BigButton variant="secondary" icon={QrCode} disabled={busy} onClick={() => share()}>Share via QR</BigButton>
        </div>
        <div className="hidden flex-col gap-3 border-t border-border pt-5 md:flex md:max-w-sm">
          <Button variant="tertiary" onClick={() => navigate('/app')}>Create another</Button>
          <Button variant="tertiary" icon={Trash2} className="!text-danger hover:!bg-danger-soft" onClick={() => setSheet('delete')}>Delete this photo</Button>
          <p className="t-caption text-text-muted">{row.width} × {row.height} · {row.expires_at ? `Available until ${date(row.expires_at)}` : 'Saved to My Creations'}</p>
        </div>
        <div className="flex gap-2 md:hidden"><Button variant="tertiary" onClick={() => navigate('/app')}>Create another</Button><Button variant="tertiary" icon={Trash2} className="!text-danger" onClick={() => setSheet('delete')}>Delete</Button></div>
        {error && !sheet && <InlineAlert tone="danger">{error}</InlineAlert>}
      </div>
    </div>
    {sheet === 'share' && claim && <Sheet title="Share your photo" onClose={() => setSheet(null)}><div className="space-y-4">
      <p className="t-body-s text-text-muted">Scan the code or send the link.</p>
      <div className="flex justify-center"><QRCode value={claim.qr_payload} /></div>
      <div className="flex items-center gap-2 rounded-sm border border-border bg-surface-2 p-2 pl-3"><span className="t-mono min-w-0 flex-1 truncate">{claim.claim_url}</span><Button variant="secondary" size="sm" icon={Copy} onClick={async () => { try { await navigator.clipboard.writeText(claim.claim_url); toast({ tone: 'success', title: 'Link copied' }) } catch { setError('Could not copy the link. You can select the link above.') } }}>Copy</Button></div>
      {claim.expires_at && <p className="t-caption flex items-center gap-1.5 text-text-muted"><Clock size={14} aria-hidden />Link expires {date(claim.expires_at)}</p>}
      {error && <p role="alert" className="t-caption text-danger">{error}</p>}
      <button type="button" disabled={busy} className="t-caption text-primary underline" onClick={() => setSheet('exists')}>Already shared this one?</button>
    </div></Sheet>}
    {sheet === 'exists' && <Sheet title="A link already exists" onClose={() => setSheet(null)}><p className="t-body text-text-muted">We can't show the earlier code again on this device. Create a new link and the old one stops working.</p><div className="mt-5 flex flex-col gap-2"><BigButton disabled={busy} onClick={() => share(true)}>Create new link</BigButton><BigButton variant="tertiary" onClick={() => setSheet(null)}>Cancel</BigButton></div></Sheet>}
    {sheet === 'delete' && <Sheet title="Delete this photo?" onClose={() => setSheet(null)}><p className="t-body text-text-muted">This can't be undone. Any shared link to it will stop working.</p>{error && <p role="alert" className="t-caption mt-3 text-danger">{error}</p>}<div className="mt-5 flex gap-2"><BigButton variant="secondary" onClick={() => setSheet(null)}>Cancel</BigButton><BigButton disabled={busy} variant="destructive" icon={Trash2} onClick={remove}>Delete</BigButton></div></Sheet>}
  </Page>
}

export function SharedPhoto() {
  const { token = '', code = '' } = useParams()
  const resource = useResource(() => api.getPublicResultClaim(token || code), [token, code])
  return <div className="min-h-screen bg-bg">
    <header className="flex h-14 items-center justify-center border-b border-border bg-surface"><span className="t-h4">NXBooth</span></header>
    <main className="mx-auto flex max-w-sm flex-col items-center gap-4 px-4 py-8">
      {resource.loading ? <p role="status">Loading shared photo…</p>
        : resource.error ? <StatusBlock icon={TriangleAlert} tone="warning" title="This photo is no longer available" body="The link may have expired or the photo was removed."><BigButton onClick={resource.refresh}>Retry</BigButton><p className="t-caption text-text-muted">Made with NXBooth</p></StatusBlock>
        : <>
          <p className="t-caption flex items-center gap-1.5 text-text-muted"><Clock size={14} aria-hidden />Link expires {date(resource.data.expires_at)}</p>
          <Thumb src={resource.data.image_url} alt="Shared photo" className="aspect-[2/3] w-full !object-contain shadow-e2" />
          <a href={resource.data.download_url} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-md bg-primary px-5 font-semibold text-white"><Download size={20} aria-hidden />Download</a>
          {resource.data.print_download_url && <a href={resource.data.print_download_url} className="t-label text-primary">Download print strip</a>}
          <p className="t-caption text-text-muted">Made with NXBooth</p>
        </>}
    </main>
  </div>
}
