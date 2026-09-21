import React, { useRef, useState } from 'react'
import { uploadPreviewUrl } from '../api.js'

export function ModeStep({ onSelect }) {
  return (
    <section className="card">
      <h2>Choose your experience</h2>
      <div className="mode-grid">
        <button className="mode-card" onClick={() => onSelect('BASIC')}>
          <strong>Basic</strong>
          <span>Experimental local face fitting · no external AI</span>
        </button>
        <button className="mode-card" onClick={() => onSelect('ADVANCED')}>
          <strong>Advanced</strong>
          <span>Creative AI experience</span>
        </button>
      </div>
    </section>
  )
}

/** Step 1 — upload the user photo (drag & drop or click). */
export function UploadStep({ busy, onFile, mode, onBack }) {
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
      <h2>{mode === 'BASIC' ? 'Upload for Basic' : 'Upload for Advanced'}</h2>
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
        onChange={(e) => {
          const selected = e.target.files?.[0]
          e.target.value = '' // Allow retrying the same file after a validation error.
          if (selected) onFile(selected)
        }}
      />
      <div className="actions"><button onClick={onBack}>Back to selection</button></div>
    </section>
  )
}

/** Step 2 — choose a template, then generate. */
export function TemplateStep({
  upload,
  templates,
  experiences,
  selectedTemplateId,
  selectedExperienceId,
  onSelect,
  onSelectExperience,
  onGenerate,
  onContinue,
  onChangePhoto,
  mode,
  busy,
}) {
  return (
    <section className="card">
      <h2>{mode === 'BASIC' ? 'Choose a Basic template' : 'Choose an AI experience'}</h2>
      <div className="split">
        {upload && <div className="preview-box">
          <h3>Your photo</h3>
          <img src={uploadPreviewUrl(upload.upload_id)} alt="Your uploaded" />
          <p className="meta">
            {upload.width}×{upload.height} · {upload.format} ·{' '}
            {(upload.size_bytes / 1024).toFixed(0)} KB
          </p>
        </div>}
        <div className={mode === 'ADVANCED' ? 'template-list experience-grid' : 'template-list'}>
          {mode === 'BASIC' && templates.length === 0 && <p className="hint">No Basic templates available.</p>}
          {mode === 'ADVANCED' && experiences.length === 0 && <p className="hint">No Advanced experiences available.</p>}
          {mode === 'BASIC' && templates.map((t) => (
            <button key={t.id} className={'template ' + (t.id === selectedTemplateId ? 'template-selected' : '')} aria-pressed={t.id === selectedTemplateId} onClick={() => onSelect(t.id)}>
              <div className="template-name">{t.name}</div>
              <div className="template-desc">{t.description}</div>
            </button>
          ))}
          {mode === 'ADVANCED' && experiences.map((experience) => (
            <button key={experience.id} className={'template ' + (experience.id === selectedExperienceId ? 'template-selected' : '')} aria-pressed={experience.id === selectedExperienceId} onClick={() => onSelectExperience(experience.id)}>
              {experience.thumbnail && <img className="experience-thumbnail" src={experience.thumbnail} alt="" />}
              <div className="template-name">{experience.name}</div>
              <div className="template-desc">{experience.description}</div>
            </button>
          ))}
        </div>
      </div>
      <div className="actions">
        {upload ? (
          <>
            <button className="primary" disabled={(!selectedTemplateId && mode === 'BASIC') || (!selectedExperienceId && mode === 'ADVANCED') || busy} onClick={onGenerate}>
              {busy ? 'Starting…' : mode === 'BASIC' ? 'Generate Local' : 'Generate AI'}
            </button>
            <button disabled={busy} onClick={onChangePhoto}>Change photo</button>
          </>
        ) : (
          <button className="primary" disabled={mode === 'BASIC' ? !selectedTemplateId : !selectedExperienceId} onClick={onContinue}>Continue to upload</button>
        )}
      </div>
      {mode === 'BASIC' && <p className="hint">Experimental local face fitting. No external AI provider is used.</p>}
      {mode === 'ADVANCED' && <p className="hint">The selected experience uses a backend preset; prompts are not editable here.</p>}
    </section>
  )
}
