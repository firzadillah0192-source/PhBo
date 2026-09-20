import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createGeneration, getGeneration, getHealth, getTemplates, uploadPhoto } from './api.js'
import { ErrorBanner, HealthBadge, Stepper, toError } from './components/common.jsx'
import { TemplateStep, UploadStep } from './components/UploadSteps.jsx'
import { ProcessingStep, ResultStep } from './components/ResultSteps.jsx'

const POLL_INTERVAL_MS = 1500

/**
 * Root component. Owns the vertical-slice state machine:
 *   upload -> template -> processing (poll) -> result
 *
 * Generation is asynchronous by contract (spec section 13): POST returns a
 * job_id, we poll until COMPLETED (result_id) or FAILED (error_code).
 */
export default function App() {
  const [health, setHealth] = useState(null)
  const [templates, setTemplates] = useState([])
  const [step, setStep] = useState('upload')

  const [upload, setUpload] = useState(null)
  const [selectedTemplateId, setSelectedTemplateId] = useState(null)

  const [job, setJob] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const pollRef = useRef(null)

  // Load health + templates once on mount.
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const h = await getHealth()
        if (alive) setHealth(h)
      } catch (err) {
        if (alive) setError(toError(err, 'Could not reach the API. Is the backend running?'))
      }
      try {
        const t = await getTemplates()
        if (alive) {
          setTemplates(t.templates || [])
          if (t.templates?.length >= 1) setSelectedTemplateId(t.templates[0].id)
        }
      } catch (err) {
        if (alive) setError(toError(err, 'Could not load templates.'))
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  // Stop polling on unmount.
  useEffect(() => () => clearInterval(pollRef.current), [])

  const startPolling = useCallback((jobId) => {
    clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const status = await getGeneration(jobId)
        setJob(status)
        if (status.state === 'COMPLETED') {
          clearInterval(pollRef.current)
          setStep('result')
          setBusy(false)
        } else if (status.state === 'FAILED') {
          clearInterval(pollRef.current)
          setBusy(false)
          setError({
            title: 'Generation failed',
            code: status.error_code,
            message: status.error_message,
          })
        }
      } catch (err) {
        clearInterval(pollRef.current)
        setBusy(false)
        setError(toError(err, 'Lost contact with the API while polling.'))
      }
    }, POLL_INTERVAL_MS)
  }, [])

  const handleFile = useCallback(async (file) => {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const uploaded = await uploadPhoto(file)
      setUpload(uploaded)
      setStep('template')
    } catch (err) {
      setError(toError(err, 'Upload failed.'))
    } finally {
      setBusy(false)
    }
  }, [])

  const startGeneration = useCallback(async () => {
    if (!upload || !selectedTemplateId) return
    setBusy(true)
    setError(null)
    setJob(null)
    try {
      const created = await createGeneration(upload.upload_id, selectedTemplateId)
      setJob(created)
      setStep('processing')
      startPolling(created.job_id)
    } catch (err) {
      setError(toError(err, 'Could not start generation.'))
      setBusy(false)
    }
  }, [upload, selectedTemplateId, startPolling])

  const reset = useCallback(() => {
    clearInterval(pollRef.current)
    setUpload(null)
    setJob(null)
    setError(null)
    setStep('upload')
    setBusy(false)
  }, [])

  return (
    <div className="app">
      <header className="header">
        <h1>Photobooth AI</h1>
        <p className="subtitle">Upload → Validate → Template → Generate → Preview → Download</p>
        <HealthBadge health={health} />
      </header>

      <Stepper step={step} />

      {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

      {!health?.ai_provider_connected && (
        <div className="warn-banner">
          <strong>AI_PROVIDER_NOT_CONNECTED</strong> — no AI provider is configured, so generation
          will fail with that explicit error. Set <code>AI_PROVIDER</code> +{' '}
          <code>NINEROUTER_API_KEY</code> to enable real generation. Upload, validation and the job
          pipeline still work end-to-end.
        </div>
      )}

      <main className="main">
        {step === 'upload' && (
          <UploadStep busy={busy} onFile={handleFile} hasUpload={!!upload} />
        )}

        {step === 'template' && upload && (
          <TemplateStep
            upload={upload}
            templates={templates}
            selectedTemplateId={selectedTemplateId}
            onSelect={setSelectedTemplateId}
            onGenerate={startGeneration}
            busy={busy}
          />
        )}

        {step === 'processing' && <ProcessingStep job={job} upload={upload} />}

        {step === 'result' && job?.result_id && <ResultStep job={job} onReset={reset} />}
      </main>

      <footer className="footer">
        <span>Web MVP · vertical slice</span>
      </footer>
    </div>
  )
}
