import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  createGeneration,
  getAccountMe,
  getExperiences,
  getClassicLayouts,
  getFrameStyles,
  getOrnaments,
  getGeneration,
  getResult,
  getTemplates,
  getUpload,
  getUsage,
  startKioskSession,
  uploadPhoto,
} from './api.js'
import AdminPage from './AdminPage.jsx'
import CinematicHero from './components/home/CinematicHero.jsx'
import LandingPage from './components/home/LandingPage.jsx'
import CreationChooser from './components/home/CreationChooser.jsx'
import CustomerNav from './components/customer/CustomerNav.jsx'
import AccountCenter from './components/customer/AccountCenter.jsx'
import ProgressRail from './components/customer/ProgressRail.jsx'
import ExperienceBrowser from './components/customer/ExperienceBrowser.jsx'
import PhotoStage from './components/customer/PhotoStage.jsx'
import ClassicCaptureStage from './components/customer/ClassicCaptureStage.jsx'
import AdvancedOptionsStage from './components/customer/AdvancedOptionsStage.jsx'
import ReviewStage from './components/customer/ReviewStage.jsx'
import ProcessingStage from './components/customer/ProcessingStage.jsx'
import ResultStage from './components/customer/ResultStage.jsx'
import KioskResultStage from './components/customer/KioskResultStage.jsx'
import PublicResultPage from './components/customer/PublicResultPage.jsx'
import KioskClaimPage from './components/customer/KioskClaimPage.jsx'
import CelestialWorld from './components/world/CelestialWorld.jsx'
import { accountTabRoute, initialCustomerStage, kioskGenerationRoute, kioskModeRoute, kioskResultRoute, modeRoute, parseCustomerRoute } from './customerRoute.js'
import { clearCustomerFlow, readCustomerFlow, updateCustomerFlow } from './customerSession.js'
import { reconcileSelectedExperienceId } from './components/customer/experienceCatalog.js'
import { generationFailureAction, generationFailureActionLabel, generationFailureMessage } from './generationMessages.js'
import { startGenerationPolling } from './generationPolling.js'
import './customer.css'

function readRoute() {
  return parseCustomerRoute(window.location.pathname, window.location.search)
}

function navigate(path, replace = false) {
  if (window.location.pathname + window.location.search === path) return
  window.history[replace ? 'replaceState' : 'pushState']({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

function uploadFailureMessage(error) {
  if (error?.errorCode === 'UNSUPPORTED_IMAGE_FORMAT') return 'This image format is not supported. Choose a JPEG, PNG, WebP, HEIC, or HEIF photo.'
  if (error?.errorCode === 'IMAGE_DECODE_FAILED') return 'The selected photo could not be read. Choose another photo or save it as JPEG.'
  if (error?.errorCode === 'IMAGE_NORMALIZATION_FAILED') return 'We could not orient or prepare this photo. Choose another photo and try again.'
  if (error?.errorCode === 'UPLOAD_STORAGE_FAILED') return 'We could not temporarily save this photo. Please try again.'
  if (error?.errorCode === 'VALIDATION_FAILED') return error.message || 'The photo does not meet the size or dimension requirements.'
  return 'The photo could not be uploaded. Choose a JPEG, PNG, WebP, HEIC, or HEIF photo under 12 MB.'
}

export default function App() {
  const admin = window.location.pathname === '/admin' || window.location.pathname === '/admin/'
  const route = parseCustomerRoute(window.location.pathname, window.location.search)
  if (route.name === 'claim' && route.id) return <PublicResultPage token={route.id} />
  if (route.name === 'photo-claim' && route.id) return <KioskClaimPage code={route.id} />
  return admin ? <AdminPage /> : <CustomerApp />
}

function CustomerNotice({ message, onDismiss, onRetry }) {
  if (!message) return null
  return (
    <div className="customer-notice" role="alert">
      <span><strong>We hit a pause.</strong>{message}</span>
      <div>{onRetry && <button onClick={onRetry}>Try again</button>}<button onClick={onDismiss}>Dismiss</button></div>
    </div>
  )
}

function CustomerApp() {
  const initialRoute = useRef(readRoute()).current
  const initialFlow = useRef(readCustomerFlow()).current
  const [route, setRoute] = useState(initialRoute)
  const [stage, setStage] = useState(() => initialCustomerStage(initialRoute, initialFlow))
  const [mode, setMode] = useState(() => initialRoute.mode || (['generate', 'result'].includes(initialRoute.name) ? initialFlow?.mode : null) || null)
  const [templates, setTemplates] = useState([])
  const [experiences, setExperiences] = useState([])
  const [layouts, setLayouts] = useState([])
  const [frameStyles, setFrameStyles] = useState([])
  const [ornaments, setOrnaments] = useState([])
  const [selectedTemplateId, setSelectedTemplateId] = useState(initialFlow?.templateId || null)
  const [selectedExperienceId, setSelectedExperienceId] = useState(initialFlow?.experienceId || null)
  const [selectedLayoutId, setSelectedLayoutId] = useState(initialFlow?.layoutId || null)
  const [selectedFrameStyleId, setSelectedFrameStyleId] = useState(initialFlow?.frameStyleId || null)
  const [selectedOrnamentIds, setSelectedOrnamentIds] = useState(initialFlow?.ornamentIds || [])
  const [upload, setUpload] = useState(null)
  const [job, setJob] = useState(null)
  const [usage, setUsage] = useState(null)
  const [account, setAccount] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [catalogError, setCatalogError] = useState(false)
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [accountRequest, setAccountRequest] = useState(0)
  const [kioskResetSeconds, setKioskResetSeconds] = useState(90)
  const kioskMode = Boolean(route.kiosk)
  const marketingLanding = route.name === 'home' && !kioskMode
  const [hoverMode, setHoverMode] = useState(null)
  const pollRef = useRef(null)
  const catalogRequestRef = useRef(0)

  const refreshUsage = useCallback(async () => {
    try {
      const next = await getUsage()
      setUsage(next)
      if (next.authenticated) {
        try { setAccount(await getAccountMe()) } catch (accountError) { console.error('Account identity unavailable', accountError); setAccount(null) }
      } else {
        setAccount(null)
      }
      return next
    } catch (error) {
      console.error('Usage unavailable', error)
      setUsage(null)
      setAccount(null)
      return null
    }
  }, [])

  const loadCatalog = useCallback(async () => {
    const requestId = ++catalogRequestRef.current
    setCatalogLoading(true)
    setCatalogError(false)
    try {
      const [templateResponse, experienceResponse, nextLayouts, nextFrames, nextOrnaments] = await Promise.all([getTemplates(), getExperiences(), getClassicLayouts(), getFrameStyles(), getOrnaments()])
      if (requestId !== catalogRequestRef.current) return
      const nextTemplates = Array.isArray(templateResponse.templates) ? templateResponse.templates : []
      const nextExperiences = Array.isArray(experienceResponse.experiences) ? experienceResponse.experiences : []
      setTemplates(nextTemplates)
      setExperiences(nextExperiences)
      setLayouts(nextLayouts)
      setFrameStyles(nextFrames)
      setOrnaments(nextOrnaments)
      setSelectedLayoutId((current) => current && nextLayouts.some((item) => item.id === current) ? current : nextLayouts[0]?.id || null)
      setSelectedFrameStyleId((current) => current && nextFrames.some((item) => item.id === current) ? current : nextFrames.find((item) => item.id === 'natural')?.id || nextFrames[0]?.id || null)
      setSelectedOrnamentIds((current) => current.filter((id) => nextOrnaments.some((item) => item.id === id)))
      setSelectedTemplateId((current) => (
        current && nextTemplates.some((item) => item.id === current)
          ? current
          : nextTemplates[0]?.id || null
      ))
      setSelectedExperienceId((current) => reconcileSelectedExperienceId(current, nextExperiences))
    } catch (error) {
      if (requestId !== catalogRequestRef.current) return
      console.error('Studio catalog unavailable', error)
      setCatalogError(true)
    } finally {
      if (requestId === catalogRequestRef.current) setCatalogLoading(false)
    }
  }, [])

  const loadLandingCatalog = useCallback(async () => {
    const requestId = ++catalogRequestRef.current
    setCatalogLoading(true)
    const [templateResult, experienceResult, layoutResult] = await Promise.allSettled([getTemplates(), getExperiences(), getClassicLayouts()])
    if (requestId !== catalogRequestRef.current) return
    if (templateResult.status === 'fulfilled') setTemplates(templateResult.value?.templates || [])
    if (experienceResult.status === 'fulfilled') setExperiences(experienceResult.value?.experiences || [])
    if (layoutResult.status === 'fulfilled') setLayouts(layoutResult.value || [])
    // One preview source can remain useful while another catalog is unavailable.
    setCatalogError(templateResult.status === 'rejected' && experienceResult.status === 'rejected')
    setCatalogLoading(false)
  }, [])

  const markUploadUnavailable = useCallback(() => {
    setUpload(null)
    setStage('photo')
    setNotice('The uploaded photo is no longer available. Please upload it again.')
    updateCustomerFlow({ uploadId: null, jobId: null, resultId: null, stage: 'photo' })
  }, [])

  const restoreUpload = useCallback(async (targetRoute = route) => {
    const saved = readCustomerFlow()
    if (targetRoute.name !== 'create' || !targetRoute.mode || saved?.mode !== targetRoute.mode || !saved?.uploadId) {
      return
    }
    setStage('restoring')
    if (targetRoute.mode || saved.mode) setMode(targetRoute.mode || saved.mode)
    if (saved.templateId) setSelectedTemplateId(saved.templateId)
    if (saved.experienceId) setSelectedExperienceId(saved.experienceId)
    if (saved.layoutId) setSelectedLayoutId(saved.layoutId)
    if (saved.frameStyleId) setSelectedFrameStyleId(saved.frameStyleId)
    if (saved.ornamentIds) setSelectedOrnamentIds(saved.ornamentIds)
    try {
      const restored = await getUpload(saved.uploadId)
      setUpload(restored)
      const restoredStage = ['gallery', 'art-direction', 'photo', 'review'].includes(saved.stage) ? saved.stage : 'review'
      setStage(restoredStage)
      setNotice('')
      updateCustomerFlow({ stage: restoredStage })
    } catch (error) {
      if (error?.errorCode === 'UPLOAD_EXPIRED' || error?.errorCode === 'UPLOAD_NOT_FOUND' || error?.status === 404 || error?.status === 410) {
        markUploadUnavailable()
      } else {
        setStage('restore-failed')
        setNotice('We could not reconnect to your uploaded photo. Please try again.')
      }
    }
  }, [markUploadUnavailable, route])

  useEffect(() => {
    if (marketingLanding) loadLandingCatalog()
    else loadCatalog()
  }, [loadCatalog, loadLandingCatalog, marketingLanding])

  useEffect(() => {
    refreshUsage()
  }, [refreshUsage])

  useEffect(() => {
    if (route.name === 'create') restoreUpload(route)
  }, [route, restoreUpload])

  useEffect(() => {
    if (!kioskMode) return
    startKioskSession().then((data) => {
      if (data?.reset_after_seconds) setKioskResetSeconds(data.reset_after_seconds)
    }).catch(() => {})
  }, [kioskMode])

  useEffect(() => {
    const onPopState = () => {
      const next = readRoute()
      const saved = readCustomerFlow()
      pollRef.current?.()
      setBusy(false)
      setRoute(next)
      setMode(next.mode || (['generate', 'result'].includes(next.name) ? saved?.mode : null) || null)
      setStage(initialCustomerStage(next, saved))
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => () => pollRef.current?.(), [])

  const showStatus = useCallback((status, redirect = true) => {
    setJob(status)
    setMode(status.mode)
    if (status.layout_id) setSelectedLayoutId(status.layout_id)
    if (status.frame_style_id) setSelectedFrameStyleId(status.frame_style_id)
    if (status.ornament_ids) setSelectedOrnamentIds(status.ornament_ids)
    updateCustomerFlow({
      mode: status.mode,
      layoutId: status.layout_id || null,
      frameStyleId: status.frame_style_id || null,
      ornamentIds: status.ornament_ids || [],
      uploadId: status.upload_id || null,
      jobId: status.job_id,
      resultId: status.result_id || null,
      stage: status.state === 'COMPLETED' ? 'result' : status.state === 'FAILED' ? 'failed' : 'processing',
    })
    if (status.state === 'COMPLETED' && status.result_id) {
      pollRef.current?.()
      setBusy(false)
      setStage('result')
      refreshUsage()
      if (redirect) navigate(kioskMode ? kioskResultRoute(status.result_id) : '/result/' + encodeURIComponent(status.result_id), kioskMode)
    } else if (status.state === 'FAILED') {
      pollRef.current?.()
      setBusy(false)
      setStage('failed')
      setNotice(generationFailureMessage(status))
      refreshUsage()
    } else {
      setStage('processing')
    }
  }, [kioskMode, refreshUsage])

  useEffect(() => {
    let alive = true
    pollRef.current?.()
    if (route.name === 'generate' && route.id) {
      setBusy(true)
      pollRef.current = startGenerationPolling({
        fetchStatus: () => getGeneration(route.id),
        onStatus: (status) => { if (alive) { setNotice(''); showStatus(status) } },
        onError: (error) => {
          if (!alive) return
          setBusy(false)
          setNotice([401, 403, 404, 410].includes(error.status)
            ? 'This studio session is unavailable. Sign in to the same account or start a new creation.'
            : 'The studio connection was interrupted. We are reconnecting automatically; your generation will not be restarted.')
        },
      })
    } else if (route.name === 'result' && route.id) {
      setBusy(false)
      getResult(route.id).then((result) => getGeneration(result.job_id)).then((status) => {
        if (alive) showStatus(status, false)
      }).catch((error) => {
        console.error('Result reload failed', error)
        if (alive) setNotice('We could not reopen this finished portrait.')
      })
    } else {
      setBusy(false)
    }
    return () => { alive = false; pollRef.current?.() }
  }, [route, showStatus])

  const chooseMode = useCallback((nextMode) => {
    pollRef.current?.()
    setBusy(false)
    setMode(nextMode)
    setUpload(null)
    setJob(null)
    updateCustomerFlow({ mode: nextMode, uploadId: null, jobId: null, resultId: null, stage: 'gallery' })
    setNotice('')
    setStage('gallery')
    navigate(kioskMode ? kioskModeRoute(nextMode) : modeRoute(nextMode), kioskMode)
  }, [kioskMode])

  const home = useCallback(() => {
    pollRef.current?.()
    if (job?.result_id) window.sessionStorage.removeItem(`photobooth:result-claim:${job.result_id}`)
    setStage('home')
    setMode(null)
    setUpload(null)
    setJob(null)
    setSelectedTemplateId(null)
    setSelectedExperienceId(null)
    setSelectedLayoutId(null)
    setSelectedFrameStyleId(null)
    setSelectedOrnamentIds([])
    clearCustomerFlow()
    setBusy(false)
    setNotice('')
    if (kioskMode) startKioskSession(true).catch(() => {})
    navigate(kioskMode ? '/kiosk' : '/', kioskMode)
  }, [job?.result_id, kioskMode])

  const openAccount = useCallback((tab = 'overview') => {
    setMode(null)
    setStage('account')
    navigate(accountTabRoute(tab))
  }, [])

  const handleFile = useCallback(async (file) => {
    if (!file) return
    setBusy(true)
    setNotice('')
    try {
      const uploaded = await uploadPhoto(file)
      setUpload(uploaded)
      setStage('review')
      updateCustomerFlow({
        uploadId: uploaded.upload_id,
        mode,
        templateId: selectedTemplateId,
        experienceId: selectedExperienceId,
        frameStyleId: selectedFrameStyleId,
        ornamentIds: selectedOrnamentIds,
        jobId: null,
        resultId: null,
        stage: 'review',
      })
    } catch (error) {
      console.warn('Photo upload failed', { code: error?.errorCode || 'UNKNOWN', status: error?.status || null })
      setNotice(uploadFailureMessage(error))
    } finally {
      setBusy(false)
    }
  }, [mode, selectedExperienceId, selectedTemplateId, selectedFrameStyleId, selectedOrnamentIds])

  const create = useCallback(async () => {
    if (!upload) return
    setBusy(true)
    setNotice('')
    try {
      const created = mode === 'BASIC'
        ? await createGeneration(upload.upload_id, mode, selectedTemplateId)
        : await createGeneration(upload.upload_id, mode, null, selectedExperienceId, { frameStyleId: selectedFrameStyleId, ornamentIds: selectedOrnamentIds })
      setJob(created)
      setStage('processing')
      updateCustomerFlow({
        mode,
        uploadId: created.upload_id,
        templateId: selectedTemplateId,
        experienceId: selectedExperienceId,
        frameStyleId: selectedFrameStyleId,
        ornamentIds: selectedOrnamentIds,
        jobId: created.job_id,
        resultId: null,
        stage: 'processing',
      })
      navigate(kioskMode ? kioskGenerationRoute(created.job_id) : '/generate/' + encodeURIComponent(created.job_id), kioskMode)
      refreshUsage()
    } catch (error) {
      console.error('Generation could not start', error)
      setBusy(false)
      if (error?.errorCode === 'UPLOAD_NOT_FOUND' || error?.errorCode === 'UPLOAD_EXPIRED') {
        markUploadUnavailable()
      } else {
        setNotice(error?.status === 402 || error?.errorCode === 'AI_QUOTA_EXHAUSTED'
          ? 'Your complimentary AI credits have been used.'
          : 'We could not open the studio for this image. Please try again.')
      }
      refreshUsage()
    }
  }, [kioskMode, markUploadUnavailable, mode, refreshUsage, selectedExperienceId, selectedTemplateId, selectedFrameStyleId, selectedOrnamentIds, upload])

  const completeClassic = async (captures) => {
    setBusy(true)
    setNotice('')
    try {
      const first = captures[0]
      const ids = captures.map((item) => item.upload_id)
      setUpload(first)
      updateCustomerFlow({ mode: 'CLASSIC', layoutId: selectedLayoutId, uploadId: first.upload_id, captureUploadIds: ids, stage: 'processing' })
      const created = await createGeneration(first.upload_id, 'CLASSIC', null, null, { layoutId: selectedLayoutId, captureUploadIds: ids })
      setJob(created)
      setStage('processing')
      updateCustomerFlow({ jobId: created.job_id, stage: 'processing' })
      navigate(kioskMode ? kioskGenerationRoute(created.job_id) : '/generate/' + encodeURIComponent(created.job_id), kioskMode)
    } catch (error) {
      setBusy(false)
      setNotice(error?.message || 'Could not compose the Classic photo strip.')
      throw error
    }
  }

  const selection = mode === 'CLASSIC' ? layouts.find((item) => item.id === selectedLayoutId) : mode === 'BASIC'
    ? templates.find((item) => item.id === selectedTemplateId)
    : experiences.find((item) => item.id === selectedExperienceId)
  const selectedId = mode === 'CLASSIC' ? selectedLayoutId : mode === 'BASIC' ? selectedTemplateId : selectedExperienceId
  const quotaExhausted = mode === 'ADVANCED' && usage && usage.ai_remaining <= 0
  const retryFailed = () => {
    const action = generationFailureAction(job)
    if (action === 'upload-again') {
      markUploadUnavailable()
    } else if (action === 'choose-photo') {
      setStage('photo')
      updateCustomerFlow({ stage: 'photo' })
    } else {
      setStage('review')
      updateCustomerFlow({ stage: 'review' })
    }
  }

  const selectTemplate = (id) => {
    setSelectedTemplateId(id)
    updateCustomerFlow({ templateId: id })
  }
  const selectExperience = (id) => {
    setSelectedExperienceId(id)
    setSelectedFrameStyleId(null)
    setSelectedOrnamentIds([])
    updateCustomerFlow({ experienceId: id, frameStyleId: null, ornamentIds: [] })
  }
  const selectLayout = (id) => { setSelectedLayoutId(id); updateCustomerFlow({ layoutId: id }) }
  const selectFrameStyle = (id) => { setSelectedFrameStyleId(id); updateCustomerFlow({ frameStyleId: id }) }
  const selectOrnaments = (ids) => { setSelectedOrnamentIds(ids); updateCustomerFlow({ ornamentIds: ids }) }
  const moveToStage = (nextStage) => {
    setStage(nextStage)
    const differentMode = readCustomerFlow()?.mode !== mode
    updateCustomerFlow({
      mode, stage: nextStage,
      templateId: mode === 'BASIC' ? selectedTemplateId : null,
      experienceId: mode === 'ADVANCED' ? selectedExperienceId : null,
      layoutId: mode === 'CLASSIC' ? selectedLayoutId : null,
      frameStyleId: mode === 'ADVANCED' ? selectedFrameStyleId : null,
      ornamentIds: mode === 'ADVANCED' ? selectedOrnamentIds : [],
      ...(differentMode ? { uploadId: null, jobId: null, resultId: null, captureUploadIds: [] } : {}),
    })
  }
  const handleUploadPreviewError = async () => {
    if (!upload?.upload_id) return
    try {
      await getUpload(upload.upload_id)
      setNotice('We could not display your portrait just now. Please try again.')
    } catch (error) {
      if (error?.errorCode === 'UPLOAD_EXPIRED' || error?.errorCode === 'UPLOAD_NOT_FOUND' || error?.status === 404 || error?.status === 410) {
        markUploadUnavailable()
      } else {
        setNotice('We could not reconnect to your uploaded photo. Please try again.')
      }
    }
  }
  const retryRestoreUpload = () => restoreUpload(route)
  const mood = stage === 'home' ? 'home' : stage === 'account' ? 'account' : stage === 'chooser' || stage === 'gallery' || stage === 'art-direction' ? 'gallery' : stage === 'photo' ? 'capture' : stage === 'review' ? 'review' : stage === 'processing' || stage === 'failed' || stage === 'restoring' || stage === 'restore-failed' ? 'processing' : 'result'

  return (
    <div className={`customer-app ${stage === 'home' ? 'is-home' : ''} ${marketingLanding ? 'is-marketing' : ''}`} data-mood={mood}>
      {!marketingLanding && <CelestialWorld mood={mood} mode={mode} hoverMode={hoverMode} templates={templates} experiences={experiences} />}
      {!marketingLanding && <div className="customer-grain" aria-hidden="true" />}
      <CustomerNav marketing={marketingLanding} usage={usage} account={account} mode={mode} onHome={kioskMode ? home : () => navigate('/')} onMode={chooseMode} onUsageChanged={refreshUsage} onAccountNavigate={openAccount} openRequest={accountRequest} />
      {marketingLanding ? (
        <LandingPage templates={templates} experiences={experiences} layouts={layouts} loading={catalogLoading} error={catalogError} onRetry={loadLandingCatalog} />
      ) : stage === 'chooser' ? (
        <CreationChooser templates={templates} experiences={experiences} layouts={layouts} onSelect={chooseMode} savedFlow={readCustomerFlow()} />
      ) : stage === 'home' ? (
        <CinematicHero onSelect={chooseMode} onHoverMode={setHoverMode} />
      ) : (
        <>
          {stage !== 'account' && <ProgressRail stage={stage} />}
          <CustomerNotice message={notice} onDismiss={() => setNotice('')} onRetry={stage === 'processing' && job?.job_id ? () => startPolling(job.job_id) : stage === 'restore-failed' ? retryRestoreUpload : null} />
          <main className="customer-main">
            {stage === 'account' && <AccountCenter usage={usage} tab={route.tab} onTabChange={openAccount} onHome={home} onUsageChanged={refreshUsage} />}
            {stage === 'gallery' && <ExperienceBrowser mode={mode} templates={templates} experiences={experiences} layouts={layouts} selectedId={selectedId} onSelect={mode === 'CLASSIC' ? selectLayout : mode === 'BASIC' ? selectTemplate : selectExperience} onContinue={() => moveToStage(mode === 'ADVANCED' ? 'art-direction' : 'photo')} catalogError={catalogError} catalogLoading={catalogLoading} onRetry={loadCatalog} />}
            {stage === 'art-direction' && <AdvancedOptionsStage experience={selection} frameStyles={frameStyles} ornaments={ornaments} frameStyleId={selectedFrameStyleId} ornamentIds={selectedOrnamentIds} onFrameStyle={selectFrameStyle} onOrnaments={selectOrnaments} onBack={() => moveToStage('gallery')} onContinue={() => moveToStage(upload ? 'review' : 'photo')} />}
            {stage === 'photo' && (mode === 'CLASSIC' ? selection && <ClassicCaptureStage layout={selection} onComplete={completeClassic} onBack={() => moveToStage('gallery')} /> : <PhotoStage mode={mode} busy={busy} onFile={handleFile} onBack={() => moveToStage(mode === 'ADVANCED' ? 'art-direction' : 'gallery')} />)}
            {stage === 'review' && mode === 'CLASSIC' && upload && selection && <section className="customer-empty"><p className="customer-kicker">Classic photo strip</p><h1>Your captures are ready.</h1><p>{readCustomerFlow()?.captureUploadIds?.length || 0} of {selection.shot_count} photographs are saved in this session.</p><button className="customer-solid-button" disabled={busy || readCustomerFlow()?.captureUploadIds?.length !== selection.shot_count} onClick={() => completeClassic(readCustomerFlow().captureUploadIds.map((upload_id) => ({ upload_id })))}>Compose photo strip</button><button className="customer-inline-button" onClick={() => moveToStage('photo')}>Take photos again</button></section>}
            {stage === 'review' && mode !== 'CLASSIC' && upload && selection && <ReviewStage mode={mode} upload={upload} selection={selection} frameStyle={frameStyles.find((item) => item.id === selectedFrameStyleId)} ornaments={ornaments.filter((item) => selectedOrnamentIds.includes(item.id))} aiRemaining={usage?.ai_remaining} quotaExhausted={quotaExhausted} busy={busy} onReplace={() => moveToStage('photo')} onBack={() => moveToStage(mode === 'ADVANCED' ? 'art-direction' : 'gallery')} onCreate={create} onOpenAccount={() => setAccountRequest((value) => value + 1)} onPreviewError={handleUploadPreviewError} />}
            {stage === 'restoring' && <section className="customer-empty" role="status"><p className="customer-kicker">Reopening your studio</p><h1>Restoring your portrait…</h1><p>Your uploaded photo is being reconnected to this session.</p></section>}
            {stage === 'restore-failed' && <section className="customer-empty"><p className="customer-kicker">Studio connection paused</p><h1>Your portrait is still in this session.</h1><p>Reconnect to the saved upload to continue.</p><button className="customer-solid-button" onClick={retryRestoreUpload}>Reconnect portrait</button></section>}
            {stage === 'processing' && <ProcessingStage job={job} upload={upload} />}
            {stage === 'failed' && <section className="customer-empty"><p className="customer-kicker">Studio interrupted</p><h1>This portrait didn't make it through.</h1><p>{generationFailureMessage(job)}</p><button className="customer-solid-button" onClick={retryFailed}>{generationFailureActionLabel(job)}</button></section>}
            {stage === 'result' && job?.result_id && (kioskMode
              ? <KioskResultStage resultId={job.result_id} resetSeconds={kioskResetSeconds} onReset={home} />
              : <ResultStage resultId={job.result_id} uploadId={upload?.upload_id || job?.upload_id} mode={mode} onReset={home} onTryLook={() => { setUpload(null); updateCustomerFlow({ mode, uploadId: null, jobId: null, resultId: null, stage: 'gallery' }); setStage('gallery'); navigate('/create?mode=' + mode.toLowerCase()) }} />)}
          </main>
        </>
      )}
    </div>
  )
}
