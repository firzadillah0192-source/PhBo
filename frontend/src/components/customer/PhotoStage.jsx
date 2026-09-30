import React, { useEffect, useRef, useState } from 'react'

export default function PhotoStage({ mode, busy, onFile, onBack }) {
  const inputRef = useRef(null)
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const [camera, setCamera] = useState(false)
  const [flash, setFlash] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [message, setMessage] = useState('')

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setCamera(false)
  }

  useEffect(() => () => streamRef.current?.getTracks().forEach((track) => track.stop()), [])

  const openCamera = async () => {
    setMessage('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 1600 } },
        audio: false,
      })
      streamRef.current = stream
      setCamera(true)
      window.setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play().catch(() => {})
        }
      }, 0)
    } catch (error) {
      console.error('Camera unavailable', error)
      setMessage('Camera access is unavailable. Upload a portrait instead.')
    }
  }

  const sendFile = (file) => {
    if (!file || busy) return
    setFlash(true)
    window.setTimeout(() => setFlash(false), 260)
    onFile(file)
  }

  const capture = () => {
    const video = videoRef.current
    if (!video?.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext('2d')
    context.translate(canvas.width, 0)
    context.scale(-1, 1)
    context.drawImage(video, 0, 0)
    canvas.toBlob((blob) => {
      if (!blob) return
      stopCamera()
      sendFile(new File([blob], 'photobooth-capture.jpg', { type: 'image/jpeg' }))
    }, 'image/jpeg', .93)
  }

  const upload = (file) => {
    stopCamera()
    sendFile(file)
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
          <video ref={videoRef} autoPlay playsInline muted aria-label="Live camera preview" />
        ) : (
          <button type="button" className="camera-idle" onClick={openCamera} disabled={busy}>
            <span className="camera-lens" aria-hidden="true"><i /></span>
            <strong>{busy ? 'Preparing your portrait…' : 'Open the camera'}</strong>
            <em>or drop a photograph anywhere on this frame</em>
          </button>
        )}
        <div className="camera-reticle" aria-hidden="true"><span>Portrait stage</span><i /><small>Face · light · focus</small></div>
        <div className="camera-glow" aria-hidden="true" />
      </div>

      {message && <p className="camera-message" role="status">{message}</p>}
      <div className="camera-actions">
        {camera
          ? <button className="customer-solid-button shutter-button" onClick={capture} disabled={busy}><span aria-hidden="true" />Take photo</button>
          : <button className="customer-solid-button" onClick={openCamera} disabled={busy}>Take photo</button>}
        <button className="customer-outline-button" disabled={busy} onClick={() => inputRef.current?.click()}>{busy ? 'Preparing photo…' : 'Upload photo'}</button>
      </div>
      <input ref={inputRef} type="file" accept="image/*,.heic,.heif" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; upload(file) }} />
      <ul className="photo-guidance"><li>Face visible</li><li>Good lighting</li><li>Look toward camera</li></ul>
    </section>
  )
}
