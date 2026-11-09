import React, { useEffect, useState } from 'react'
import { resultDownloadUrl, resultImageUrl, uploadPreviewUrl } from '../../api.js'

export default function ResultStage({ resultId, uploadId, onReset, onTryLook }) {
  const [revealed, setRevealed] = useState(false)
  const [comparing, setComparing] = useState(false)
  const [split, setSplit] = useState(50)

  useEffect(() => {
    const timer = window.setTimeout(() => setRevealed(true), 70)
    return () => window.clearTimeout(timer)
  }, [resultId])

  const result = resultImageUrl(resultId)
  const original = uploadId ? uploadPreviewUrl(uploadId) : null

  return (
    <section className={`result-stage customer-stage-enter ${revealed ? 'is-revealed' : ''}`}>
      <header>
        <div><p className="customer-kicker">Celestial master print</p><h1>Another you.</h1></div>
        {original && <button className={`compare-toggle ${comparing ? 'is-active' : ''}`} onClick={() => setComparing((value) => !value)}>{comparing ? 'Close comparison' : 'Compare before / after'}</button>}
      </header>

      <figure className={`result-frame ${comparing ? 'is-comparing' : ''}`}>
        <img src={result} alt="Your finished Photobooth AI portrait" />
        {comparing && original && (
          <>
            <div className="compare-before" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}>
              <img src={original} alt="Your original portrait" />
              <span>Before</span>
            </div>
            <div className="compare-divider" style={{ left: `${split}%` }}><i>↔</i></div>
            <span className="compare-after">After</span>
            <input aria-label="Before and after comparison" type="range" min="0" max="100" value={split} onChange={(event) => setSplit(Number(event.target.value))} />
          </>
        )}
        <div className="result-light" aria-hidden="true" />
      </figure>

      <footer>
        <div>
          <button className="customer-inline-button" onClick={onReset}>Create another</button>
          <button className="customer-inline-button" onClick={onTryLook}>Try another look</button>
        </div>
        <a className="customer-solid-button" href={resultDownloadUrl(resultId)} download>Download portrait <b>↓</b></a>
      </footer>
    </section>
  )
}
