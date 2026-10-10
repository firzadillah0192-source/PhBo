import React, { useEffect, useRef, useState } from 'react'
import { uploadPhoto } from '../../api.js'
import { CLASSIC_RETAKE_LIMIT, CLASSIC_REVIEW_SECONDS, runClassicCaptureSequence } from '../../classicSequence.js'
import { cameraFailureMessage, requestPortraitCamera } from '../../cameraAccess.js'
import { readCustomerFlow, updateCustomerFlow } from '../../customerSession.js'
import { CatalogImage } from '../home/ModeCards.jsx'

const delay = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms))

export default function ClassicCaptureStage({ layout, onComplete, onBack }) {
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
      setMessage('Camera preview paused. Tap Resume preview to continue.')
    }
  }
  useEffect(() => { if (camera) playPreview() }, [camera])
  const openCamera = async () => {
    if (!eventReady) { setMessage('Isi nama event sebelum mengambil foto.'); return }
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
      if (mountedRef.current && run === runRef.current) setMessage(cameraFailureMessage(error))
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
        setMessage(error?.message || 'Could not complete the photo sequence. Please try again.')
        setBusy(false)
        setPhase('idle')
        setCountdown(null)
      }
    } finally { runningRef.current = false }
  }
  const uploadSet = async (files) => {
    if (!eventReady) { setMessage('Isi nama event terlebih dahulu.'); return }
    if (runningRef.current) return
    const chosen = Array.from(files || [])
    if (!chosen.length) return
    if (chosen.length !== layout.shot_count) { setMessage('Choose exactly ' + layout.shot_count + ' photographs for this layout.'); return }
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
      if (mountedRef.current) { setMessage(error?.message || 'Could not upload the photographs. Please try again.'); setBusy(false); setPhase('idle') }
    } finally { runningRef.current = false }
  }
  return (
    <section className="photo-stage classic-capture customer-stage-enter">
      <header className="stage-heading">
        <button className="customer-inline-button stage-back" onClick={onBack} disabled={busy}>← Change frame</button>
        <p className="customer-kicker">Photo Booth · {layout.shot_count} photos</p>
        <h1>Make your photo strip.</h1>
        <p>{completed} of {layout.shot_count} photographs accepted</p>
        <p className="classic-retake-allowance">{retakes} of {CLASSIC_RETAKE_LIMIT} retakes remaining for this session</p>
        <p className="classic-review-guidance">Review each photo for 10 seconds. Next continues automatically.</p>
      </header>
      {layout.requires_event_name && <div className="classic-event-details"><label htmlFor="classic-event-name">Nama event<input id="classic-event-name" value={eventName} maxLength={80} disabled={busy || completed > 0} placeholder="Misalnya: Pernikahan Sarah & Arif" onChange={event => { setEventName(event.target.value); updateCustomerFlow({ classicEventName: event.target.value.trim(), classicEventLayoutId: layout.id }); setMessage('') }} autoComplete="off" required aria-describedby="classic-event-help" /></label><p id="classic-event-help">Tanggal mengikuti waktu pengambilan foto dalam WIB. QR akan membuka hasil foto untuk di-download.</p></div>}
      <figure className="classic-selected-frame"><CatalogImage key={layout.id} src={layout.preview_url} alt={`Preview frame ${layout.name}`} loading="eager" fallback="Preview frame belum tersedia" /><figcaption>Preview frame · {layout.name}<br />{layout.shot_count} foto dalam satu strip</figcaption></figure>
      <div className="camera-stage classic-camera-stage">
        {camera ? <video ref={videoRef} autoPlay playsInline muted onPlaying={() => setReady(true)} aria-label="Live camera preview" /> : <button type="button" className="camera-idle" onClick={openCamera} disabled={busy || opening}><span className="camera-lens" aria-hidden="true"><i /></span><strong>{opening ? 'Opening camera…' : 'Open the camera'}</strong></button>}
        {reviewPhoto && <img className="classic-shot-preview" src={reviewPhoto.url} alt={'Photo ' + (reviewPhoto.shot + 1) + ' for review'} />}
        {countdown && <strong className="classic-countdown" role="status">{countdown}</strong>}
      </div>
      {message && <p className="camera-message" role="alert">{message}</p>}
      {reviewPhoto ? <div className="classic-shot-review">
        <h2>Photo {reviewPhoto.shot + 1} of {layout.shot_count}</h2>
        <p role="status">{reviewPhoto.shot + 1 === layout.shot_count ? 'Creating your strip' : 'Next photo'} in {reviewSeconds}s</p>
        <div className="camera-actions">
          <button className="customer-outline-button" onClick={() => finishReview('retake')} disabled={retakes === 0}>Retake photo · {retakes} left</button>
          <button className="customer-solid-button" onClick={() => finishReview('next')}>{reviewPhoto.shot + 1 === layout.shot_count ? 'Next · Create photo strip' : 'Next photo'} · {reviewSeconds}s</button>
        </div>
        {retakes === 0 && <p>No retakes left. Your next photo will still use the normal countdown.</p>}
      </div> : <div className="camera-actions">
        {previewBlocked && <button className="customer-outline-button" onClick={playPreview}>Resume preview</button>}
        <button className="customer-solid-button" onClick={completed === layout.shot_count || camera ? runCapture : openCamera} disabled={busy || opening || !eventReady || (camera && !ready)}>{busy ? phase === 'composing' ? 'Creating your photo strip…' : phase === 'uploading' ? 'Saving your photo…' : 'Capturing ' + (completed + 1) + ' of ' + layout.shot_count + '…' : completed === layout.shot_count ? 'Create photo strip' : camera ? 'Start photo ' + (completed + 1) + ' countdown' : 'Open camera'}</button>
        <button className="customer-outline-button" onClick={() => inputRef.current?.click()} disabled={busy || !eventReady}>Choose {layout.shot_count} photos</button>
      </div>}
      <input ref={inputRef} hidden multiple type="file" accept="image/*,.heic,.heif" onChange={(event) => { uploadSet(event.target.files); event.target.value = '' }} />
    </section>
  )
}
