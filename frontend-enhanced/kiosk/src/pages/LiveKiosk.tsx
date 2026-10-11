import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { Ban, Camera, Check, ChevronRight, Clock, RotateCcw, Sparkles, Upload } from 'lucide-react'
import { kiosk as api, message, rows, type Row } from '../../../shared/api'
import { useResource } from '../../../shared/useResource'
import { GoogleSignIn } from '../../../shared/GoogleSignIn'
import { QRCode } from '../../../shared/QRCode'
// @ts-ignore Same tested validation as the customer flow.
import { selectionOptions } from '../../../shared/generation.mjs'
import { cn, Thumb } from '../components/ui'
import { BrandRow, Collage, H1, IdleDialog, KButton, KHeader, Muted, Screen, Stage, modeRows } from './Kiosk'

type Step = 'signin' | 'attract' | 'mode' | 'style' | 'camera' | 'processing' | 'result'
type Mode = 'CLASSIC' | 'BASIC' | 'ADVANCED'

const IDLE_AFTER_RESULT_MS = 20_000
const IDLE_AFTER_OTHER_MS = 90_000
const IDLE_COUNTDOWN_S = 15
const JOB_KEY = 'nxbooth:v2:kiosk-job'
const previewUrl = (row: Row) => '/api/kiosk/web/uploads/' + row.upload_id + '/preview'

/* ───────────── Live capture: real camera with a 3-2-1 countdown, or a file upload ───────────── */

function Capture({ index, total, upload, onUploaded }: { index: number; total: number; upload: (file: File) => Promise<Row>; onUploaded: (row: Row) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const alive = useRef(true)
  const latest = useRef({ upload, onUploaded }); latest.current = { upload, onUploaded }
  const [ready, setReady] = useState(false)
  const [count, setCount] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [run, setRun] = useState(0)

  useEffect(() => {
    alive.current = true
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false }).then(opened => {
      if (!alive.current) { opened.getTracks().forEach(t => t.stop()); return }
      stream.current = opened
      if (video.current) { video.current.srcObject = opened; video.current.play().catch(() => setError('Could not start the camera. Upload a photo instead.')) }
      setReady(true)
    }).catch(() => { if (alive.current) setError('Camera access is unavailable. Allow camera access or upload a photo.') })
    return () => { alive.current = false; stream.current?.getTracks().forEach(t => t.stop()); stream.current = null }
  }, [])

  const send = useCallback(async (file?: File) => {
    if (!file) return
    setBusy(true); setError('')
    try {
      if (file.size > 12 * 1024 * 1024) throw new Error('Photo must be at most 12 MB.')
      if (!/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) throw new Error('Choose a JPG, PNG, WebP or HEIC photo.')
      const result = await latest.current.upload(file)
      if (!result.upload_id) throw new Error('The server did not accept this upload.')
      if (alive.current) latest.current.onUploaded({ ...result, captured_at: new Date().toISOString() })
    } catch (e) { if (alive.current) setError(message(e)) }
    finally { if (alive.current) setBusy(false); if (input.current) input.current.value = '' }
  }, [])

  const snap = useCallback(() => {
    const v = video.current
    if (!v?.videoWidth) { setError('The camera is not ready yet. Try again.'); return }
    const canvas = document.createElement('canvas'); canvas.width = v.videoWidth; canvas.height = v.videoHeight
    canvas.getContext('2d')?.drawImage(v, 0, 0)
    canvas.toBlob(blob => { if (blob) send(new File([blob], 'capture.jpg', { type: 'image/jpeg' })); else setError('Could not capture this photo.') }, 'image/jpeg', .95)
  }, [send])

  useEffect(() => {
    if (!ready || busy || error) return
    let n = 3; setCount(n)
    const id = window.setInterval(() => { n -= 1; if (n <= 0) { window.clearInterval(id); setCount(null); snap() } else setCount(n) }, 1000)
    return () => window.clearInterval(id)
  }, [ready, run, index, snap])

  return <>
    <H1>{total > 1 ? `Photo ${index + 1} of ${total}` : 'Get ready!'}</H1>
    <div className="relative flex h-[1190px] shrink-0 items-center justify-center overflow-hidden rounded-[32px] bg-stage-surface-2">
      <video ref={video} muted playsInline aria-label="Live camera" className={cn('absolute inset-0 h-full w-full -scale-x-100 object-cover', !ready && 'hidden')} />
      {count !== null && <span aria-live="assertive" className="relative font-display text-[380px] font-extrabold leading-none text-white drop-shadow-lg">{count}</span>}
      {busy && <span role="status" className="relative font-display text-[54px] font-bold">Uploading…</span>}
      {!ready && !busy && !error && <span role="status" className="text-2xl text-stage-muted">Starting the camera…</span>}
    </div>
    {error && <div role="alert" className="rounded-2xl bg-stage-danger-soft p-6 text-2xl">{error}</div>}
    <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" hidden onChange={e => send(e.target.files?.[0])} />
    <div className="flex gap-6">
      <KButton variant="secondary" icon={Upload} disabled={busy} onClick={() => input.current?.click()} className="flex-1">Upload instead</KButton>
      <KButton variant="secondary" icon={Camera} disabled={busy || !ready} onClick={() => { setError(''); setRun(r => r + 1) }} className="flex-1">Retake</KButton>
    </div>
  </>
}

/* ───────────── Flow ───────────── */

export function Kiosk() {
  const [allowed, setAllowed] = useState(false); const [checking, setChecking] = useState(true); const [step, setStep] = useState<Step>('signin'); const [attempted, setAttempted] = useState(false)
  const [mode, setMode] = useState<Mode>('CLASSIC'); const [design, setDesign] = useState<Row | null>(null); const [frame, setFrame] = useState(''); const [uploads, setUploads] = useState<Row[]>([])
  const [eventName, setEventName] = useState(''); const [job, setJob] = useState<string | null>(() => { try { return sessionStorage.getItem(JOB_KEY) } catch { return null } })
  const [resultId, setResultId] = useState<string | null>(null); const [claim, setClaim] = useState<any>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const lock = useRef(false)
  const [idle, setIdle] = useState(false); const [idleLeft, setIdleLeft] = useState(IDLE_COUNTDOWN_S); const lastActivity = useRef(Date.now()); const idleStart = useRef(0)

  const check = useCallback(async () => { setChecking(true); try { const access = await api.getKioskAccess(); setAllowed(!!access.allowed); setStep(access.allowed ? job ? 'processing' : 'attract' : 'signin'); setError('') } catch (e) { setAllowed(false); setStep('signin'); setError(message(e)) } finally { setChecking(false) } }, [])
  useEffect(() => { check(); const lost = () => { setAllowed(false); setStep('signin'); setError('Staff access expired. Sign in again.') }; window.addEventListener('kiosk:access-lost', lost); return () => window.removeEventListener('kiosk:access-lost', lost) }, [check])
  const catalog = useResource(async () => {
    if (!allowed) return null
    const [l, t, e, f, usage] = await Promise.all([api.getClassicLayouts(), api.getTemplates(), api.getExperiences(), api.getFrameStyles(), api.getUsage()])
    return { CLASSIC: rows(l), BASIC: rows(t, 'templates').filter(r => r.basic_available && r.enabled), ADVANCED: rows(e, 'experiences'), frames: rows(f).filter(r => r.enabled), usage }
  }, [allowed])
  const poll = useResource(async () => job && allowed ? api.getGeneration(job) : null, [job, allowed], job && allowed && step === 'processing' ? 2000 : 0)
  useEffect(() => {
    if (poll.data?.state === 'COMPLETED' && poll.data.result_id && (!poll.data.credit_charge || poll.data.credit_charge.status === 'PAID')) { setResultId(poll.data.result_id); setStep('result') }
  }, [poll.data])
  const result = useResource(() => resultId && allowed ? api.getResult(resultId) : Promise.resolve(null), [resultId, allowed])
  useEffect(() => {
    if (!resultId || !allowed) return
    let stopped = false
    api.createResultClaim(resultId).then((value: any) => { if (!stopped) setClaim(value) }).catch((e: any) => { if (!stopped) setError(message(e)) })
    return () => { stopped = true }
  }, [resultId, allowed])
  const reset = useCallback(() => { setUploads([]); setDesign(null); setFrame(''); setEventName(''); setJob(null); setResultId(null); setClaim(null); setError(''); setIdle(false); setStep('attract'); try { sessionStorage.removeItem(JOB_KEY) } catch {} lastActivity.current = Date.now() }, [])

  // Idle reset: 20 s on the result screen, 90 s elsewhere, then a 15 s "Still there?" countdown.
  useEffect(() => {
    lastActivity.current = Date.now()
    const activity = () => { if (!idle) lastActivity.current = Date.now() }
    window.addEventListener('pointerdown', activity); window.addEventListener('keydown', activity)
    const timer = setInterval(() => {
      if (['camera', 'processing', 'signin', 'attract'].includes(step) || busy) return
      if (idle) { const left = IDLE_COUNTDOWN_S - Math.floor((Date.now() - idleStart.current) / 1000); setIdleLeft(Math.max(0, left)); if (left <= 0) reset() }
      else if (Date.now() - lastActivity.current > (step === 'result' ? IDLE_AFTER_RESULT_MS : IDLE_AFTER_OTHER_MS)) { idleStart.current = Date.now(); setIdleLeft(IDLE_COUNTDOWN_S); setIdle(true) }
    }, 500)
    return () => { clearInterval(timer); window.removeEventListener('pointerdown', activity); window.removeEventListener('keydown', activity) }
  }, [step, busy, idle, reset])

  async function start() { if (busy) return; setBusy(true); setError(''); try { await api.startKioskSession(); catalog.refresh(); setStep('mode') } catch (e) { setError(message(e)) } finally { setBusy(false) } }
  async function generate() {
    if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    try { const options = selectionOptions(mode, design, frame, uploads, { eventName, capturedAt: uploads[0]?.captured_at }); const response = await api.createGeneration(uploads[0].upload_id, mode, mode === 'BASIC' ? design?.id : null, mode === 'ADVANCED' ? design?.id : null, options); setJob(response.job_id); try { sessionStorage.setItem(JOB_KEY, response.job_id) } catch {} setStep('processing') }
    catch (e) { setError(message(e)) } finally { setBusy(false); lock.current = false }
  }

  const designs: Row[] = (catalog.data as any)?.[mode] || []
  const frames: Row[] = catalog.data?.frames?.filter((r: Row) => !design?.compatible_frame_style_ids?.length || design.compatible_frame_style_ids.includes(r.id)) || []
  const shots = mode === 'CLASSIC' ? design?.shot_count ?? 0 : 1
  const credits = (catalog.data as any)?.usage?.ai_remaining
  // Classic needs the layout first (it decides how many shots); AI modes take the photo first.
  const flow: ('mode' | 'style' | 'camera' | 'result')[] = mode === 'CLASSIC' ? ['mode', 'style', 'camera', 'result'] : ['mode', 'camera', 'style', 'result']
  const stepName = { mode: 'Mode', style: mode === 'CLASSIC' ? 'Layout' : 'Style', camera: 'Photo', result: 'Result' } as const
  const header = (s: 'mode' | 'style' | 'camera' | 'result') => <KHeader n={flow.indexOf(s) + 1} name={stepName[s]} onStartOver={reset} />
  const needsEvent = !!design?.requires_event_name
  const alertText = error || catalog.error || poll.error || result.error
  const alert = alertText && <div role="alert" className="flex items-center gap-4 rounded-2xl bg-stage-danger-soft p-6"><Ban size={32} className="shrink-0 text-stage-danger" aria-hidden /><p className="flex-1 text-2xl">{alertText}</p><button type="button" className="text-2xl underline" onClick={() => { catalog.refresh(); poll.refresh(); result.refresh() }}>Retry</button></div>

  function pick(m: Mode) { setMode(m); setDesign(null); setUploads([]); setFrame(''); setEventName(''); setStep(m === 'CLASSIC' ? 'style' : 'camera') }
  function addUpload(row: Row) {
    setUploads(before => { const next = [...before, row]; return next })
    if (mode !== 'CLASSIC') setStep('style')
  }

  let body: ReactNode
  if (checking) body = <Screen><p role="status" className="text-2xl text-stage-muted">Checking staff access…</p></Screen>
  else if (!allowed || step === 'signin') body = <Screen gap="gap-12"><div className="flex flex-1 items-center justify-center"><div className="flex w-[760px] flex-col gap-8 rounded-[32px] bg-stage-surface p-16">
    <BrandRow />
    <div className="flex flex-col gap-3"><h1 className="font-display text-[42px] font-bold leading-[54px]">Kiosk sign-in</h1><Muted>Staff only. Sign in with the authorised Google account to unlock this kiosk.</Muted></div>
    <div className="[&_[role=alert]]:text-stage-danger"><GoogleSignIn signIn={(token: string) => { setAttempted(true); return api.kioskGoogleLogin(token) }} onSuccess={check} /></div>
    {(attempted || error) && <div role="alert" className="flex items-center gap-4 rounded-2xl bg-stage-danger-soft p-6"><Ban size={32} className="shrink-0 text-stage-danger" aria-hidden /><p className="text-2xl">{error || 'This account does not have kiosk access.'}</p></div>}
  </div></div></Screen>
  else if (step === 'attract') body = <>
    <button type="button" disabled={busy} onClick={start} aria-label="Tap to start" className="flex h-full w-full flex-col items-center justify-between p-16 text-center">
      <div className="self-start"><BrandRow /></div>
      <Collage />
      <div className="flex flex-col items-center gap-5"><h1 className="font-display text-[72px] font-extrabold leading-[84px]">Make your<br />photobooth moment</h1><Muted>Photo strips and AI portraits in about a minute.</Muted></div>
      <span className="flex h-40 w-[600px] items-center justify-center rounded-full bg-stage-primary font-display text-[54px] font-bold text-stage-bg">{busy ? 'Starting…' : 'Tap to start'}</span>
    </button>
    {error && <div className="absolute inset-x-16 bottom-64">{alert}</div>}
  </>
  else if (step === 'processing') {
    const state = poll.data?.state
    body = <Screen gap="gap-16"><BrandRow /><div className="flex flex-1 flex-col items-center justify-center gap-16">
      <div className="h-[780px] w-[520px] overflow-hidden rounded-[32px] bg-stage-surface-2">{uploads[0] && <Thumb src={previewUrl(uploads[0])} alt="Your photo" className="h-full w-full !rounded-none opacity-80" />}</div>
      <div className="flex flex-col items-center gap-5 text-center">
        <H1>{state === 'FAILED' ? 'We could not create your photo' : state === 'COMPLETED' ? 'Finishing up…' : state === 'PROCESSING' ? 'Creating your photo…' : 'You are in line…'}</H1>
        <Muted>{state === 'FAILED' ? (mode === 'CLASSIC' ? 'Please try again.' : 'Any credit used is refunded automatically. Please try again.') : 'This can take up to a minute.'}</Muted>
      </div>
      {state === 'FAILED'
        ? <div className="flex w-[760px] gap-6"><KButton variant="secondary" icon={RotateCcw} onClick={reset} className="flex-1">Start over</KButton><KButton icon={Sparkles} className="flex-1" onClick={() => { setJob(null); try { sessionStorage.removeItem(JOB_KEY) } catch {} setError(''); setStep(uploads.length ? (mode === 'CLASSIC' ? 'camera' : 'style') : 'attract') }}>Try again</KButton></div>
        : <div role="progressbar" aria-label="Creating" className="h-3 w-[600px] overflow-hidden rounded-full bg-stage-surface-2"><div className="h-full w-1/3 animate-pulse rounded-full bg-stage-primary" /></div>}
      {poll.data?.credit_charge && poll.data.credit_charge.status !== 'PAID' && state !== 'FAILED' && <p className="text-2xl text-stage-muted">Confirming your credit…</p>}
    </div>{alert}</Screen>
  }
  else if (step === 'result' && resultId) body = <Screen gap="gap-14">{header('result')}
    <div className="flex gap-12">
      <div className="h-[780px] w-[520px] shrink-0 overflow-hidden rounded-[28px] bg-stage-surface"><img src={api.resultImageUrl(resultId)} alt="Your actual generated photo" className="h-full w-full object-contain" /></div>
      <div className="flex w-[384px] flex-col gap-7">
        <div className="rounded-2xl bg-white p-6">{claim ? <QRCode value={claim.qr_payload} size={300} /> : <div role="status" className="flex h-[300px] items-center justify-center text-2xl text-neutral-500">Preparing QR…</div>}</div>
        <p className="font-display text-[32px] font-semibold leading-[44px]">Scan to get your photo</p>
        {claim?.expires_at && <p className="flex items-center gap-3 text-2xl text-stage-muted"><Clock size={32} aria-hidden />Link works until {new Date(claim.expires_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</p>}
      </div>
    </div>
    <div className="flex flex-col gap-4"><H1>Your photo is ready</H1>{design?.name && <Muted>{design.name} · {mode[0] + mode.slice(1).toLowerCase()}</Muted>}</div>
    {alert}
    <div className="mt-auto flex flex-col gap-6">
      <div className="flex gap-6">
        <a href={api.resultDownloadUrl(resultId)} className="flex h-24 flex-1 items-center justify-center rounded-[20px] bg-stage-surface text-2xl font-semibold">Download</a>
        {result.data?.print_download_url && <a href={result.data.print_download_url} className="flex h-24 flex-1 items-center justify-center rounded-[20px] bg-stage-surface text-2xl font-semibold">Download print strip</a>}
      </div>
      <KButton icon={Check} onClick={reset}>Done</KButton>
    </div>
  </Screen>
  else if (step === 'mode') body = <Screen gap="gap-12">{header('mode')}
    <H1>What would you like to make?</H1>
    <div className="flex flex-col gap-10">
      {modeRows.map(m => <button key={m.id} type="button" aria-label={`${m.id.toUpperCase()} ${m.price === 'Free' ? 'Free' : '1 AI credit'}`} onClick={() => pick(m.id.toUpperCase() as Mode)} className="flex h-[244px] items-center gap-10 rounded-[28px] bg-stage-surface p-10 text-left active:opacity-80">
        <span className={cn('flex h-[140px] w-[140px] shrink-0 items-center justify-center rounded-[28px]', m.tile)}><m.icon size={72} aria-hidden /></span>
        <span className="flex min-w-0 flex-1 flex-col gap-3"><span className="font-display text-[42px] font-bold leading-[54px]">{m.name}</span><span className="text-2xl text-stage-muted">{m.blurb}</span><span className={cn('inline-flex h-12 w-fit items-center rounded-full px-5 text-xl font-semibold', m.chip)}>{m.price}</span></span>
        <ChevronRight size={56} className="shrink-0 text-stage-muted" aria-hidden />
      </button>)}
    </div>
    {typeof credits === 'number' && <p className="flex items-center gap-4 text-2xl text-stage-muted"><Sparkles size={36} aria-hidden />{credits} AI credit{credits === 1 ? '' : 's'} available</p>}
    {alert}
  </Screen>
  else if (step === 'style') body = <Screen>{header('style')}
    <H1>{mode === 'CLASSIC' ? 'Pick a layout' : 'Pick a style'}</H1>
    {catalog.loading && <Muted>Loading designs…</Muted>}
    {!catalog.loading && !designs.length && !catalog.error && <Muted>Nothing is published for this mode yet.</Muted>}
    <div className="grid min-h-0 flex-1 grid-cols-3 content-start gap-8 overflow-y-auto">
      {designs.map(r => { const on = design?.id === r.id; return <button key={r.id} type="button" aria-pressed={on} aria-label={r.name} onClick={() => { setDesign(r); setFrame('') }} className="flex flex-col gap-4 text-left">
        <span className={cn('relative block h-[444px] overflow-hidden rounded-3xl border-4 bg-stage-surface', on ? 'border-stage-primary' : 'border-transparent')}>
          <Thumb src={r.preview_url || r.thumbnail || undefined} missing={!r.preview_url && !r.thumbnail} alt="" className={cn('h-full w-full !rounded-none !bg-stage-surface !text-stage-muted', mode === 'CLASSIC' && '!object-contain')} />
          {on && <span className="absolute right-4 top-4 flex h-12 w-12 items-center justify-center rounded-full bg-stage-primary text-stage-bg"><Check size={28} aria-hidden /></span>}
        </span>
        <span className="text-2xl font-semibold">{r.name}</span>{mode === 'CLASSIC' && <span className="-mt-2 text-xl text-stage-muted">{r.shot_count} photo{r.shot_count === 1 ? '' : 's'}</span>}
      </button> })}
    </div>
    {mode === 'ADVANCED' && design && <div className="flex flex-wrap gap-3">{frames.map(r => <button key={r.id} type="button" aria-pressed={frame === r.id} className={cn('h-16 rounded-xl border px-6 text-xl', frame === r.id ? 'border-stage-primary text-stage-primary' : 'border-stage-border')} onClick={() => setFrame(r.id)}>{r.name}</button>)}</div>}
    {needsEvent && <label className="flex flex-col gap-3 text-2xl">Event name<input className="rounded-xl border border-stage-border bg-stage-surface p-5" maxLength={80} value={eventName} onChange={e => setEventName(e.target.value)} /></label>}
    {alert}
    {mode === 'CLASSIC'
      ? <KButton icon={Camera} disabled={!design || (needsEvent && !eventName.trim())} onClick={() => { setUploads([]); setStep('camera') }} className="self-end">Continue</KButton>
      : <div className="flex justify-between gap-6"><KButton variant="secondary" icon={RotateCcw} onClick={() => { setUploads([]); setStep('camera') }}>Retake photo</KButton><KButton icon={Sparkles} disabled={busy || !design || (mode === 'ADVANCED' && !frame) || (needsEvent && !eventName.trim())} onClick={generate}>{busy ? 'Submitting…' : 'Create my photo'}</KButton></div>}
  </Screen>
  else if (step === 'camera') body = <Screen>{header('camera')}
    {uploads.length < shots || !shots
      ? <Capture key="capture" index={uploads.length} total={shots || 1} upload={api.uploadPhoto} onUploaded={addUpload} />
      : <>
        <H1>Ready to create?</H1>
        <div className="flex flex-1 flex-wrap content-start justify-center gap-6 overflow-y-auto">{uploads.map((u, i) => <img key={u.upload_id} src={previewUrl(u)} alt={`Photo ${i + 1}`} className="h-[420px] rounded-2xl object-cover" />)}</div>
        <Muted>{design?.name} · {mode === 'CLASSIC' ? 'Classic is free.' : 'Uses 1 AI credit. Failed jobs are refunded automatically.'}</Muted>
        {alert}
        <div className="flex gap-6"><KButton variant="secondary" icon={RotateCcw} className="flex-1" onClick={() => setUploads([])}>Retake</KButton><KButton icon={Sparkles} className="flex-1" disabled={busy} onClick={generate}>{busy ? 'Submitting…' : 'Create my photo'}</KButton></div>
      </>}
  </Screen>
  else body = null

  return <Stage>{body}{idle && <IdleDialog seconds={idleLeft} onStay={() => { lastActivity.current = Date.now(); setIdle(false) }} />}</Stage>
}
