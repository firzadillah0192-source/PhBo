import React from 'react'
import { ApiError } from '../api.js'

/** Shared UI primitives: health badge, workflow stepper, error banner. */

export function HealthBadge({ health }) {
  if (!health) return <div className="badge badge-unknown">checking…</div>
  const ok = health.status === 'ok'
  const aiOk = health.ai_provider_connected
  return (
    <div className="badges">
      <div className={'badge ' + (ok ? 'badge-ok' : 'badge-warn')}>API: {health.status}</div>
      <div className={'badge ' + (aiOk ? 'badge-ok' : 'badge-warn')}>
        AI: {aiOk ? health.ai_provider : 'NOT CONNECTED'}
      </div>
    </div>
  )
}

const STEPS = ['upload', 'template', 'processing', 'result']

const STEP_LABELS = {
  upload: '1 · Upload',
  template: '2 · Template',
  processing: '3 · Processing',
  result: '4 · Result',
}

export function Stepper({ step }) {
  return (
    <ol className="stepper">
      {STEPS.map((s) => (
        <li key={s} className={'step ' + (s === step ? 'step-active' : '')}>
          {STEP_LABELS[s] || s}
        </li>
      ))}
    </ol>
  )
}

export function ErrorBanner({ error, onDismiss }) {
  return (
    <div className="error" role="alert">
      <div className="error-head">
        <strong>{error.title || 'Error'}</strong>
        {error.code && <code className="error-code">{error.code}</code>}
        <button className="link" onClick={onDismiss}>
          dismiss
        </button>
      </div>
      {error.message && <p className="error-msg">{error.message}</p>}
      {error.detail && <pre className="error-detail">{String(error.detail).slice(0, 1200)}</pre>}
    </div>
  )
}

/** Normalise any thrown value into the shape ErrorBanner expects. */
export function toError(err, fallbackTitle) {
  if (err instanceof ApiError) {
    return { title: fallbackTitle, code: err.errorCode, message: err.message, detail: err.detail }
  }
  return { title: fallbackTitle, message: err?.message || String(err) }
}
