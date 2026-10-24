import { useEffect, useRef, useState } from 'react'
import { message, type Row } from './api'

export function usePhotoInput(upload: (file: File) => Promise<Row>, onUploaded: (row: Row) => void, disabled = false) {
  const input = useRef<HTMLInputElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const alive = useRef(true)
  const [camera, setCamera] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const stop = () => { stream.current?.getTracks().forEach(t => t.stop()); stream.current = null; setCamera(false) }
  useEffect(() => { alive.current = true; return () => { alive.current = false; stream.current?.getTracks().forEach(t => t.stop()) } }, [])
  useEffect(() => { if (camera && video.current) { video.current.srcObject = stream.current; video.current.play().catch(() => setError('Could not start the camera. Try uploading a photo.')) } }, [camera])
  async function send(file?: File) {
    if (!file || busy || disabled) return
    setError(''); setBusy(true)
    try {
      if (file.size > 12 * 1024 * 1024) throw new Error('Photo must be at most 12 MB.')
      if (!/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) throw new Error('Choose a JPG, PNG, WebP or HEIC photo.')
      const result = await upload(file)
      if (!alive.current) return
      if (!result.upload_id) throw new Error('The server did not accept this upload.')
      onUploaded({ ...result, captured_at: new Date().toISOString() }); stop()
    } catch (e) { if (alive.current) setError(message(e)) }
    finally { if (alive.current) setBusy(false); if (input.current) input.current.value = '' }
  }
  async function openCamera() {
    try {
      setError('')
      const opened = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      if (!alive.current) { opened.getTracks().forEach(t => t.stop()); return }
      stream.current = opened
      setCamera(true)
    } catch { setError('Camera access is unavailable. Allow camera access or upload a photo.') }
  }
  function capture() {
    const v = video.current
    if (!v?.videoWidth || busy) return
    const canvas = document.createElement('canvas'); canvas.width = v.videoWidth; canvas.height = v.videoHeight
    canvas.getContext('2d')?.drawImage(v, 0, 0)
    canvas.toBlob(blob => { if (blob) send(new File([blob], 'capture.jpg', { type: 'image/jpeg' })); else setError('Could not capture this photo.') }, 'image/jpeg', .95)
  }
  return { input, video, camera, busy, error, openCamera, capture, stop, send }
}

export function PhotoInput({ upload, onUploaded, disabled = false }: { upload: (file: File) => Promise<Row>; onUploaded: (row: Row) => void; disabled?: boolean }) {
  const { input, video, camera, busy, error, openCamera, capture, stop, send } = usePhotoInput(upload, onUploaded, disabled)
  return <div className="space-y-3 rounded-md border-2 border-dashed border-border bg-surface p-5 text-text">
    <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" hidden onChange={e => send(e.target.files?.[0])} />
    {camera && <video ref={video} muted playsInline className="max-h-[520px] w-full rounded-md" aria-label="Live camera" />}
    <div className="flex flex-wrap gap-3">
      <button type="button" disabled={busy || disabled} className="min-h-12 rounded-md bg-primary px-5 py-3 font-semibold text-white disabled:opacity-50" onClick={camera ? capture : openCamera}>{busy ? 'Uploading…' : camera ? 'Capture photo' : 'Take photo'}</button>
      <button type="button" disabled={busy || disabled} className="min-h-12 rounded-md border border-border px-5 py-3 disabled:opacity-50" onClick={() => input.current?.click()}>Upload photo</button>
      {camera && <button type="button" className="px-4" onClick={stop}>Close camera</button>}
    </div>
    <p className="t-caption text-text-muted">JPG, PNG, WebP or HEIC · up to 12 MB. The server validates readability and dimensions.</p>
    {error && <p role="alert" className="text-danger">{error}</p>}
  </div>
}
