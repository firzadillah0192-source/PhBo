import React from 'react'
import { uploadPreviewUrl } from '../../api.js'

export default function ProcessingStage({ job, upload, previewUrl }) {
  const state = job?.state || 'QUEUED'
  const copy = state === 'QUEUED'
    ? ['Preparing your portrait', 'The studio is setting the light and opening your place in the queue.']
    : ['Building your world', 'Atmosphere, character, and photographic detail are coming together.']
  const classicCopy = state === 'QUEUED' ? ['Preparing your photo strip', 'Your photographs are ready for composition.'] : ['Composing your photo strip', 'The selected frame is being placed over your photographs.']
  const uploadId = upload?.upload_id || job?.upload_id

  return (
    <section className="processing-stage customer-stage-enter" aria-live="polite">
      <div className="processing-portal">
        <span className="processing-orbit orbit-one" aria-hidden="true" />
        <span className="processing-orbit orbit-two" aria-hidden="true" />
        <figure>
          {(uploadId || previewUrl) && <img src={previewUrl || uploadPreviewUrl(uploadId)} alt="Your portrait being prepared" />}
          <i className="processing-light" />
          <span className="processing-depth" />
          <span className="processing-mist" />
        </figure>
      </div>
      <div className="processing-copy">
        <p className="customer-kicker">{job?.mode === 'CLASSIC' ? 'Classic photobooth' : 'In the celestial studio'}</p>
        <h1>{(job?.mode === 'CLASSIC' ? classicCopy : copy)[0]}</h1>
        <p>{(job?.mode === 'CLASSIC' ? classicCopy : copy)[1]}</p>
        <span className="processing-pulse"><i />{state === 'QUEUED' ? 'Waiting for the studio' : 'Creating your image'}</span>
        <small>No need to keep this page open. Your studio route is saved.</small>
      </div>
    </section>
  )
}
