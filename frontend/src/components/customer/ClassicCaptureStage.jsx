import React, { useEffect, useRef, useState } from 'react'
import { uploadPhoto } from '../../api.js'
import { CLASSIC_RETAKE_LIMIT, CLASSIC_REVIEW_SECONDS, runClassicCaptureSequence } from '../../classicSequence.js'
import { cameraFailureMessage, requestPortraitCamera } from '../../cameraAccess.js'
import { readCustomerFlow, updateCustomerFlow } from '../../customerSession.js'
import { CatalogImage } from '../home/ModeCards.jsx'
import { getLanguage, useT } from '../../i18n.js'

const delay = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms))

export default function ClassicCaptureStage({ layout, onComplete, onBack }) {
  const t = useT()
  const saved = readCustomerFlow()
  const sameSession = saved?.mode === 'CLASSIC' && saved.classicCaptureLayoutId === layout.id
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const runRef = useRef(0)
  const mountedRef = useRef(false)
  const runningRef = useRef(false)
  const openingRef = useRef(false)
  const reviewRef = useRef(null)
  const inputRef = useRef(null)
  const uploadsRef = useRef(sameSession ? (saved.captureUploadIds || []).slice(0, layout.shot_count).map((upload_id) => ({ upload_id })) : [])
  const retakesRef = useRef(sameSession && Number.isInteger(saved.classicRetakesRemaining) ? saved.classicRetakesRemaining : CLASSIC_RETAKE_LIMIT)
  const [camera, setCamera] = useState(false)
  const [opening, setOpening] = useState(false)
  const [ready, setReady] = useState(false)
  const [previewBlocked, setPreviewBlocked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState('idle')
  const [countdown, setCountdown] = useState(null)
  const [completed, setCompleted] = useState(uploadsRef.current.length)
  const [retakes, setRetakes] = useState(retakesRef.current)
  const [reviewPhoto, setReviewPhoto] = useState(null)
  const [reviewSeconds, setReviewSeconds] = useState(CLASSIC_REVIEW_SECONDS)
  const [message, setMessage] = useState('')
  const [eventName, setEventName] = useState(saved?.classicEventLayoutId === layout.id ? saved.classicEventName || '' : '')
  const eventReady = !layout.requires_event_name || (eventName.trim().length > 0 && !/[\p{Cc}\p{Cf}]/u.test(eventName))
  const [eventConfirmed, setEventConfirmed] = useState(!layout.requires_event_name || (sameSession && uploadsRef.current.length > 0 && eventReady))

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCamera(false)
    setReady(false)
  }
  const finishReview = (decision) => {
    const pending = reviewRef.current
    if (!pending || (decision === 'retake' && retakesRef.current === 0)) return
    reviewRef.current = null
    window.clearInterval(pending.timer)
    URL.revokeObjectURL(pending.url)
    if (mountedRef.current) setReviewPhoto(null)
    pending.resolve(decision)
  }
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      runRef.current += 1
      finishReview('cancel')
      streamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])
  const playPreview = async () => {
    const video = videoRef.current
    const stream = streamRef.current
    if (!video || !stream) return
    video.srcObject = stream
    try {
      await video.play()
      if (!mountedRef.current || stream !== streamRef.current) return
      setReady(video.videoWidth > 0)
      setPreviewBlocked(false)
      setMessage('')
    } catch {
      if (!mountedRef.current || stream !== streamRef.current) return
      setPreviewBlocked(true)
      setMessage(t('Pratinjau kamera terjeda. Ketuk Lanjutkan pratinjau untuk melanjutkan.', 'Camera preview paused. Tap Resume preview to continue.'))
    }
  }
  useEffect(() => { if (camera) playPreview() }, [camera])
  const openCamera = async () => {
    if (!eventReady) { setMessage(t('Isi nama event sebelum mengambil foto.', 'Enter the event name before taking photos.')); return }
    if (openingRef.current || runningRef.current) return
    openingRef.current = true
    setOpening(true)
    setMessage('')
    const run = runRef.current
    try {
      const stream = await requestPortraitCamera()
      if (!mountedRef.current || run !== runRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      streamRef.current = stream
      setCamera(true)
    } catch (error) {
      if (mountedRef.current && run === runRef.current) setMessage(cameraFailureMessage(error, getLanguage()))
    } finally {
      openingRef.current = false
      if (mountedRef.current) setOpening(false)
    }
  }
  const capture = () => new Promise((resolve, reject) => {
    const video = videoRef.current
    if (!video?.videoWidth || !video?.videoHeight) { reject(new Error('Camera is not ready')); return }
    if (!uploadsRef.current.length) updateCustomerFlow({ classicCapturedAt: new Date().toISOString() })
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext('2d')
    if (!context) { reject(new Error('Photo capture is unavailable')); return }
    context.translate(canvas.width, 0)
    context.scale(-1, 1)
    context.drawImage(video, 0, 0)
    canvas.toBlob((blob) => blob ? resolve(new File([blob], 'classic-capture.jpg', { type: 'image/jpeg' })) : reject(new Error('Could not capture photo')), 'image/jpeg', .93)
  })
  const persist = () => updateCustomerFlow({ mode: 'CLASSIC', layoutId: layout.id, classicCaptureLayoutId: layout.id, classicRetakesRemaining: retakesRef.current, captureUploadIds: uploadsRef.current.map((item) => item.upload_id), stage: 'photo' })
  const review = (file, shot) => new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    setPhase('review')
    setReviewPhoto({ url, shot })
    setReviewSeconds(CLASSIC_REVIEW_SECONDS)
    let seconds = CLASSIC_REVIEW_SECONDS
    const timer = window.setInterval(() => {
      seconds -= 1
      setReviewSeconds(seconds)
      if (seconds === 0) finishReview('next')
    }, 1000)
    reviewRef.current = { resolve, timer, url }
  })
  const runCapture = async () => {
    if (!eventReady) return
    if (runningRef.current || (uploadsRef.current.length < layout.shot_count && !ready)) return
    runningRef.current = true
    const run = ++runRef.current
    setBusy(true)
    setMessage('')
    persist()
    try {
      const uploads = await runClassicCaptureSequence(layout.shot_count, {
        tick: async (count) => { setPhase('countdown'); setCountdown(count); await delay(1000) },
        capture: async () => { setCountdown(null); return capture() },
        review,
        retakesRemaining: retakesRef.current,
        initialUploads: uploadsRef.current,
        onRetake: (remaining) => { retakesRef.current = remaining; setRetakes(remaining); persist() },
        upload: async (file) => { setPhase('uploading'); return uploadPhoto(file) },
        pause: () => delay(700),
        progress: (count, total, accepted) => { uploadsRef.current = [...accepted]; setCompleted(count); persist() },
        active: () => mountedRef.current && run === runRef.current,
      })
      if (!uploads) return
      setPhase('composing')
      stopCamera()
      await onComplete(uploads)
      updateCustomerFlow({ classicCaptureLayoutId: null, classicRetakesRemaining: null })
    } catch (error) {
      if (mountedRef.current && run === runRef.current) {
        setMessage(error?.message || t('Rangkaian foto belum bisa diselesaikan. Silakan coba lagi.', 'Could not complete the photo sequence. Please try again.'))
        setBusy(false)
        setPhase('idle')
        setCountdown(null)
      }
    } finally { runningRef.current = false }
  }
  const uploadSet = async (files) => {
    if (!eventReady) { setMessage(t('Isi nama event terlebih dahulu.', 'Enter the event name first.')); return }
    if (runningRef.current) return
    const chosen = Array.from(files || [])
    if (!chosen.length) return
    if (chosen.length !== layout.shot_count) { setMessage(t('Pilih tepat ' + layout.shot_count + ' foto untuk tata letak ini.', 'Choose exactly ' + layout.shot_count + ' photographs for this layout.')); return }
    updateCustomerFlow({ classicCapturedAt: new Date().toISOString() })
    runningRef.current = true
    const run = ++runRef.current
    setBusy(true)
    setPhase('uploading')
    setMessage('')
    stopCamera()
    try {
      const uploads = []
      for (const file of chosen) {
        const uploaded = await uploadPhoto(file)
        if (!mountedRef.current || run !== runRef.current) return
        uploads.push(uploaded)
        setCompleted(uploads.length)
      }
      setPhase('composing')
      await onComplete(uploads)
      updateCustomerFlow({ classicCaptureLayoutId: null, classicRetakesRemaining: null })
    } catch (error) {
      if (mountedRef.current) { setMessage(error?.message || t('Foto belum bisa diunggah. Silakan coba lagi.', 'Could not upload the photographs. Please try again.')); setBusy(false); setPhase('idle') }
    } finally { runningRef.current = false }
  }
  if (!eventConfirmed) return (
    <section className="photo-stage classic-capture classic-event-stage customer-stage-enter">
      <nav className="capture-navigation" aria-label={t('Navigasi Photo Booth', 'Photo Booth navigation')}><button className="customer-inline-button" onClick={onBack}>← {t('Ganti bingkai', 'Change frame')}</button></nav>
      <header className="stage-heading">
        <p className="customer-kicker">Photo Booth · {layout.shot_count} {t('foto', 'photos')}</p>
        <h1>{t('Nama event.', 'Event name.')}</h1>
      </header>
      <div className="classic-event-details"><label htmlFor="classic-event-name">{t('Nama event', 'Event name')}<input id="classic-event-name" value={eventName} maxLength={80} placeholder={t('Misalnya: Pernikahan Sarah & Arif', 'For example: Sarah & Arif’s Wedding')} onChange={event => { setEventName(event.target.value); updateCustomerFlow({ classicEventName: event.target.value.trim(), classicEventLayoutId: layout.id }); setMessage('') }} autoComplete="off" required aria-describedby="classic-event-help" /></label><p id="classic-event-help">{t('Tanggal otomatis (WIB). QR untuk unduh foto.', 'Automatic date (WIB). QR to download the photos.')}</p></div>
      <div className="camera-actions"><button className="customer-solid-button" disabled={!eventReady || opening} onClick={() => { updateCustomerFlow({ classicEventName: eventName.trim(), classicEventLayoutId: layout.id }); setEventConfirmed(true); window.scrollTo({ top: 0, behavior: 'auto' }) }}>{t('Lanjut ambil foto', 'Continue to photos')} →</button></div>
      <figure className="classic-selected-frame"><CatalogImage key={layout.id} src={layout.preview_url} alt={t(`Pratinjau bingkai ${layout.name}`, `Frame preview ${layout.name}`)} loading="eager" fallback={t('Pratinjau bingkai belum tersedia', 'Frame preview not available yet')} /><figcaption>{t('Pratinjau bingkai', 'Frame preview')} · {layout.name}<br />{t(`${layout.shot_count} foto dalam satu strip`, `${layout.shot_count} photos in one strip`)}</figcaption></figure>
    </section>
  )
  return (
    <section className="photo-stage classic-capture customer-stage-enter">
      <nav className="capture-navigation" aria-label={t('Navigasi Photo Booth', 'Photo Booth navigation')}>
        <button className="customer-inline-button" onClick={onBack} disabled={busy}>← {t('Ganti bingkai', 'Change frame')}</button>
        {layout.requires_event_name && completed === 0 && !busy && <button className="customer-inline-button" onClick={() => { stopCamera(); setEventConfirmed(false); window.scrollTo({ top: 0, behavior: 'auto' }) }}>{t('Ubah nama event', 'Edit event name')}</button>}
      </nav>
      <header className="stage-heading classic-capture-heading">
        <h1>{t('Buat strip foto Anda.', 'Make your photo strip.')}</h1>
        <div className="classic-capture-status">
          <p>{t(`${completed} dari ${layout.shot_count} foto diterima`, `${completed} of ${layout.shot_count} photographs accepted`)}</p>
          <p className="classic-retake-allowance">{t(`${retakes} dari ${CLASSIC_RETAKE_LIMIT} foto ulang tersisa`, `${retakes} of ${CLASSIC_RETAKE_LIMIT} retakes remaining`)}</p>
        </div>
        <p className="classic-review-guidance">{t('Tinjau 10 detik · Berikutnya berlanjut otomatis.', '10-second review · Next continues automatically.')}</p>
      </header>
      <figure className="classic-selected-frame"><CatalogImage key={layout.id} src={layout.preview_url} alt={`Preview frame ${layout.name}`} loading="eager" fallback="Preview frame belum tersedia" /><figcaption>{layout.name}{layout.requires_event_name && <><br />{eventName.trim()}</>}</figcaption></figure>
      <div className="camera-stage classic-camera-stage">
        {camera ? <video ref={videoRef} autoPlay playsInline muted onPlaying={() => setReady(true)} aria-label={t('Pratinjau kamera langsung', 'Live camera preview')} /> : <button type="button" className="camera-idle" onClick={openCamera} disabled={busy || opening}><span className="camera-lens" aria-hidden="true"><i /></span><strong>{opening ? t('Membuka kamera…', 'Opening camera…') : t('Buka kamera', 'Open the camera')}</strong></button>}
        {reviewPhoto && <img className="classic-shot-preview" src={reviewPhoto.url} alt={t('Foto ' + (reviewPhoto.shot + 1) + ' untuk ditinjau', 'Photo ' + (reviewPhoto.shot + 1) + ' for review')} />}
        {countdown && <strong className="classic-countdown" role="status">{countdown}</strong>}
      </div>
      {message && <p className="camera-message" role="alert">{message}</p>}
      {reviewPhoto ? <div className="classic-shot-review">
        <h2>{t(`Foto ${reviewPhoto.shot + 1} dari ${layout.shot_count}`, `Photo ${reviewPhoto.shot + 1} of ${layout.shot_count}`)}</h2>
        <p role="status">{reviewPhoto.shot + 1 === layout.shot_count ? t('Membuat strip Anda', 'Creating your strip') : t('Foto berikutnya', 'Next photo')} {t('dalam', 'in')} {reviewSeconds}{t(' dtk', 's')}</p>
        <div className="camera-actions">
          <button className="customer-outline-button" onClick={() => finishReview('retake')} disabled={retakes === 0}>{t('Ulangi foto', 'Retake photo')} · {retakes} {t('tersisa', 'left')}</button>
          <button className="customer-solid-button" onClick={() => finishReview('next')}>{reviewPhoto.shot + 1 === layout.shot_count ? t('Berikutnya · Buat strip foto', 'Next · Create photo strip') : t('Foto berikutnya', 'Next photo')} · {reviewSeconds}{t(' dtk', 's')}</button>
        </div>
        {retakes === 0 && <p>{t('Tidak ada foto ulang tersisa. Foto berikutnya tetap memakai hitung mundur biasa.', 'No retakes left. Your next photo will still use the normal countdown.')}</p>}
      </div> : <div className="camera-actions">
        {previewBlocked && <button className="customer-outline-button" onClick={playPreview}>{t('Lanjutkan pratinjau', 'Resume preview')}</button>}
        <button className="customer-solid-button" onClick={completed === layout.shot_count || camera ? runCapture : openCamera} disabled={busy || opening || !eventReady || (camera && !ready)}>{busy ? phase === 'composing' ? t('Membuat strip foto Anda…', 'Creating your photo strip…') : phase === 'uploading' ? t('Menyimpan foto Anda…', 'Saving your photo…') : t('Mengambil ' + (completed + 1) + ' dari ' + layout.shot_count + '…', 'Capturing ' + (completed + 1) + ' of ' + layout.shot_count + '…') : completed === layout.shot_count ? t('Buat strip foto', 'Create photo strip') : camera ? t('Mulai hitung mundur foto ' + (completed + 1), 'Start photo ' + (completed + 1) + ' countdown') : t('Buka kamera', 'Open camera')}</button>
        <button className="customer-outline-button" onClick={() => inputRef.current?.click()} disabled={busy || !eventReady}>{t(`Pilih ${layout.shot_count} foto`, `Choose ${layout.shot_count} photos`)}</button>
      </div>}
      <input ref={inputRef} hidden multiple type="file" accept="image/*,.heic,.heif" onChange={(event) => { uploadSet(event.target.files); event.target.value = '' }} />
    </section>
  )
}
