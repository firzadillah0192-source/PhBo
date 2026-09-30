import React, { useEffect, useRef, useState } from 'react'
import { uploadPhoto } from '../../api.js'
import { runClassicCaptureSequence } from '../../classicSequence.js'

const delay = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds))

export default function ClassicCaptureStage({ layout, onComplete, onBack }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const runRef = useRef(0)
  const inputRef = useRef(null)
  const [camera, setCamera] = useState(false)
  const [busy, setBusy] = useState(false)
  const [countdown, setCountdown] = useState(null)
  const [completed, setCompleted] = useState(0)
  const [message, setMessage] = useState('')

  useEffect(() => () => {
    runRef.current += 1
    streamRef.current?.getTracks().forEach((track) => track.stop())
  }, [])

  const openCamera = async () => {
    setMessage('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 1600 } }, audio: false })
      streamRef.current = stream
      setCamera(true)
      window.setTimeout(() => { if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play().catch(() => {}) } }, 0)
    } catch {
      setMessage('Camera access is unavailable. Choose photographs from your device instead.')
    }
  }

  const capture = () => new Promise((resolve, reject) => {
    const video = videoRef.current
    if (!video?.videoWidth) { reject(new Error('Camera is not ready')); return }
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext('2d')
    context.translate(canvas.width, 0)
    context.scale(-1, 1)
    context.drawImage(video, 0, 0)
    canvas.toBlob((blob) => blob ? resolve(new File([blob], 'classic-capture.jpg', { type: 'image/jpeg' })) : reject(new Error('Could not capture photo')), 'image/jpeg', .93)
  })

  const runCapture = async () => {
    const run = ++runRef.current
    setBusy(true)
    setCompleted(0)
    setMessage('')
    try {
      const uploads = await runClassicCaptureSequence(layout.shot_count, {
        tick: async (count) => { setCountdown(count); await delay(1000) },
        capture: async () => { setCountdown(null); return capture() },
        upload: uploadPhoto,
        pause: () => delay(700),
        progress: (count) => setCompleted(count),
        active: () => run === runRef.current,
      })
      if (!uploads) return
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
      setCamera(false)
      await onComplete(uploads)
    } catch (error) {
      setMessage(error?.message || 'Could not complete the photo sequence. Please try again.')
      setBusy(false)
      setCountdown(null)
    }
  }

  const uploadSet = async (files) => {
    const chosen = Array.from(files || [])
    if (chosen.length !== layout.shot_count) {
      setMessage(`Choose exactly ${layout.shot_count} photographs for this layout.`)
      return
    }
    setBusy(true)
    setMessage('')
    try {
      const uploads = []
      for (const file of chosen) {
        uploads.push(await uploadPhoto(file))
        setCompleted(uploads.length)
      }
      await onComplete(uploads)
    } catch (error) {
      setMessage(error?.message || 'Could not upload the photographs. Please try again.')
      setBusy(false)
    }
  }

  return (
    <section className="photo-stage classic-capture customer-stage-enter">
      <header className="stage-heading">
        <button className="customer-inline-button stage-back" onClick={onBack} disabled={busy}>← Change frame</button>
        <p className="customer-kicker">Classic photobooth · {layout.shot_count} photos</p>
        <h1>Make your photo strip.</h1>
        <p>{completed} of {layout.shot_count} photographs captured</p>
      </header>
      <div className="camera-stage classic-camera-stage">
        {camera ? <video ref={videoRef} autoPlay playsInline muted aria-label="Live camera preview" /> : <button type="button" className="camera-idle" onClick={openCamera} disabled={busy}><span className="camera-lens" aria-hidden="true"><i /></span><strong>Open the camera</strong></button>}
        {countdown && <strong className="classic-countdown" role="status">{countdown}</strong>}
      </div>
      {message && <p className="camera-message" role="alert">{message}</p>}
      <div className="camera-actions">
        <button className="customer-solid-button" onClick={camera ? runCapture : openCamera} disabled={busy}>{busy ? `Capturing ${completed + 1} of ${layout.shot_count}…` : camera ? `Start ${layout.shot_count}-photo countdown` : 'Open camera'}</button>
        <button className="customer-outline-button" onClick={() => inputRef.current?.click()} disabled={busy}>Choose {layout.shot_count} photos</button>
      </div>
      <input ref={inputRef} hidden multiple type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { uploadSet(event.target.files); event.target.value = '' }} />
    </section>
  )
}
