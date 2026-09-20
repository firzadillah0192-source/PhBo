import React from 'react'
import { resultDownloadUrl, resultImageUrl, uploadPreviewUrl } from '../api.js'

/** Step 3 — processing: polls job state, shows spinner + state. */
export function ProcessingStep({ job, upload }) {
  const state = job?.state || 'QUEUED'
  return (
    <section className="card">
      <h2>Processing</h2>
      <div className="split">
        {upload && (
          <div className="preview-box">
            <h3>Your photo</h3>
            <img src={uploadPreviewUrl(upload.upload_id)} alt="Your uploaded" />
          </div>
        )}
        <div className="processing">
          <div className="spinner" aria-hidden="true" />
          <p className="state">
            State: <strong>{state}</strong>
          </p>
          {job?.job_id && <p className="meta">job {job.job_id}</p>}
          {job?.provider && (
            <p className="meta">
              provider {job.provider} · {job.model}
            </p>
          )}
          <p className="hint">AI generation can take a while. This page polls the job state.</p>
        </div>
      </div>
    </section>
  )
}

/** Step 4 — result: preview + download. */
export function ResultStep({ job, onReset }) {
  const resultId = job.result_id
  return (
    <section className="card">
      <h2>Your result</h2>
      <div className="result-box">
        <img src={resultImageUrl(resultId)} alt="Generated result" />
      </div>
      <p className="meta">
        job {job.job_id} · template {job.template_id}
        {job.provider && (
          <>
            {' '}
            · provider {job.provider} · {job.model}
          </>
        )}
      </p>
      <div className="actions">
        <a className="primary" href={resultDownloadUrl(resultId)} download>
          Download
        </a>
        <button onClick={onReset}>Start over</button>
      </div>
    </section>
  )
}
