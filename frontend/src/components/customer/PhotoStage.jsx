import React, { useEffect, useRef, useState } from 'react'
import { cameraFailureMessage, requestPortraitCamera } from '../../cameraAccess'

export default function PhotoStage({ mode, busy, onFile, onBack }) {
  const inputRef = useRef(null)
  const deviceCameraRef = useRef(null)
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const mountedRef = useRef(false)
  const requestRef = useRef(0)
  const openingRef = useRef(false)
  const [camera, setCamera] = useState(false)
  const [opening, setOpening] = useState(false)
  const [ready, setReady] = useState(false)
  const [previewBlocked, setPreviewBlocked] = useState(false)
  const [flash, setFlash] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [message, setMessage] = useState('')

  const stopCamera = () => {
    requestRef.current += 1
    openingRef.current = false
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCamera(false)
    setOpening(false)
    setReady(false)
    setPreviewBlocked(false)
  }

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      requestRef.current += 1
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }, [])

  const playPreview = async () => {
    const video = videoRef.current
    const stream = streamRef.current
    const request = requestRef.current
    if (!video || !stream) return
    video.srcObject = stream
    try {
      await video.play()
      if (!mountedRef.current || request !== requestRef.current) return
      setPreviewBlocked(false)
      setMessage('')
      setReady(video.videoWidth > 0 && video.videoHeight > 0)
    } catch {
      if (!mountedRef.current || request !== requestRef.current) return
      setReady(false)
      setPreviewBlocked(true)
      setMessage('Camera preview paused. Tap Resume preview, or use Phone camera below.')
    }
  }

  useEffect(() => {
    if (camera) playPreview()
  }, [camera])

  const openCamera = async () => {
    if (busy || openingRef.current) return
    openingRef.current = true
    const request = ++requestRef.current
    setOpening(true)
    setReady(false)
    setMessage('')
    try {
      const stream = await requestPortraitCamera()
      if (!mountedRef.current || request !== requestRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      streamRef.current = stream
      setCamera(true)
    } catch (error) {
      if (mountedRef.current && request === requestRef.current) setMessage(cameraFailureMessage(error))
    } finally {
      if (mountedRef.current && request === requestRef.current) {
        openingRef.current = false
        setOpening(false)
      }
    }
  }

  const sendFile = (file) => {
    if (!file || busy) return
    setFlash(true)
    window.setTimeout(() => { if (mountedRef.current) setFlash(false) }, 260)
    onFile(file)
  }

  const capture = () => {
    const video = videoRef.current
    if (busy || !ready || !video?.videoWidth || !video?.videoHeight) return
    const request = requestRef.current
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext('2d')
    if (!context) {
      setMessage('Photo capture is unavailable. Use Phone camera or upload a photo below.')
      return
    }
    context.translate(canvas.width, 0)
    context.scale(-1, 1)
    context.drawImage(video, 0, 0)
    canvas.toBlob((blob) => {
      if (!mountedRef.current || request !== requestRef.current) return
      if (!blob) {
        setMessage('The photo could not be captured. Try again or upload a photo.')
        return
      }
      stopCamera()
      sendFile(new File([blob], 'photobooth-capture.jpg', { type: 'image/jpeg' }))
    }, 'image/jpeg', .93)
  }

  const upload = (file) => {
    if (!file || busy) return
    stopCamera()
    sendFile(file)
  }

  const openDeviceCamera = () => {
    if (busy) return
    stopCamera()
    setMessage('')
    deviceCameraRef.current?.click()
  }

  return (
    <section className="photo-stage customer-stage-enter">
      {flash && <div className="camera-flash" aria-hidden="true" />}
      <header className="stage-heading">
        <button className="customer-inline-button stage-back" onClick={onBack}>← Change {mode === 'BASIC' ? 'studio' : 'world'}</button>
        <p className="customer-kicker">Your photograph</p>
        <h1>Enter the studio.</h1>
        <p>Face the light, relax your shoulders, and look toward the lens.</p>
      </header>

      <div
        className={`camera-stage ${dragging ? 'is-dragging' : ''}`}
        onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          upload(event.dataTransfer.files?.[0])
        }}
      >
        {camera ? (
          <video ref={videoRef} autoPlay playsInline muted onPlaying={(event) => setReady(event.currentTarget.videoWidth > 0 && event.currentTarget.videoHeight > 0)} aria-label="Live camera preview" />
        ) : (
          <button type="button" className="camera-idle" onClick={openCamera} disabled={busy || opening}>
            <span className="camera-lens" aria-hidden="true"><i /></span>
            <strong>{busy ? 'Preparing your portrait…' : opening ? 'Opening camera…' : 'Open the camera'}</strong>
            <em>or drop a photograph anywhere on this frame</em>
          </button>
        )}
        <div className="camera-reticle" aria-hidden="true"><span>Portrait stage</span><i /><small>Face · light · focus</small></div>
        <div className="camera-glow" aria-hidden="true" />
      </div>

      {message && <p className="camera-message" role="status">{message}</p>}
      {opening && <p className="camera-message" role="status">Allow camera access when your browser asks. You can upload a photo instead.</p>}
      <div className="camera-actions">
        <button type="button" className="customer-solid-button" disabled={busy} onClick={openDeviceCamera}>Use phone camera</button>
        {previewBlocked && <button className="customer-solid-button" onClick={playPreview} disabled={busy}>Resume preview</button>}
        {camera
          ? <button className="customer-outline-button shutter-button" onClick={capture} disabled={busy || !ready}><span aria-hidden="true" />Take photo</button>
          : <button className="customer-outline-button" onClick={openCamera} disabled={busy || opening}>{opening ? 'Opening camera…' : 'Take photo'}</button>}
        <button className="customer-outline-button" disabled={busy} onClick={() => inputRef.current?.click()}>{busy ? 'Preparing photo…' : 'Upload photo'}</button>
      </div>
      <p className="camera-message">Phone camera opens your device’s camera or photo picker.</p>
      <input ref={inputRef} type="file" accept="image/*,.heic,.heif" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; upload(file) }} />
      <input ref={deviceCameraRef} type="file" aria-label="Photo from phone camera" accept="image/*,.heic,.heif" capture="user" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; upload(file) }} />
      <ul className="photo-guidance"><li>Face visible</li><li>Good lighting</li><li>Look toward camera</li></ul>
    </section>
  )
}
