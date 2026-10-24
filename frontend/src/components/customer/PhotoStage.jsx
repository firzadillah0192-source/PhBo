import React, { useEffect, useRef, useState } from 'react'
import { cameraFailureMessage, requestPortraitCamera, waitForCameraPreview } from '../../cameraAccess'
import { getLanguage, useT } from '../../i18n.js'

export default function PhotoStage({ mode, busy, onFile, onBack }) {
  const t = useT()
  const inputRef = useRef(null)
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
    setReady(false)
    setPreviewBlocked(false)
    setMessage(t('Menunggu gambar dari kamera…', 'Waiting for the camera picture…'))
    try {
      await waitForCameraPreview(video, () => mountedRef.current && request === requestRef.current)
      if (!mountedRef.current || request !== requestRef.current) return
      setPreviewBlocked(false)
      setMessage('')
      setReady(true)
    } catch (error) {
      if (!mountedRef.current || request !== requestRef.current) return
      setReady(false)
      setPreviewBlocked(true)
      setMessage(error?.name === 'CameraFrameTimeout'
        ? t('Kamera terbuka tetapi tidak mengirim gambar. Pastikan tidak dipakai aplikasi lain, lalu ketuk Ambil foto untuk mencoba lagi atau unggah foto.', 'The camera opened but did not send a picture. Check that another app is not using it, then tap Take photo to retry or upload a photo.')
        : t('Pratinjau kamera tidak bisa dimulai. Ketuk Ambil foto untuk mencoba lagi atau unggah foto.', 'The camera preview could not start. Tap Take photo to retry or upload a photo.'))
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
      if (mountedRef.current && request === requestRef.current) setMessage(cameraFailureMessage(error, getLanguage()))
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
      setMessage(t('Pengambilan foto tidak tersedia. Ketuk Ambil foto untuk mencoba lagi atau unggah foto di bawah.', 'Photo capture is unavailable. Tap Take photo to retry or upload a photo below.'))
      return
    }
    context.translate(canvas.width, 0)
    context.scale(-1, 1)
    context.drawImage(video, 0, 0)
    canvas.toBlob((blob) => {
      if (!mountedRef.current || request !== requestRef.current) return
      if (!blob) {
        setMessage(t('Foto tidak berhasil diambil. Coba lagi atau unggah foto.', 'The photo could not be captured. Try again or upload a photo.'))
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

  const takePhoto = () => {
    if (busy || opening) return
    if (!camera) openCamera()
    else if (previewBlocked) playPreview()
    else capture()
  }

  return (
    <section className="photo-stage customer-stage-enter">
      {flash && <div className="camera-flash" aria-hidden="true" />}
      <nav className="capture-navigation" aria-label={t('Navigasi foto', 'Photo navigation')}><button className="customer-inline-button" onClick={onBack} disabled={busy}>← {mode === 'BASIC' ? t('Ganti studio', 'Change studio') : t('Kembali ke gaya bingkai', 'Back to frame style')}</button></nav>
      <header className="stage-heading">
        <p className="customer-kicker">{t('Foto Anda', 'Your photograph')}</p>
        <h1>{t('Masuk ke studio.', 'Enter the studio.')}</h1>
        <p>{t('Hadap ke cahaya, rilekskan bahu, dan lihat ke arah lensa.', 'Face the light, relax your shoulders, and look toward the lens.')}</p>
      </header>

      <div className="photo-layout">
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
            <video ref={videoRef} autoPlay playsInline muted aria-label={t('Pratinjau kamera langsung', 'Live camera preview')} />
          ) : (
            <div className="camera-idle">
              <span className="camera-lens" aria-hidden="true"><i /></span>
              <strong>{busy ? t('Menyiapkan potret Anda…', 'Preparing your portrait…') : opening ? t('Membuka kamera…', 'Opening camera…') : t('Siap kapan pun Anda siap', 'Ready when you are')}</strong>
              <em>{t('Pilih Ambil foto untuk membuka kamera, atau unggah foto', 'Select Take photo to open your camera, or upload a photograph')}</em>
            </div>
          )}
          <div className="camera-reticle" aria-hidden="true"><span>{t('Panggung potret', 'Portrait stage')}</span><i /><small>{t('Wajah · cahaya · fokus', 'Face · light · focus')}</small></div>
          <div className="camera-glow" aria-hidden="true" />
        </div>

        <div className="photo-panel">
          {message && <p className="camera-message" role="status">{message}</p>}
          {opening && <p className="camera-message" role="status">{t('Izinkan akses kamera saat browser meminta. Anda juga bisa mengunggah foto.', 'Allow camera access when your browser asks. You can upload a photo instead.')}</p>}
          <div className="camera-actions">
            <button type="button" className="customer-solid-button shutter-button" onClick={takePhoto} disabled={busy || opening || (camera && !ready && !previewBlocked)}><span aria-hidden="true" />{opening ? t('Membuka kamera…', 'Opening camera…') : t('Ambil foto', 'Take photo')}</button>
            <button className="customer-outline-button" disabled={busy} onClick={() => inputRef.current?.click()}>{busy ? t('Menyiapkan foto…', 'Preparing photo…') : t('Unggah foto', 'Upload photo')}</button>
          </div>
          <input ref={inputRef} type="file" accept="image/*,.heic,.heif" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; upload(file) }} />
          <div className="photo-tips">
            <h2>{t('Tips foto terbaik', 'Tips for the best photo')}</h2>
            <ul className="photo-guidance"><li>{t('Wajah terlihat jelas', 'Face visible')}</li><li>{t('Cahaya cukup', 'Good lighting')}</li><li>{t('Lihat ke arah kamera', 'Look toward camera')}</li></ul>
          </div>
          <p className="photo-file-note">{t('JPEG, PNG, WebP, HEIC atau HEIF · Maks. 12 MB', 'JPEG, PNG, WebP, HEIC or HEIF · Up to 12 MB')}<br />{t('Foto Anda tetap tersimpan di sesi ini saat Anda kembali.', 'Your photo stays in this session when you go back.')}</p>
        </div>
      </div>
    </section>
  )
}
