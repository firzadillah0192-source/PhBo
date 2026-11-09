import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  createGeneration,
  getExperiences,
  getGeneration,
  getResult,
  getTemplates,
  getUsage,
  uploadPhoto,
} from './api.js'
import AdminPage from './AdminPage.jsx'
import CinematicHero from './components/home/CinematicHero.jsx'
import CustomerNav from './components/customer/CustomerNav.jsx'
import ProgressRail from './components/customer/ProgressRail.jsx'
import ExperienceBrowser from './components/customer/ExperienceBrowser.jsx'
import PhotoStage from './components/customer/PhotoStage.jsx'
import ReviewStage from './components/customer/ReviewStage.jsx'
import ProcessingStage from './components/customer/ProcessingStage.jsx'
import ResultStage from './components/customer/ResultStage.jsx'
import CelestialWorld from './components/world/CelestialWorld.jsx'
import { modeRoute, parseCustomerRoute, stageForRoute } from './customerRoute.js'
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

export default function App() {
  const admin = window.location.pathname === '/admin' || window.location.pathname === '/admin/'
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
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [catalogError, setCatalogError] = useState(false)
  const [accountRequest, setAccountRequest] = useState(0)
  const [hoverMode, setHoverMode] = useState(null)
  const pollRef = useRef(null)

  const refreshUsage = useCallback(async () => {
    try {
      const next = await getUsage()
      setUsage(next)
      return next
    } catch (error) {
      console.error('Usage unavailable', error)
      setUsage(null)
      return null
    }
  }, [])

  const loadCatalog = useCallback(async () => {
    setCatalogError(false)
    try {
      const [templateResponse, experienceResponse] = await Promise.all([getTemplates(), getExperiences()])
      const nextTemplates = templateResponse.templates || []
      const nextExperiences = experienceResponse.experiences || []
      setTemplates(nextTemplates)
      setExperiences(nextExperiences)
      setSelectedTemplateId((current) => current || nextTemplates[0]?.id || null)
      setSelectedExperienceId((current) => current || nextExperiences[0]?.id || null)
    } catch (error) {
      console.error('Studio catalog unavailable', error)
      setCatalogError(true)
    }
  }, [])

  useEffect(() => {
    loadCatalog()
    refreshUsage()
  }, [loadCatalog, refreshUsage])

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
      if (redirect) navigate('/result/' + encodeURIComponent(status.result_id))
    } else if (status.state === 'FAILED') {
      clearInterval(pollRef.current)
      setBusy(false)
      setStage('failed')
      setNotice('We could not finish that image. Your reserved AI credit has been returned.')
      refreshUsage()
    } else {
      setStage('processing')
    }
  }, [refreshUsage])

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
    navigate(modeRoute(nextMode))
  }, [])

  const home = useCallback(() => {
    clearInterval(pollRef.current)
    setStage('home')
    setMode(null)
    setUpload(null)
    setJob(null)
    setNotice('')
    navigate('/')
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
      navigate('/generate/' + encodeURIComponent(created.job_id))
      refreshUsage()
      startPolling(created.job_id)
    } catch (error) {
      console.error('Generation could not start', error)
      setBusy(false)
      setNotice(error?.status === 402 || error?.errorCode === 'AI_QUOTA_EXHAUSTED'
        ? 'Your complimentary AI credits have been used.'
        : 'We could not open the studio for this image. Please try again.')
      refreshUsage()
    }
  }, [mode, refreshUsage, selectedExperienceId, selectedTemplateId, startPolling, upload])

  const selection = mode === 'BASIC'
    ? templates.find((item) => item.id === selectedTemplateId)
    : experiences.find((item) => item.id === selectedExperienceId)
  const selectedId = mode === 'BASIC' ? selectedTemplateId : selectedExperienceId
  const quotaExhausted = mode === 'ADVANCED' && usage && usage.ai_remaining <= 0
  const mood = stage === 'home' ? 'home' : stage === 'gallery' ? 'gallery' : stage === 'photo' ? 'capture' : stage === 'review' ? 'review' : stage === 'processing' || stage === 'failed' ? 'processing' : 'result'

  return (
    <div className={`customer-app ${stage === 'home' ? 'is-home' : ''}`} data-mood={mood}>
      <CelestialWorld mood={mood} mode={mode} hoverMode={hoverMode} templates={templates} experiences={experiences} />
      <div className="customer-grain" aria-hidden="true" />
      <CustomerNav usage={usage} mode={mode} onHome={home} onMode={chooseMode} onUsageChanged={refreshUsage} openRequest={accountRequest} />
      {stage === 'home' ? (
        <CinematicHero onSelect={chooseMode} onHoverMode={setHoverMode} />
      ) : (
        <>
          <ProgressRail stage={stage} />
          <CustomerNotice message={notice} onDismiss={() => setNotice('')} onRetry={stage === 'processing' && job?.job_id ? () => startPolling(job.job_id) : null} />
          <main className="customer-main">
            {stage === 'gallery' && <ExperienceBrowser mode={mode} templates={templates} experiences={experiences} selectedId={selectedId} onSelect={mode === 'BASIC' ? setSelectedTemplateId : setSelectedExperienceId} onContinue={() => setStage('photo')} catalogError={catalogError} onRetry={loadCatalog} />}
            {stage === 'photo' && <PhotoStage mode={mode} busy={busy} onFile={handleFile} onBack={() => setStage('gallery')} />}
            {stage === 'review' && upload && selection && <ReviewStage mode={mode} upload={upload} selection={selection} aiRemaining={usage?.ai_remaining} quotaExhausted={quotaExhausted} busy={busy} onReplace={() => setStage('photo')} onBack={() => setStage('gallery')} onCreate={create} onOpenAccount={() => setAccountRequest((value) => value + 1)} />}
            {stage === 'processing' && <ProcessingStage job={job} upload={upload} />}
            {stage === 'failed' && <section className="customer-empty"><p className="customer-kicker">Studio interrupted</p><h1>This portrait didn't make it through.</h1><p>Your reserved AI credit was returned.</p><button className="customer-solid-button" onClick={() => setStage('review')}>Try again</button></section>}
            {stage === 'result' && job?.result_id && <ResultStage resultId={job.result_id} uploadId={upload?.upload_id || job?.upload_id} onReset={home} onTryLook={() => { setUpload(null); setStage('gallery'); navigate('/create?mode=' + mode.toLowerCase()) }} />}
          </main>
        </>
      )}
    </div>
  )
}
