import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  createGeneration,
  getAccountMe,
  getExperiences,
  getGeneration,
  getResult,
  getTemplates,
  getUsage,
  startKioskSession,
  uploadPhoto,
} from './api.js'
import AdminPage from './AdminPage.jsx'
import CinematicHero from './components/home/CinematicHero.jsx'
import CustomerNav from './components/customer/CustomerNav.jsx'
import AccountCenter from './components/customer/AccountCenter.jsx'
import ProgressRail from './components/customer/ProgressRail.jsx'
import ExperienceBrowser from './components/customer/ExperienceBrowser.jsx'
import PhotoStage from './components/customer/PhotoStage.jsx'
import ReviewStage from './components/customer/ReviewStage.jsx'
import ProcessingStage from './components/customer/ProcessingStage.jsx'
import ResultStage from './components/customer/ResultStage.jsx'
import KioskResultStage from './components/customer/KioskResultStage.jsx'
import PublicResultPage from './components/customer/PublicResultPage.jsx'
import CelestialWorld from './components/world/CelestialWorld.jsx'
import { accountTabRoute, kioskGenerationRoute, kioskModeRoute, kioskResultRoute, modeRoute, parseCustomerRoute, stageForRoute } from './customerRoute.js'
import { reconcileSelectedExperienceId } from './components/customer/experienceCatalog.js'
import './customer.css'

const POLL_INTERVAL_MS = 1500

function readRoute() {
  return parseCustomerRoute(window.location.pathname, window.location.search)
}

function navigate(path, replace = false) {
  if (window.location.pathname + window.location.search === path) return
  window.history[replace ? 'replaceState' : 'pushState']({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

function generationFailureMessage(job) {
  if (job?.error_code === 'UPLOAD_NOT_FOUND') return 'The uploaded photo is no longer available. Please upload it again.'
  if (job?.mode === 'BASIC') return 'The Basic studio could not finish this portrait. No AI credit was used.'
  return 'We could not finish that image. Your reserved AI credit was returned.'
}

export default function App() {
  const admin = window.location.pathname === '/admin' || window.location.pathname === '/admin/'
  const route = parseCustomerRoute(window.location.pathname, window.location.search)
  if (route.name === 'claim' && route.id) return <PublicResultPage token={route.id} />
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
  const [route, setRoute] = useState(initialRoute)
  const [stage, setStage] = useState(() => stageForRoute(initialRoute))
  const [mode, setMode] = useState(() => initialRoute.mode)
  const [templates, setTemplates] = useState([])
  const [experiences, setExperiences] = useState([])
  const [selectedTemplateId, setSelectedTemplateId] = useState(null)
  const [selectedExperienceId, setSelectedExperienceId] = useState(null)
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
  const [hoverMode, setHoverMode] = useState(null)
  const pollRef = useRef(null)

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
    setCatalogLoading(true)
    setCatalogError(false)
    try {
      const [templateResponse, experienceResponse] = await Promise.all([getTemplates(), getExperiences()])
      const nextTemplates = Array.isArray(templateResponse.templates) ? templateResponse.templates : []
      const nextExperiences = Array.isArray(experienceResponse.experiences) ? experienceResponse.experiences : []
      setTemplates(nextTemplates)
      setExperiences(nextExperiences)
      setSelectedTemplateId((current) => (
        current && nextTemplates.some((item) => item.id === current)
          ? current
          : nextTemplates[0]?.id || null
      ))
      setSelectedExperienceId((current) => reconcileSelectedExperienceId(current, nextExperiences))
    } catch (error) {
      console.error('Studio catalog unavailable', error)
      setCatalogError(true)
    } finally {
      setCatalogLoading(false)
    }
  }, [])

  useEffect(() => {
    loadCatalog()
    refreshUsage()
  }, [loadCatalog, refreshUsage])

  useEffect(() => {
    if (!kioskMode) return
    startKioskSession().then((data) => {
      if (data?.reset_after_seconds) setKioskResetSeconds(data.reset_after_seconds)
    }).catch(() => {})
  }, [kioskMode])

  useEffect(() => {
    const onPopState = () => {
      const next = readRoute()
      setRoute(next)
      setMode(next.mode)
      setStage(stageForRoute(next))
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => () => clearInterval(pollRef.current), [])

  const showStatus = useCallback((status, redirect = true) => {
    setJob(status)
    setMode(status.mode)
    if (status.state === 'COMPLETED' && status.result_id) {
      clearInterval(pollRef.current)
      setBusy(false)
      setStage('result')
      refreshUsage()
      if (redirect) navigate(kioskMode ? kioskResultRoute(status.result_id) : '/result/' + encodeURIComponent(status.result_id), kioskMode)
    } else if (status.state === 'FAILED') {
      clearInterval(pollRef.current)
      setBusy(false)
      setStage('failed')
      setNotice(generationFailureMessage(status))
      refreshUsage()
    } else {
      setStage('processing')
    }
  }, [kioskMode, refreshUsage])

  const pollOnce = useCallback(async (jobId, redirect = true) => {
    try {
      const status = await getGeneration(jobId)
      showStatus(status, redirect)
    } catch (error) {
      console.error('Generation status unavailable', error)
      clearInterval(pollRef.current)
      setBusy(false)
      setNotice('We could not reconnect to your studio session. Try again in a moment.')
    }
  }, [showStatus])

  const startPolling = useCallback((jobId) => {
    clearInterval(pollRef.current)
    pollOnce(jobId)
    pollRef.current = window.setInterval(() => pollOnce(jobId), POLL_INTERVAL_MS)
  }, [pollOnce])

  useEffect(() => {
    let alive = true
    clearInterval(pollRef.current)
    if (route.name === 'generate' && route.id) {
      setBusy(true)
      getGeneration(route.id).then((status) => {
        if (!alive) return
        showStatus(status, false)
        if (status.state === 'QUEUED' || status.state === 'PROCESSING') startPolling(route.id)
      }).catch((error) => {
        console.error('Generation reload failed', error)
        if (alive) { setBusy(false); setNotice('We could not reopen this studio session.') }
      })
    } else if (route.name === 'result' && route.id) {
      getResult(route.id).then((result) => getGeneration(result.job_id)).then((status) => {
        if (alive) showStatus(status, false)
      }).catch((error) => {
        console.error('Result reload failed', error)
        if (alive) setNotice('We could not reopen this finished portrait.')
      })
    }
    return () => { alive = false }
  }, [route, showStatus, startPolling])

  const chooseMode = useCallback((nextMode) => {
    setMode(nextMode)
    setUpload(null)
    setJob(null)
    setNotice('')
    setStage('gallery')
    navigate(kioskMode ? kioskModeRoute(nextMode) : modeRoute(nextMode), kioskMode)
  }, [kioskMode])

  const home = useCallback(() => {
    clearInterval(pollRef.current)
    if (job?.result_id) window.sessionStorage.removeItem(`photobooth:result-claim:${job.result_id}`)
    setStage('home')
    setMode(null)
    setUpload(null)
    setJob(null)
    setSelectedTemplateId(null)
    setSelectedExperienceId(null)
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
      setUpload(await uploadPhoto(file))
      setStage('review')
    } catch (error) {
      console.error('Photo upload failed', error)
      setNotice('That photo could not be prepared. Try a JPEG, PNG, or WebP under 12 MB.')
    } finally {
      setBusy(false)
    }
  }, [])

  const create = useCallback(async () => {
    if (!upload) return
    setBusy(true)
    setNotice('')
    try {
      const created = mode === 'BASIC'
        ? await createGeneration(upload.upload_id, mode, selectedTemplateId)
        : await createGeneration(upload.upload_id, mode, null, selectedExperienceId)
      setJob(created)
      setStage('processing')
      navigate(kioskMode ? kioskGenerationRoute(created.job_id) : '/generate/' + encodeURIComponent(created.job_id), kioskMode)
      refreshUsage()
      startPolling(created.job_id)
    } catch (error) {
      console.error('Generation could not start', error)
      setBusy(false)
      if (error?.errorCode === 'UPLOAD_NOT_FOUND') {
        setUpload(null)
        setStage('photo')
        setNotice('The uploaded photo is no longer available. Please upload it again.')
      } else {
        setNotice(error?.status === 402 || error?.errorCode === 'AI_QUOTA_EXHAUSTED'
          ? 'Your complimentary AI credits have been used.'
          : 'We could not open the studio for this image. Please try again.')
      }
      refreshUsage()
    }
  }, [kioskMode, mode, refreshUsage, selectedExperienceId, selectedTemplateId, startPolling, upload])

  const selection = mode === 'BASIC'
    ? templates.find((item) => item.id === selectedTemplateId)
    : experiences.find((item) => item.id === selectedExperienceId)
  const selectedId = mode === 'BASIC' ? selectedTemplateId : selectedExperienceId
  const quotaExhausted = mode === 'ADVANCED' && usage && usage.ai_remaining <= 0
  const retryFailed = () => {
    if (job?.error_code === 'UPLOAD_NOT_FOUND') {
      setUpload(null)
      setStage('photo')
    } else {
      setStage('review')
    }
  }
  const mood = stage === 'home' ? 'home' : stage === 'account' ? 'account' : stage === 'gallery' ? 'gallery' : stage === 'photo' ? 'capture' : stage === 'review' ? 'review' : stage === 'processing' || stage === 'failed' ? 'processing' : 'result'

  return (
    <div className={`customer-app ${stage === 'home' ? 'is-home' : ''}`} data-mood={mood}>
      <CelestialWorld mood={mood} mode={mode} hoverMode={hoverMode} templates={templates} experiences={experiences} />
      <div className="customer-grain" aria-hidden="true" />
      <CustomerNav usage={usage} account={account} mode={mode} onHome={home} onMode={chooseMode} onUsageChanged={refreshUsage} onAccountNavigate={openAccount} openRequest={accountRequest} />
      {stage === 'home' ? (
        <CinematicHero onSelect={chooseMode} onHoverMode={setHoverMode} />
      ) : (
        <>
          {stage !== 'account' && <ProgressRail stage={stage} />}
          <CustomerNotice message={notice} onDismiss={() => setNotice('')} onRetry={stage === 'processing' && job?.job_id ? () => startPolling(job.job_id) : null} />
          <main className="customer-main">
            {stage === 'account' && <AccountCenter usage={usage} tab={route.tab} onTabChange={openAccount} onHome={home} onUsageChanged={refreshUsage} />}
            {stage === 'gallery' && <ExperienceBrowser mode={mode} templates={templates} experiences={experiences} selectedId={selectedId} onSelect={mode === 'BASIC' ? setSelectedTemplateId : setSelectedExperienceId} onContinue={() => setStage('photo')} catalogError={catalogError} catalogLoading={catalogLoading} onRetry={loadCatalog} />}
            {stage === 'photo' && <PhotoStage mode={mode} busy={busy} onFile={handleFile} onBack={() => setStage('gallery')} />}
            {stage === 'review' && upload && selection && <ReviewStage mode={mode} upload={upload} selection={selection} aiRemaining={usage?.ai_remaining} quotaExhausted={quotaExhausted} busy={busy} onReplace={() => setStage('photo')} onBack={() => setStage('gallery')} onCreate={create} onOpenAccount={() => setAccountRequest((value) => value + 1)} />}
            {stage === 'processing' && <ProcessingStage job={job} upload={upload} />}
            {stage === 'failed' && <section className="customer-empty"><p className="customer-kicker">Studio interrupted</p><h1>This portrait didn't make it through.</h1><p>{generationFailureMessage(job)}</p><button className="customer-solid-button" onClick={retryFailed}>{job?.error_code === 'UPLOAD_NOT_FOUND' ? 'Upload again' : 'Try again'}</button></section>}
            {stage === 'result' && job?.result_id && (kioskMode
              ? <KioskResultStage resultId={job.result_id} resetSeconds={kioskResetSeconds} onReset={home} />
              : <ResultStage resultId={job.result_id} uploadId={upload?.upload_id || job?.upload_id} onReset={home} onTryLook={() => { setUpload(null); setStage('gallery'); navigate('/create?mode=' + mode.toLowerCase()) }} />)}
          </main>
        </>
      )}
    </div>
  )
}
