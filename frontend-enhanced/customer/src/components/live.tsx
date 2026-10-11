import { Camera, Image as ImageIcon, Upload } from 'lucide-react'
import { Button } from './ui'
import { usePhotoInput } from '../../../shared/PhotoInput'
import type { Row } from '../../../shared/api'

/** Figma "PhotoDropzone" markup driven by the real camera / file-upload logic. */
export function LiveDropzone({ upload, onUploaded, disabled = false, title = 'Add your photo' }: { upload: (file: File) => Promise<Row>; onUploaded: (row: Row) => void; disabled?: boolean; title?: string }) {
  const { input, video, camera, busy, error, openCamera, capture, stop, send } = usePhotoInput(upload, onUploaded, disabled)
  return (
    <div className="flex flex-col items-center gap-3 rounded-md border-2 border-dashed border-border bg-surface p-6 text-center">
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" hidden onChange={e => send(e.target.files?.[0])} />
      {camera
        ? <video ref={video} muted playsInline aria-label="Live camera" className="max-h-[520px] w-full rounded-md" />
        : <span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary-soft text-primary"><ImageIcon size={28} aria-hidden /></span>}
      <p className="t-h4">{busy ? 'Uploading…' : camera ? 'Smile!' : title}</p>
      <p className="t-caption max-w-[260px] text-text-muted">JPG, PNG, WebP or HEIC · up to 12 MB · kept for 24 hours</p>
      <div className="flex w-full max-w-[286px] gap-2">
        <Button icon={Camera} className="!h-12 flex-1" disabled={busy || disabled} onClick={camera ? capture : openCamera}>{camera ? 'Capture photo' : 'Take photo'}</Button>
        <Button variant="secondary" icon={Upload} className="!h-12 flex-1" disabled={busy || disabled} onClick={() => input.current?.click()}>Upload photo</Button>
      </div>
      {camera && <button type="button" className="t-caption text-primary underline" onClick={stop}>Close camera</button>}
      {error && <p role="alert" className="t-caption text-danger">{error}</p>}
    </div>
  )
}
