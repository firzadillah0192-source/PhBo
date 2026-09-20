import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createGeneration, getGeneration, getHealth, getTemplates, uploadPhoto } from './api.js'
import { ErrorBanner, HealthBadge, Stepper, toError } from './components/common.jsx'
import { ModeStep, TemplateStep, UploadStep } from './components/UploadSteps.jsx'
import { ProcessingStep, ResultStep } from './components/ResultSteps.jsx'

const POLL_INTERVAL_MS = 1500

/**
 * Root component. Owns the vertical-slice state machine:
 *   mode -> template/experience -> upload -> processing (poll) -> result
 *
 * Generation is asynchronous by contract (spec section 13): POST returns a
 * job_id, we poll until COMPLETED (result_id) or FAILED (error_code).
 */
export default function App() {
  const [health, setHealth] = useState(null)
  const [templates, setTemplates] = useState([])
  const [step, setStep] = useState('mode')
  const [mode, setMode] = useState(null)

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
          setStep('failed')
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
      setStep('ready')
    } catch (err) {
      setError(toError(err, 'Upload failed.'))
    } finally {
      setBusy(false)
    }
  }, [])

  const startGeneration = useCallback(async () => {
    if (!upload || !selectedTemplateId || mode !== 'ADVANCED') return
    setBusy(true)
    setError(null)
    setJob(null)
    try {
      const created = await createGeneration(upload.upload_id, selectedTemplateId, mode)
      setJob(created)
      setStep('processing')
      startPolling(created.job_id)
    } catch (err) {
      setError(toError(err, 'Could not start generation.'))
      setBusy(false)
    }
  }, [upload, selectedTemplateId, mode, startPolling])

  const chooseMode = useCallback((selectedMode) => {
    setMode(selectedMode)
    setUpload(null)
    setSelectedTemplateId(templates[0]?.id ?? null)
    setError(null)
    setStep('template')
  }, [templates])

  const reset = useCallback(() => {
    clearInterval(pollRef.current)
    setUpload(null)
    setMode(null)
    setJob(null)
    setError(null)
    setStep('mode')
    setBusy(false)
  }, [])

  return (
    <div className="app">
      <header className="header">
        <h1>Photobooth AI</h1>
        <p className="subtitle">Choose → Upload → Generate → Preview → Download</p>
        <HealthBadge health={health} />
      </header>

      <Stepper step={step} />

      {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

      {mode === 'ADVANCED' && health && !health.ai_provider_connected && (
        <div className="warn-banner">
          <strong>Generate AI is not connected yet.</strong> You can try the workflow, but generation
          will report a failure until the AI service is ready.
        </div>
      )}

      <main className="main">
        {step === 'mode' && <ModeStep onSelect={chooseMode} />}

        {(step === 'template' || step === 'ready') && (
          <TemplateStep
            upload={upload}
            mode={mode}
            templates={templates}
            selectedTemplateId={selectedTemplateId}
            onSelect={setSelectedTemplateId}
            onGenerate={startGeneration}
            onContinue={() => setStep('upload')}
            onChangePhoto={() => setStep('upload')}
            busy={busy}
          />
        )}

        {step === 'upload' && (
          <UploadStep busy={busy} onFile={handleFile} mode={mode} onBack={() => setStep('template')} />
        )}

        {step === 'processing' && <ProcessingStep job={job} upload={upload} />}

        {step === 'failed' && (
          <section className="card">
            <h2>Could not generate a result</h2>
            <p className="hint">No image was created for this request.</p>
            <div className="actions"><button onClick={reset}>Start over</button></div>
          </section>
        )}

        {step === 'result' && job?.result_id && <ResultStep job={job} onReset={reset} />}
      </main>

      <footer className="footer">
        <span>Web MVP · vertical slice</span>
      </footer>
    </div>
  )
}
