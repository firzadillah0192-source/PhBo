import React, { useEffect, useRef, useState } from 'react'
import ModeCards from '../home/ModeCards.jsx'
import ExperienceBrowser from './ExperienceBrowser.jsx'
import AdvancedOptionsStage from './AdvancedOptionsStage.jsx'
import ProcessingStage from './ProcessingStage.jsx'
import ResultStage from './ResultStage.jsx'
import { getKioskPhotoSession, claimKioskPhotos, getKioskCatalog, scopeKioskCatalog, getKioskJob, getKioskPhotoDelivery, generateKioskPhoto, kioskDelivery } from '../../nativeKioskApi.js'
import PrivateImage from './PrivateImage.jsx'
import { readKioskFlow, saveKioskFlow } from '../../kioskClaimSession.js'
import { startGenerationPolling } from '../../generationPolling.js'
import '../home/landing.css'
import './kioskClaim.css'

const empty = { mode: null,selectionId: null,frameStyleId: null,ornamentIds: [],photoIds: [],jobId: null,requestKey: null }

export default function KioskClaimPage({ code }) {
  const saved = useRef(readKioskFlow(code,window.sessionStorage)).current
  const [flow,setFlow] = useState(saved || empty)
  const [session,setSession] = useState(null)
  const [catalog,setCatalog] = useState(null)
  const [stage,setStage] = useState('loading')
  const [job,setJob] = useState(null)
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  const [retry,setRetry] = useState(0)
  const creating = useRef(false)

  useEffect(() => {
    let alive = true
    setError(''); setStage('loading')
    const load = async () => {
      let current
      try { current = await getKioskPhotoSession(code) }
      catch (failure) {
        const token = new URLSearchParams(window.location.hash.slice(1)).get('token')
        if (!token || ![401,403,404].includes(failure.status)) throw failure
        current = await claimKioskPhotos(code,token)
      }
      // The credential stays in an HttpOnly cookie. Remove the one-time claim
      // token from browser history after either a new claim or successful recovery.
      window.history.replaceState({},'',window.location.pathname + window.location.search)
      const published = scopeKioskCatalog(await getKioskCatalog(),current)
      if (!alive) return
      setSession(current); setCatalog(published)
      if (saved?.jobId) { setStage('processing'); return }
      if (saved?.mode) {
        const entries = saved.mode === 'CLASSIC' ? published.layouts : saved.mode === 'BASIC' ? published.templates : published.experiences
        const validPhotoIds = saved.photoIds.every(id => current.photos.some(photo => photo.id === id))
        const restoredSelection = entries.find(item => item.id === saved.selectionId)
        if (saved.selectionId && !entries.some(item => item.id === saved.selectionId) || !validPhotoIds) {
          setFlow({ ...empty,mode: saved.mode }); setError('Some saved choices are unavailable. Please choose again.')
        }
        const expectedCount = saved.mode === 'CLASSIC' ? restoredSelection?.shot_count : 1
        const restoredExperience = saved.mode === 'ADVANCED' ? restoredSelection : null
        const frameValid = saved.mode !== 'ADVANCED' || published.styles.some(item => item.id === saved.frameStyleId &&
          (!restoredExperience?.compatible_frame_style_ids || restoredExperience.compatible_frame_style_ids.includes(item.id)))
        const ornamentsValid = saved.mode !== 'ADVANCED' || saved.ornamentIds.length <= (restoredExperience?.max_ornaments ?? 3) && saved.ornamentIds.every(id => published.ornaments.some(item => item.id === id) &&
          (!restoredExperience?.compatible_ornament_ids || restoredExperience.compatible_ornament_ids.includes(id)))
        // A lost response must retain its key and original choices across refresh.
        setStage(restoredSelection && validPhotoIds && saved.photoIds.length === expectedCount && frameValid && ornamentsValid ? 'photos' : 'gallery')
      } else setStage('chooser')
    }
    load().catch(failure => { if (alive) { setError(failure.message); setStage('unavailable') } })
    return () => { alive = false }
  },[code,retry])

  useEffect(() => { if (flow.mode) saveKioskFlow(code,flow,window.sessionStorage) },[code,flow])
  useEffect(() => {
    if (stage !== 'processing' || !flow.jobId) return undefined
    return startGenerationPolling({ fetchStatus: async () => {
      const next = await getKioskJob(flow.jobId)
      return { ...next,state: next.status,result_id: next.resultId }
    },onStatus: next => {
      setJob(next)
      if (next.state === 'COMPLETED') { setStage('result'); getKioskPhotoSession(code).then(setSession).catch(() => {}) }
      if (next.state === 'FAILED') { setError(next.error || 'Creation failed. Your reserved session credit is returned.'); setStage('failed') }
    },onError: failure => { setError(failure.message); if ([401,403,404,410].includes(failure.status)) setStage('unavailable') } })
  },[code,flow.jobId,stage])

  const reset = () => { setFlow(empty); setJob(null); setError(''); setStage('chooser');
    try { window.sessionStorage.removeItem(`nxbooth:kiosk-photo:${code}`) } catch {}
    getKioskPhotoSession(code).then(setSession).catch(failure => { setError(failure.message); setStage('unavailable') })
  }
  const change = patch => setFlow(previous => ({ ...previous,...patch,requestKey: null,jobId: null }))
  const selected = (flow.mode === 'CLASSIC' ? catalog?.layouts : flow.mode === 'BASIC' ? catalog?.templates : catalog?.experiences)?.find(item => item.id === flow.selectionId)
  const count = flow.mode === 'CLASSIC' ? selected?.shot_count : 1
  const selectedPhotos = session?.photos.filter(photo => flow.photoIds.includes(photo.id)) || []
  const validPhotos = Boolean(count && flow.photoIds.length === count && selectedPhotos.length === count)
  const quotaEmpty = flow.mode !== 'CLASSIC' && session?.remainingGeneration === 0

  const generate = async () => {
    if (creating.current || !validPhotos || quotaEmpty) return
    creating.current = true; setBusy(true); setError('')
    const key = flow.requestKey || crypto.randomUUID()
    const current = { ...flow,requestKey: key }
    setFlow(current); saveKioskFlow(code,current,window.sessionStorage)
    try {
      const created = await generateKioskPhoto({ sessionCode: code,mode: flow.mode,photoIds: flow.photoIds,
        ...(flow.mode === 'CLASSIC' ? { frameId: flow.selectionId } : flow.mode === 'BASIC' ? { templateId: flow.selectionId }
          : { experienceId: flow.selectionId,frameStyleId: flow.frameStyleId,ornamentIds: flow.ornamentIds }) },key)
      setFlow(previous => ({ ...previous,jobId: created.id })); setJob({ ...created,state: created.status }); setStage('processing')
    } catch (failure) { setError(failure.message) }
    finally { creating.current = false; setBusy(false) }
  }

  return <div className="customer-app kiosk-claim-page" data-mood={stage === 'result' ? 'result' : 'gallery'}>
    <header className="kiosk-claim-nav"><a href="/">NXBooth</a><span>Photos from your photobooth session</span>{session && <small>{session.remainingGeneration} AI creations remaining · Classic is free</small>}</header>
    <main>
      {error && <div className="customer-notice" role="alert">{error}</div>}
      {stage === 'loading' && <section className="stage-heading" aria-live="polite"><h1>Opening your photographs…</h1></section>}
      {stage === 'unavailable' && <section className="stage-heading"><h1>This photo session is unavailable.</h1><button className="customer-solid-button" onClick={() => setRetry(value => value+1)}>Try again</button><a href="/">Back to NXBooth</a></section>}
      {stage === 'chooser' && <section className="gallery-page"><header className="gallery-heading"><h1>Choose how you want to create.</h1><p>Your photographs are ready.</p></header><ModeCards chooser modeIds={session.availableModes} onSelect={mode => { change({ ...empty,mode }); setStage('gallery') }} /></section>}
      {stage === 'gallery' && <><button className="customer-inline-button" onClick={reset}>← Change mode</button><ExperienceBrowser mode={flow.mode} templates={catalog.templates} experiences={catalog.experiences} layouts={catalog.layouts}
        selectedId={flow.selectionId} onSelect={selectionId => change({ selectionId })} onContinue={selectionId => {
          const targetId = selectionId || flow.selectionId
          const chosen = (flow.mode === 'CLASSIC' ? catalog.layouts : flow.mode === 'BASIC' ? catalog.templates : catalog.experiences).find(item => item.id === targetId)
          if (!chosen) return
          if (flow.mode === 'ADVANCED') { setStage('options'); return }
          change({ photoIds: session.photos.slice(0,flow.mode === 'CLASSIC' ? chosen.shot_count : 1).map(photo => photo.id) }); setStage('photos')
        }} /></>}
      {stage === 'options' && <AdvancedOptionsStage experience={selected} frameStyles={catalog.styles} ornaments={catalog.ornaments}
        frameStyleId={flow.frameStyleId} ornamentIds={flow.ornamentIds} onFrameStyle={frameStyleId => change({ frameStyleId })}
        onOrnaments={ornamentIds => change({ ornamentIds })} onBack={() => setStage('gallery')} onContinue={() => {
          change({ photoIds: session.photos.slice(0,1).map(photo => photo.id) }); setStage('photos')
        }} />}
      {stage === 'photos' && <section className="gallery-page"><header className="gallery-heading"><p className="customer-kicker">{selected?.name}</p><h1>Choose {count} {count === 1 ? 'photograph' : 'photographs'}.</h1><p>Photographs are placed in the order you select them.</p></header>
        <div className="kiosk-photo-grid">{session.photos.map(photo => <button disabled={busy} key={photo.id} className={flow.photoIds.includes(photo.id) ? 'is-selected' : ''}
          aria-pressed={flow.photoIds.includes(photo.id)} onClick={() => {
            const ids = flow.photoIds.includes(photo.id) ? flow.photoIds.filter(id => id !== photo.id) : count === 1 ? [photo.id] : flow.photoIds.length < count ? [...flow.photoIds,photo.id] : flow.photoIds
            change({ photoIds: ids })
          }}><PrivateImage id={photo.id} src={photo.imageUrl} resolve={getKioskPhotoDelivery} alt="Photobooth photograph" /><span>{flow.photoIds.includes(photo.id) ? `Selected · ${flow.photoIds.indexOf(photo.id)+1}` : 'Select photo'}</span></button>)}</div>
        {count > session.photos.length && <p role="alert">This frame needs {count} photographs. Choose a frame with fewer openings.</p>}
        {flow.mode === 'ADVANCED' && <div className="advanced-review-summary"><span>Experience: {selected?.name}</span><span>Frame style: {catalog.styles.find(item => item.id === flow.frameStyleId)?.name}</span><span>Ornaments: {flow.ornamentIds.length ? catalog.ornaments.filter(item => flow.ornamentIds.includes(item.id)).map(item => item.name).join(', ') : 'None'}</span></div>}
        <div className="selection-dock"><button className="customer-inline-button" disabled={busy} onClick={() => setStage(flow.mode === 'ADVANCED' ? 'options' : 'gallery')}>← Back</button>
          <span>{quotaEmpty ? 'No AI creations remaining. Classic is still available.' : `${flow.photoIds.length} / ${count} photos selected`}</span>
          <button className="customer-solid-button" disabled={busy || !validPhotos || quotaEmpty} onClick={generate}>{busy ? 'Starting…' : 'Generate'}</button></div>
      </section>}
      {stage === 'processing' && <ProcessingStage job={{ ...job,mode: flow.mode }} previewUrl={session?.photos.find(photo => photo.id === flow.photoIds[0])?.imageUrl} />}
      {stage === 'failed' && <section className="stage-heading"><h1>Let’s try another look.</h1><button className="customer-solid-button" onClick={reset}>Choose another look</button></section>}
      {stage === 'result' && job?.result_id && <ResultStage resultId={job.result_id} uploadId={flow.photoIds[0]} mode={flow.mode} delivery={kioskDelivery} onReset={reset} onTryLook={reset} />}
    </main>
  </div>
}
