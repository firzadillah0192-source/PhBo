import React from 'react'
import { uploadPreviewUrl } from '../../api.js'
import { experiencePreview, templatePreview } from './experienceCatalog.js'

export default function ReviewStage({ mode, upload, selection, frameStyle, ornaments = [], aiRemaining, quotaExhausted, busy, onReplace, onBack, onCreate, onOpenAccount, onPreviewError }) {
  const destination = mode === 'ADVANCED' ? experiencePreview(selection) : templatePreview(selection)
  return (
    <section className={`review-stage customer-stage-enter ${busy ? 'is-creating' : ''}`}>
      <header className="stage-heading">
        <p className="customer-kicker">Convergence</p>
        <h1>Your photograph,<br /><em>this world.</em></h1>
        <p>One source portrait. One carefully chosen destination.</p>
      </header>

      <div className="review-composition">
        <figure className="review-source">
          <img src={upload.preview_url || uploadPreviewUrl(upload.upload_id)} alt="Your uploaded portrait" onError={onPreviewError} />
          <figcaption><small>01</small><span>Your photograph</span></figcaption>
        </figure>
        <span className="review-bridge" aria-hidden="true"><i />→</span>
        <figure className="review-destination">
          {destination ? <img src={destination} alt={`${selection.name} visual destination`} /> : <div className="review-destination-placeholder"><small>Marketing preview</small><strong>Preview coming soon</strong><span>Studio selection saved</span></div>}
          <figcaption><small>02</small><span>{selection.name}</span></figcaption>
        </figure>
        <div className="review-convergence-light" aria-hidden="true" />
      </div>
      {mode === 'ADVANCED' && <div className="advanced-review-summary" aria-label="Selected generation options"><span><small>Experience</small><strong>{selection.name}</strong></span><span><small>Frame style</small><strong>{frameStyle?.name || 'Natural'}</strong></span><span><small>Ornaments</small><strong>{ornaments.length ? ornaments.map((item) => item.name).join(', ') : 'None'}</strong></span><span><small>Photo</small><strong>Ready</strong></span></div>}

      <div className="review-actions">
        <div>
          <button className="customer-inline-button" onClick={onBack} disabled={busy}>← Try another look</button>
          <button className="customer-inline-button" onClick={onReplace} disabled={busy}>Replace photo</button>
        </div>
        <div className="review-create">
          {mode === 'ADVANCED' && <span>{quotaExhausted ? 'No AI credits remaining' : aiRemaining == null ? 'AI credit confirmed when creation begins' : `${aiRemaining} AI ${aiRemaining === 1 ? 'credit' : 'credits'} available`}</span>}
          {quotaExhausted && <button className="customer-inline-button" onClick={onOpenAccount}>Create an account for 5 credits</button>}
          <button className="customer-solid-button" disabled={busy || quotaExhausted} onClick={onCreate}>
            {busy ? 'Entering your world…' : mode === 'ADVANCED' ? 'Create with AI · 1 credit' : 'Create photo'} <b>→</b>
          </button>
        </div>
      </div>
    </section>
  )
}
