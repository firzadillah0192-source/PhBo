import React, { useRef, useState } from 'react'
import { uploadPreviewUrl } from '../api.js'

/** Step 1 — upload the user photo (drag & drop or click). */
export function UploadStep({ busy, onFile, hasUpload }) {
  const inputRef = useRef(null)
  const [dragOver, setDragOver] = useState(false)

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) onFile(file)
  }

  return (
    <section className="card">
      <h2>Upload your photo</h2>
      <p className="hint">JPEG, PNG or WEBP · max 12 MB · min 256px per side.</p>
      <div
        className={'dropzone ' + (dragOver ? 'dropzone-over' : '')}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click()
        }}
        role="button"
        tabIndex={0}
      >
        <span>{busy ? 'Validating…' : 'Click or drop a photo here'}</span>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        style={{ display: 'none' }}
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      {hasUpload && <p className="hint">Photo uploaded — choose a template to continue.</p>}
    </section>
  )
}

/** Step 2 — choose a template, then generate. */
export function TemplateStep({
  upload,
  templates,
  selectedTemplateId,
  onSelect,
  onGenerate,
  busy,
}) {
  return (
    <section className="card">
      <h2>Choose a template</h2>
      <div className="split">
        <div className="preview-box">
          <h3>Your photo</h3>
          <img src={uploadPreviewUrl(upload.upload_id)} alt="Your uploaded" />
          <p className="meta">
            {upload.width}×{upload.height} · {upload.format} ·{' '}
            {(upload.size_bytes / 1024).toFixed(0)} KB
          </p>
        </div>
        <div className="template-list">
          {templates.length === 0 && <p className="hint">No templates available.</p>}
          {templates.map((t) => (
            <button
              key={t.id}
              className={'template ' + (t.id === selectedTemplateId ? 'template-selected' : '')}
              onClick={() => onSelect(t.id)}
            >
              <div className="template-name">{t.name}</div>
              <div className="template-desc">{t.description}</div>
              <div className="template-id">{t.id}</div>
            </button>
          ))}
        </div>
      </div>
      <div className="actions">
        <button className="primary" disabled={!selectedTemplateId || busy} onClick={onGenerate}>
          {busy ? 'Starting…' : 'Generate'}
        </button>
      </div>
    </section>
  )
}
