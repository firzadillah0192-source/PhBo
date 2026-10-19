import { DeveloperDocs } from './components/customer/DeveloperApi.jsx'
import { FolderDestination, SharedFolderPage } from './components/customer/PhotoFolders.jsx'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  createGeneration,
  getAccountMe,
  getPhotoFolders,
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
import StudioRail from './components/customer/StudioRail.jsx'
import ModePickerModal from './components/customer/ModePickerModal.jsx'
import CreditTopUpModal from './components/customer/CreditTopUpModal.jsx'
import { MODE_NAMES } from './creditCatalog.js'
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
import { getLanguage, tr, useT } from './i18n.js'
import { recordStudioStep, restoredStudioStep } from './studioHistory.js'
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
  if (error?.errorCode === 'UNSUPPORTED_IMAGE_FORMAT') return tr('Format gambar ini tidak didukung. Pilih foto JPEG, PNG, WebP, HEIC, atau HEIF.', 'This image format is not supported. Choose a JPEG, PNG, WebP, HEIC, or HEIF photo.')
  if (error?.errorCode === 'IMAGE_DECODE_FAILED') return tr('Foto yang dipilih tidak bisa dibaca. Pilih foto lain atau simpan sebagai JPEG.', 'The selected photo could not be read. Choose another photo or save it as JPEG.')
  if (error?.errorCode === 'IMAGE_NORMALIZATION_FAILED') return tr('Kami tidak bisa mengatur orientasi atau menyiapkan foto ini. Pilih foto lain dan coba lagi.', 'We could not orient or prepare this photo. Choose another photo and try again.')
  if (error?.errorCode === 'UPLOAD_STORAGE_FAILED') return tr('Kami tidak bisa menyimpan foto ini sementara. Silakan coba lagi.', 'We could not temporarily save this photo. Please try again.')
  if (error?.errorCode === 'VALIDATION_FAILED') return error.message || tr('Foto tidak memenuhi syarat ukuran atau dimensi.', 'The photo does not meet the size or dimension requirements.')
  return tr('Foto tidak bisa diunggah. Pilih foto JPEG, PNG, WebP, HEIC, atau HEIF di bawah 12 MB.', 'The photo could not be uploaded. Choose a JPEG, PNG, WebP, HEIC, or HEIF photo under 12 MB.')
}

export default function App() {
  const admin = window.location.pathname === '/admin' || window.location.pathname === '/admin/'
  const route = parseCustomerRoute(window.location.pathname, window.location.search)
  if (route.name === 'developers') return <DeveloperDocs />
  if (route.name === 'folder-share' && route.id) return <SharedFolderPage token={route.id} />
  if (route.name === 'claim' && route.id) return <PublicResultPage token={route.id} />
  if (route.name === 'photo-claim' && route.id) return <KioskClaimPage code={route.id} />
  return admin ? <AdminPage /> : <CustomerApp />
}

function CustomerNotice({ message, onDismiss, onRetry }) {
  const t = useT()
  if (!message) return null
  return (
    <div className="customer-notice" role="alert">
      <span><strong>{t('Ada kendala. ', 'We hit a pause. ')}</strong>{message}</span>
      <div>{onRetry && <button onClick={onRetry}>{t('Coba lagi', 'Try again')}</button>}<button onClick={onDismiss}>{t('Tutup', 'Dismiss')}</button></div>
    </div>
  )
}

function CustomerApp() {
  const t = useT()
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
  const [eventName, setEventName] = useState(initialFlow?.eventName || '')
  const [selectedExperienceId, setSelectedExperienceId] = useState(initialFlow?.experienceId || null)
  const [selectedLayoutId, setSelectedLayoutId] = useState(initialFlow?.layoutId || null)
  const [selectedFrameStyleId, setSelectedFrameStyleId] = useState(initialFlow?.frameStyleId || null)
  const [selectedOrnamentIds, setSelectedOrnamentIds] = useState(initialFlow?.ornamentIds || [])
  const [upload, setUpload] = useState(null)
  const [job, setJob] = useState(null)
  const [usage, setUsage] = useState(null)
  const [folderCatalog,setFolderCatalog]=useState([]),[folderId,setFolderId]=useState(null),[folderLoading,setFolderLoading]=useState(false),[folderError,setFolderError]=useState(''),[folderRevision,setFolderRevision]=useState(0)
  const [aiLane, setAiLane] = useState('standard')
  useEffect(() => { if (usage?.subscription && !usage.subscription.plan.premium) setAiLane('standard') }, [usage?.subscription?.plan?.premium])
  const [account, setAccount] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [catalogError, setCatalogError] = useState(false)
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [accountRequest, setAccountRequest] = useState(0)
  const [creditPopup, setCreditPopup] = useState(false)
  const [quotaDenied, setQuotaDenied] = useState(false)
  const [kioskResetSeconds, setKioskResetSeconds] = useState(90)
  const kioskMode = Boolean(route.kiosk)
  const folderEnabled=Boolean(usage?.photo_folders_enabled && usage?.authenticated && !kioskMode)
  const folderBlocked=folderEnabled && (folderLoading || Boolean(folderError))
  useEffect(()=>{
    let active=true
    setFolderCatalog([]);setFolderId(null);setFolderError('')
    if(!folderEnabled){setFolderLoading(false);return}
    setFolderLoading(true)
    getPhotoFolders().then(data=>{if(active){setFolderCatalog(data.folders);setFolderId(data.default_folder_id)}}).catch(e=>{if(active)setFolderError(e.message||tr('Folder belum dapat dimuat.','Folders could not be loaded.'))}).finally(()=>{if(active)setFolderLoading(false)})
    return ()=>{active=false}
  },[folderEnabled,account?.id,folderRevision])
  const marketingLanding = route.name === 'home' && !kioskMode
  const [hoverMode, setHoverMode] = useState(null)
  const pollRef = useRef(null)
  const catalogRequestRef = useRef(0)
  const uploadRequestRef = useRef(0)
  const restoreRequestRef = useRef(0)

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
    const heading = document.querySelector('#studio-main h1, #studio-main h2')
    if (heading) {
      heading.setAttribute('tabindex', '-1')
      heading.focus({ preventScroll: true })
    }
  }, [stage, route.name, mode])

  const refreshUsage = useCallback(async () => {
    try {
      const next = await getUsage()
      setUsage(next)
      if (next.subscription || next.ai_remaining >= 10) setQuotaDenied(false)
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
    setNotice(tr('Foto yang diunggah sudah tidak tersedia. Silakan unggah lagi.', 'The uploaded photo is no longer available. Please upload it again.'))
    updateCustomerFlow({ uploadId: null, jobId: null, resultId: null, stage: 'photo' })
  }, [])

  const restoreUpload = useCallback(async (targetRoute = route) => {
    const saved = readCustomerFlow()
    if (targetRoute.name !== 'create' || !targetRoute.mode || saved?.mode !== targetRoute.mode || !saved?.uploadId) {
      return
    }
    const request = ++restoreRequestRef.current
    setStage('restoring')
    if (targetRoute.mode || saved.mode) setMode(targetRoute.mode || saved.mode)
    if (saved.templateId) setSelectedTemplateId(saved.templateId)
    if (saved.eventName) setEventName(saved.eventName)
    if (saved.experienceId) setSelectedExperienceId(saved.experienceId)
    if (saved.layoutId) setSelectedLayoutId(saved.layoutId)
    if (saved.frameStyleId) setSelectedFrameStyleId(saved.frameStyleId)
    if (saved.ornamentIds) setSelectedOrnamentIds(saved.ornamentIds)
    try {
      const restored = await getUpload(saved.uploadId)
      if (request !== restoreRequestRef.current) return
      setUpload(restored)
      const restoredStage = ['gallery', 'art-direction', 'photo', 'review'].includes(saved.stage) ? saved.stage : 'review'
      setStage(restoredStage)
      setNotice('')
      updateCustomerFlow({ stage: restoredStage })
    } catch (error) {
      if (request !== restoreRequestRef.current) return
      if (error?.errorCode === 'UPLOAD_EXPIRED' || error?.errorCode === 'UPLOAD_NOT_FOUND' || error?.status === 404 || error?.status === 410) {
        markUploadUnavailable()
      } else {
        setStage('restore-failed')
        setNotice(tr('Kami tidak bisa menyambungkan kembali foto yang diunggah. Silakan coba lagi.', 'We could not reconnect to your uploaded photo. Please try again.'))
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
    const onPopState = (event) => {
      uploadRequestRef.current += 1
      restoreRequestRef.current += 1
      const next = readRoute()
      const historyStage = next.name === 'create' && restoredStudioStep(event.state, next.mode)
      if (historyStage && readCustomerFlow()?.mode === next.mode) updateCustomerFlow({ stage: historyStage })
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
    } else if (status.state === 'COMPLETED' && status.credit_charge && status.credit_charge.status !== 'PAID') {
      pollRef.current?.(); setBusy(false); setStage('billing-pending'); refreshUsage();
      if (status.credit_charge.status === 'NEEDS_TOP_UP') setCreditPopup(true)
    } else if (status.state === 'FAILED') {
      pollRef.current?.()
      setBusy(false)
      setStage('failed')
      setNotice(generationFailureMessage(status, getLanguage()))
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
            ? tr('Sesi studio ini tidak tersedia. Masuk ke akun yang sama atau mulai kreasi baru.', 'This studio session is unavailable. Sign in to the same account or start a new creation.')
            : tr('Koneksi studio terputus. Kami menyambung ulang otomatis; proses Anda tidak akan diulang.', 'The studio connection was interrupted. We are reconnecting automatically; your generation will not be restarted.'))
        },
      })
    } else if (route.name === 'result' && route.id) {
      setBusy(false)
      getResult(route.id).then((result) => getGeneration(result.job_id)).then((status) => {
        if (alive) showStatus(status, false)
      }).catch((error) => {
        console.error('Result reload failed', error)
        if (alive) setNotice(tr('Kami tidak bisa membuka kembali potret jadi ini.', 'We could not reopen this finished portrait.'))
      })
    } else {
      setBusy(false)
    }
    return () => { alive = false; pollRef.current?.() }
  }, [route, showStatus])

  const chooseMode = useCallback((nextMode) => {
    pollRef.current?.()
    setBusy(false)
    setQuotaDenied(false)
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

  const openCreditOptions = useCallback(() => { setCreditPopup(true) }, [])

  const handleFile = useCallback(async (file) => {
    if (!file) return
    const request = ++uploadRequestRef.current
    setBusy(true)
    setNotice('')
    try {
      const uploaded = await uploadPhoto(file)
      if (request !== uploadRequestRef.current) return
      if (!kioskMode) recordStudioStep(window.history, mode, 'photo', 'review')
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
      if (request !== uploadRequestRef.current) return
      console.warn('Photo upload failed', { code: error?.errorCode || 'UNKNOWN', status: error?.status || null })
      setNotice(uploadFailureMessage(error))
    } finally {
      if (request === uploadRequestRef.current) setBusy(false)
    }
  }, [mode, kioskMode, selectedExperienceId, selectedTemplateId, selectedFrameStyleId, selectedOrnamentIds])

  const create = useCallback(async () => {
    if (!upload || folderBlocked) return
    if (mode !== 'CLASSIC' && (quotaDenied || usage?.ai_remaining < (usage?.subscription ? (aiLane === 'fast' ? 100 : 50) : 10))) {
      openCreditOptions()
      return
    }
    setBusy(true)
    setNotice('')
    try {
      const created = mode === 'BASIC'
        ? await createGeneration(upload.upload_id, mode, selectedTemplateId, null, { ...(folderEnabled?{folderId}:{}), eventName: eventName.trim(), ...(usage?.subscription ? { lane: aiLane } : {}) })
        : await createGeneration(upload.upload_id, mode, null, selectedExperienceId, { frameStyleId: selectedFrameStyleId, ornamentIds: selectedOrnamentIds, ...(folderEnabled?{folderId}:{}), eventName: eventName.trim(), ...(usage?.subscription ? { lane: aiLane } : {}) })
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
      } else if (error?.status === 402 || ['AI_QUOTA_EXHAUSTED','CREDIT_BALANCE_EXHAUSTED'].includes(error?.errorCode)) {
        const latestUsage = await refreshUsage()
        const authenticated = latestUsage?.authenticated ?? usage?.authenticated
        setQuotaDenied(true)
        setNotice(authenticated
          ? tr('Kredit Anda belum cukup. Isi kredit untuk melanjutkan berkarya.', 'Your credits are not enough. Add credits to keep creating.')
          : tr('Kredit AI tamu Anda sudah habis. Masuk atau buat akun untuk melanjutkan.', 'Your guest AI credits have run out. Sign in or create an account to continue.'))
        openCreditOptions(authenticated)
        return
      } else if (['CREDIT_USAGE_UNAVAILABLE','GENERATION_IN_PROGRESS','STORAGE_QUOTA_EXCEEDED','AI_PROVIDER_NOT_CONNECTED','SUBSCRIPTION_REQUIRED','GENERATION_LANE_UNAVAILABLE'].includes(error?.errorCode)) {
        setNotice(error.message)
      } else {
        setNotice(tr('Kami tidak bisa membuka studio untuk gambar ini. Silakan coba lagi.', 'We could not open the studio for this image. Please try again.'))
      }
      refreshUsage()
    }
  }, [kioskMode, markUploadUnavailable, mode, openCreditOptions, quotaDenied, refreshUsage, selectedExperienceId, selectedTemplateId, selectedFrameStyleId, selectedOrnamentIds, eventName, upload, usage, aiLane, folderEnabled, folderId, folderBlocked])

  const completeClassic = async (captures) => {
    if(folderBlocked){setNotice(folderError||tr('Tunggu folder selesai dimuat.','Wait for the folders to finish loading.'));return}
    if (usage?.subscription && usage.subscription.classic.daily_remaining < 1) {
      const first = captures[0]; setUpload(first);
      updateCustomerFlow({ mode: 'CLASSIC', layoutId: selectedLayoutId, uploadId: first.upload_id, captureUploadIds: captures.map(item => item.upload_id), stage: 'review' });
      setStage('review'); setNotice(tr('Batas Classic hari ini tercapai. Kuota harian reset pukul 00.00 WIB.', 'Today’s Classic limit is reached. The daily quota resets at 00:00 WIB.')); return;
    }
    if ((usage?.subscription ? usage.subscription.classic.remaining < 10 || usage.subscription.classic.daily_remaining < 1 : usage?.ai_remaining < 1) || quotaDenied) {
      const first = captures[0]; setUpload(first);
      updateCustomerFlow({ mode: 'CLASSIC', layoutId: selectedLayoutId, uploadId: first.upload_id, captureUploadIds: captures.map(item => item.upload_id), stage: 'review' });
      setStage('review'); openCreditOptions(); return
    }
    setBusy(true)
    setNotice('')
    try {
      const first = captures[0]
      const ids = captures.map((item) => item.upload_id)
      setUpload(first)
      updateCustomerFlow({ mode: 'CLASSIC', layoutId: selectedLayoutId, uploadId: first.upload_id, captureUploadIds: ids, stage: 'processing' })
      const flow = readCustomerFlow()
      const needsEventName = layouts.find(item => item.id === selectedLayoutId)?.requires_event_name
      const created = await createGeneration(first.upload_id, 'CLASSIC', null, null, { layoutId: selectedLayoutId, captureUploadIds: ids, ...(folderEnabled?{folderId}:{}), ...(needsEventName && flow?.classicEventLayoutId === selectedLayoutId ? { eventName: flow.classicEventName, capturedAt: flow.classicCapturedAt } : {}) })
      setJob(created)
      setStage('processing')
      updateCustomerFlow({ jobId: created.job_id, stage: 'processing' })
      navigate(kioskMode ? kioskGenerationRoute(created.job_id) : '/generate/' + encodeURIComponent(created.job_id), kioskMode)
      refreshUsage()
    } catch (error) {
      setBusy(false)
      setNotice(error?.message || tr('Photo Booth belum bisa disusun.', 'Could not compose the Photo Booth.'))
      throw error
    }
  }

  const selection = mode === 'CLASSIC' ? layouts.find((item) => item.id === selectedLayoutId) : mode === 'BASIC'
    ? templates.find((item) => item.id === selectedTemplateId)
    : experiences.find((item) => item.id === selectedExperienceId)
  const selectedId = mode === 'CLASSIC' ? selectedLayoutId : mode === 'BASIC' ? selectedTemplateId : selectedExperienceId
  const quotaExhausted = quotaDenied || Boolean(usage && (usage.subscription ? (mode === 'CLASSIC' ? usage.subscription.classic.remaining < 10 || usage.subscription.classic.daily_remaining < 1 : usage.ai_remaining < (aiLane === 'fast' ? 100 : 50)) : usage.ai_remaining < (mode === 'CLASSIC' ? 1 : 10)))
  const railCredit = usage ? (mode === 'CLASSIC'
    ? (usage.subscription ? { label: t('Classic Credit', 'Classic Credit'), value: usage.subscription.classic.remaining.toLocaleString(), note: t('10 kredit per hasil', '10 credits per result') } : { label: t('Kredit', 'Credits'), value: String(usage.ai_remaining), note: t('1 kredit per hasil', '1 credit per result') })
    : { label: usage.subscription ? 'AI Credit' : t('Kredit', 'Credits'), value: usage.ai_remaining.toLocaleString(), note: usage.subscription ? t(`${aiLane === 'fast' ? 100 : 50} kredit per hasil`, `${aiLane === 'fast' ? 100 : 50} credits per result`) : t('Min. 10 kredit per hasil', 'Min. 10 credits per result') }) : null
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
    if (!id) return
    setSelectedTemplateId(id)
    moveToStage(upload ? 'review' : 'photo', { templateId: id })
  }
  const selectExperience = (id) => {
    if (!id) return
    setSelectedExperienceId(id)
    setSelectedFrameStyleId(null)
    setSelectedOrnamentIds([])
    moveToStage('art-direction', { experienceId: id, frameStyleId: null, ornamentIds: [] })
  }
  const selectLayout = (id) => { if (!id) return; setSelectedLayoutId(id); moveToStage('photo', { layoutId: id }) }
  const selectFrameStyle = (id) => { setSelectedFrameStyleId(id); updateCustomerFlow({ frameStyleId: id }) }
  const selectOrnaments = (ids) => { setSelectedOrnamentIds(ids); updateCustomerFlow({ ornamentIds: ids }) }
  const moveToStage = (nextStage, selectionPatch = {}) => {
    if (!kioskMode) recordStudioStep(window.history, mode, stage, nextStage)
    setStage(nextStage)
    window.scrollTo({ top: 0, behavior: 'auto' })
    const differentMode = readCustomerFlow()?.mode !== mode
    updateCustomerFlow({
      mode, stage: nextStage,
      templateId: mode === 'BASIC' ? selectedTemplateId : null,
      experienceId: mode === 'ADVANCED' ? selectedExperienceId : null,
      layoutId: mode === 'CLASSIC' ? selectedLayoutId : null,
      frameStyleId: mode === 'ADVANCED' ? selectedFrameStyleId : null,
      ornamentIds: mode === 'ADVANCED' ? selectedOrnamentIds : [],
      ...(differentMode ? { uploadId: null, jobId: null, resultId: null, captureUploadIds: [] } : {}),
      ...selectionPatch,
    })
  }
  const handleUploadPreviewError = async () => {
    if (!upload?.upload_id) return
    try {
      await getUpload(upload.upload_id)
      setNotice(tr('Kami tidak bisa menampilkan potret Anda saat ini. Silakan coba lagi.', 'We could not display your portrait just now. Please try again.'))
    } catch (error) {
      if (error?.errorCode === 'UPLOAD_EXPIRED' || error?.errorCode === 'UPLOAD_NOT_FOUND' || error?.status === 404 || error?.status === 410) {
        markUploadUnavailable()
      } else {
        setNotice(tr('Kami tidak bisa menyambungkan kembali foto yang diunggah. Silakan coba lagi.', 'We could not reconnect to your uploaded photo. Please try again.'))
      }
    }
  }
  const retryRestoreUpload = () => restoreUpload(route)
  const mood = stage === 'home' ? 'home' : stage === 'account' ? 'account' : stage === 'chooser' || stage === 'gallery' || stage === 'art-direction' ? 'gallery' : stage === 'photo' ? 'capture' : stage === 'review' ? 'review' : stage === 'processing' || stage === 'failed' || stage === 'restoring' || stage === 'restore-failed' ? 'processing' : 'result'

  return (
    <div className={`customer-app ${!kioskMode ? 'retro-app' : ''} ${stage === 'home' ? 'is-home' : ''} ${marketingLanding ? 'is-marketing' : ''}`} data-mood={mood}>
      {!kioskMode && <a className="studio-skip" href="#studio-main">{t('Lewati ke konten', 'Skip to content')}</a>}
      {kioskMode && <CelestialWorld mood={mood} mode={mode} hoverMode={hoverMode} templates={templates} experiences={experiences} />}
      <CustomerNav marketing={marketingLanding} usage={usage} account={account} mode={mode} onHome={kioskMode ? home : () => navigate('/')} onMode={chooseMode} onUsageChanged={refreshUsage} onAccountNavigate={openAccount} openRequest={accountRequest} />
      {marketingLanding ? (
        <LandingPage templates={templates} experiences={experiences} layouts={layouts} loading={catalogLoading} error={catalogError} onRetry={loadLandingCatalog} />
      ) : stage === 'chooser' ? (
        <CreationChooser templates={templates} experiences={experiences} layouts={layouts} onSelect={chooseMode} savedFlow={readCustomerFlow()} />
      ) : stage === 'home' ? (
        <CinematicHero onSelect={chooseMode} onHoverMode={setHoverMode} />
      ) : (
        <>
          <div className={`studio-shell ${stage === 'account' ? 'is-account' : ''}`}>
          {stage !== 'account' && <StudioRail stage={stage} modeName={mode ? MODE_NAMES[mode] : null} selectionName={stage === 'gallery' ? null : selection?.name} frameStyleName={mode === 'ADVANCED' ? frameStyles.find((item) => item.id === selectedFrameStyleId)?.name : null} ornamentCount={mode === 'ADVANCED' ? selectedOrnamentIds.length : 0} hasPhoto={Boolean(upload)} credit={railCredit} folderSlot={folderEnabled && ['photo','review'].includes(stage) ? <FolderDestination folders={folderCatalog} value={folderId} onChange={setFolderId} loading={folderLoading} error={folderError} onRetry={()=>setFolderRevision(v=>v+1)} disabled={busy} /> : null} />}
          <div className="studio-content">
          <CustomerNotice message={notice} onDismiss={() => setNotice('')} onRetry={stage === 'processing' && job?.job_id ? () => startPolling(job.job_id) : stage === 'restore-failed' ? retryRestoreUpload : null} />
          <main id="studio-main" className="customer-main" tabIndex="-1">
            {stage === 'gallery' && !kioskMode && <><CreationChooser templates={templates} experiences={experiences} layouts={layouts} onSelect={chooseMode} savedFlow={readCustomerFlow()} /><ModePickerModal key={mode} mode={mode} templates={templates} experiences={experiences} layouts={layouts} selectedId={selectedId} onSelect={mode === 'CLASSIC' ? selectLayout : mode === 'BASIC' ? selectTemplate : selectExperience} loading={catalogLoading} error={catalogError} onRetry={loadCatalog} onBack={() => navigate('/create')} onClose={() => navigate('/')} /></>}
            {stage === 'gallery' && kioskMode && <ExperienceBrowser mode={mode} templates={templates} experiences={experiences} layouts={layouts} selectedId={selectedId} onSelect={mode === 'CLASSIC' ? selectLayout : mode === 'BASIC' ? selectTemplate : selectExperience} catalogError={catalogError} catalogLoading={catalogLoading} onRetry={loadCatalog} />}
            {stage === 'account' && <AccountCenter usage={usage} tab={route.tab} onTabChange={openAccount} onHome={home} onUsageChanged={refreshUsage} />}
            {stage === 'art-direction' && <AdvancedOptionsStage experience={selection} frameStyles={frameStyles} ornaments={ornaments} frameStyleId={selectedFrameStyleId} ornamentIds={selectedOrnamentIds} onFrameStyle={selectFrameStyle} onOrnaments={selectOrnaments} onBack={() => moveToStage('gallery')} onContinue={() => moveToStage(upload ? 'review' : 'photo')} />}
            {stage === 'photo' && (mode === 'CLASSIC' ? selection && <ClassicCaptureStage layout={selection} onComplete={completeClassic} onBack={() => moveToStage('gallery')} /> : <PhotoStage mode={mode} busy={busy} onFile={handleFile} onBack={() => moveToStage(mode === 'ADVANCED' ? 'art-direction' : 'gallery')} />)}
            {stage === 'review' && mode === 'CLASSIC' && upload && selection && <section className="customer-empty"><p className="customer-kicker">Photo Booth</p><h1>{t('Foto Anda sudah siap.', 'Your captures are ready.')}</h1><p>{t(`${readCustomerFlow()?.captureUploadIds?.length || 0} dari ${selection.shot_count} foto tersimpan di sesi ini.`, `${readCustomerFlow()?.captureUploadIds?.length || 0} of ${selection.shot_count} photographs are saved in this session.`)}</p><button className="customer-solid-button" disabled={busy || readCustomerFlow()?.captureUploadIds?.length !== selection.shot_count} onClick={() => completeClassic(readCustomerFlow().captureUploadIds.map((upload_id) => ({ upload_id })))}>{usage?.subscription ? t(`Susun strip foto · 10 Classic Credit · sisa harian ${usage.subscription.classic.daily_remaining}`, `Compose photo strip · 10 Classic Credit · ${usage.subscription.classic.daily_remaining} left today`) : quotaExhausted ? t('Tambah kredit · perlu 1 kredit', 'Add credits · 1 credit needed') : t('Susun strip foto · 1 kredit', 'Compose photo strip · 1 credit')}</button><button className="customer-inline-button" onClick={() => moveToStage('photo')}>{t('Ambil foto lagi', 'Take photos again')}</button></section>}
            {stage === 'review' && mode !== 'CLASSIC' && upload && selection && <ReviewStage subscription={usage?.subscription} apiRoutes={usage?.api_routes} aiLane={aiLane} onAiLane={setAiLane} mode={mode} upload={upload} selection={selection} frameStyle={frameStyles.find((item) => item.id === selectedFrameStyleId)} ornaments={ornaments.filter((item) => selectedOrnamentIds.includes(item.id))} aiRemaining={usage?.ai_remaining} authenticated={Boolean(usage?.authenticated)} quotaExhausted={quotaExhausted} busy={busy || folderBlocked} onReplace={() => moveToStage('photo')} onBack={() => moveToStage(mode === 'ADVANCED' ? 'art-direction' : 'gallery')} onCreate={create} onOpenAccount={() => openCreditOptions()} onPreviewError={handleUploadPreviewError} />}
            {stage === 'restoring' && <section className="customer-empty" role="status"><p className="customer-kicker">{t('Membuka kembali studio Anda', 'Reopening your studio')}</p><h1>{t('Memulihkan potret Anda…', 'Restoring your portrait…')}</h1><p>{t('Foto yang Anda unggah sedang disambungkan kembali ke sesi ini.', 'Your uploaded photo is being reconnected to this session.')}</p></section>}
            {stage === 'restore-failed' && <section className="customer-empty"><p className="customer-kicker">{t('Koneksi studio terjeda', 'Studio connection paused')}</p><h1>{t('Potret Anda masih ada di sesi ini.', 'Your portrait is still in this session.')}</h1><p>{t('Sambungkan kembali ke unggahan tersimpan untuk melanjutkan.', 'Reconnect to the saved upload to continue.')}</p><button className="customer-solid-button" onClick={retryRestoreUpload}>{t('Sambungkan potret', 'Reconnect portrait')}</button></section>}
            {stage === 'processing' && <ProcessingStage job={job} upload={upload} />}
            {stage === 'billing-pending' && <section className="customer-empty"><p className="customer-kicker">{t('Hasil sudah dibuat', 'Result created')}</p><h1>{job?.credit_charge?.status === 'NEEDS_TOP_UP' ? t('Tambah kredit untuk membuka hasil.', 'Add credits to unlock the result.') : t('Menunggu rincian pemakaian.', 'Waiting for usage details.')}</h1><p>{job?.credit_charge?.credits ? t(`Hasil ini membutuhkan ${job.credit_charge.credits} kredit. Saldo belum dipotong.`, `This result needs ${job.credit_charge.credits} credits. Your balance has not been charged.`) : t('Provider belum mengirim rincian token yang diperlukan. Kredit belum dipotong; hasil tersimpan.', 'The provider has not sent the required token details. No credits were charged; the result is saved.')}</p>{job?.credit_charge?.status === 'NEEDS_TOP_UP' && <button className="customer-solid-button" onClick={openCreditOptions}>{t('Tambah kredit', 'Add credits')}</button>}<button className="customer-outline-button" onClick={() => startPolling(job.job_id)}>{t('Periksa kembali', 'Check again')}</button></section>}
            {stage === 'failed' && <section className="customer-empty"><p className="customer-kicker">{t('Studio terhenti', 'Studio interrupted')}</p><h1>{t('Potret ini belum berhasil dibuat.', 'This portrait didn’t make it through.')}</h1><p>{generationFailureMessage(job, getLanguage())}</p><button className="customer-solid-button" onClick={retryFailed}>{generationFailureActionLabel(job, getLanguage())}</button></section>}
            {stage === 'result' && job?.result_id && (kioskMode
              ? <KioskResultStage resultId={job.result_id} resetSeconds={kioskResetSeconds} onReset={home} />
              : <ResultStage chargedCurrency={job.credit_charge?.calculation?.currency} chargeEstimated={job.credit_charge?.calculation?.estimated} chargedCredits={job.credit_charge?.credits} resultId={job.result_id} uploadId={upload?.upload_id || job?.upload_id} mode={mode} onReset={home} onTryLook={() => { setUpload(null); updateCustomerFlow({ mode, uploadId: null, jobId: null, resultId: null, stage: 'gallery' }); setStage('gallery'); navigate('/create?mode=' + mode.toLowerCase()) }} />)}
          </main>
          </div>
          </div>
        </>
      )}
      {creditPopup && <CreditTopUpModal currency={usage?.subscription && mode === 'CLASSIC' ? 'CLASSIC' : 'AI'} usage={usage} required={job?.credit_charge?.status === 'NEEDS_TOP_UP' ? job.credit_charge.credits : usage?.subscription ? mode === 'CLASSIC' ? 10 : aiLane === 'fast' ? 100 : 50 : mode === 'CLASSIC' ? 1 : 10} onClose={() => setCreditPopup(false)} onSignIn={() => { setCreditPopup(false); setAccountRequest(value => value + 1) }} />}
    </div>
  )
}
