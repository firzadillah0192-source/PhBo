import React, { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { createResultClaim, getResult, resultDownloadUrl, resultImageUrl, uploadPreviewUrl } from '../../api.js'
import PrivateImage from './PrivateImage.jsx'
const defaultDelivery = { createResultClaim, getResult, resultDownloadUrl, resultImageUrl, uploadPreviewUrl }

function claimTokenFromUrl(claimUrl) {
  try {
    const path = new URL(claimUrl, window.location.origin).pathname
    return path.startsWith('/r/') ? decodeURIComponent(path.slice(3)) : null
  } catch {
    return null
  }
}

export default function ResultStage({ resultId, uploadId, mode, chargedCredits, chargeEstimated = false, onReset, onTryLook, kiosk = false, resetSeconds = 90, delivery = defaultDelivery }) {
  const { createResultClaim, getResult, resultDownloadUrl, resultImageUrl, uploadPreviewUrl } = delivery
  const [revealed, setRevealed] = useState(false)
  const [comparing, setComparing] = useState(false)
  const [split, setSplit] = useState(50)
  const [claim, setClaim] = useState(null)
  const [claimBusy, setClaimBusy] = useState(true)
  const [claimError, setClaimError] = useState('')
  const [shareMessage, setShareMessage] = useState('')
  const [remaining, setRemaining] = useState(resetSeconds)
  const [printDownload, setPrintDownload] = useState(null)

  useEffect(() => {
    let alive = true
    setPrintDownload(null)
    if (mode === 'CLASSIC') getResult(resultId).then((metadata) => { if (alive) setPrintDownload(metadata.print_download_url || null) }).catch(() => {})
    return () => { alive = false }
  }, [resultId, mode, delivery])

  useEffect(() => {
    const timer = window.setTimeout(() => setRevealed(true), 70)
    return () => window.clearTimeout(timer)
  }, [resultId])

  useEffect(() => {
    const key = `photobooth:result-claim:${resultId}`
    let alive = true
    setClaim(null)
    setClaimBusy(true)
    setClaimError('')
    const reuseToken = window.sessionStorage.getItem(key)

    const prepareClaim = async () => {
      try {
        return await createResultClaim(resultId, reuseToken, false, kiosk)
      } catch (error) {
        if (error?.errorCode !== 'CLAIM_REFRESH_REQUIRED') throw error
        return createResultClaim(resultId, null, true, kiosk)
      }
    }

    prepareClaim().then((next) => {
      if (!alive) return
      setClaim(next)
      const token = claimTokenFromUrl(next.claim_url)
      if (token) window.sessionStorage.setItem(key, token)
    }).catch((error) => {
      if (alive) setClaimError(error?.status === 409 ? 'A valid QR link already exists for this photo.' : 'We could not prepare the QR link.')
    }).finally(() => {
      if (alive) setClaimBusy(false)
    })
    return () => { alive = false }
  }, [kiosk, resultId, delivery])

  useEffect(() => {
    if (!kiosk) return undefined
    setRemaining(resetSeconds)
    const interval = window.setInterval(() => {
      setRemaining((value) => {
        if (value <= 1) {
          window.clearInterval(interval)
          onReset()
          return 0
        }
        return value - 1
      })
    }, 1000)
    return () => window.clearInterval(interval)
  }, [kiosk, onReset, resetSeconds, resultId])

  const shareResult = async () => {
    setShareMessage('')
    if (!claim?.claim_url) return
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Photobooth AI photo', url: claim.claim_url })
        return
      } catch (error) {
        if (error?.name === 'AbortError') return
      }
    }
    try {
      await navigator.clipboard.writeText(claim.claim_url)
      setShareMessage('Secure share link copied.')
    } catch {
      setShareMessage('Use your browser share menu to share this photo.')
    }
  }

  const refreshClaim = () => {
    setClaimBusy(true)
    setClaimError('')
    createResultClaim(resultId, null, true, kiosk).then((next) => {
      setClaim(next)
      const token = claimTokenFromUrl(next.claim_url)
      if (token) window.sessionStorage.setItem(`photobooth:result-claim:${resultId}`, token)
    }).catch(() => setClaimError('We could not create a new QR link. Please try again.')).finally(() => setClaimBusy(false))
  }

  const result = claim?.image_url || resultImageUrl(resultId)
  const original = mode !== 'CLASSIC' && uploadId ? uploadPreviewUrl(uploadId) : null
  const expires = claim?.expires_at ? new Date(claim.expires_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : null

  if (kiosk) {
    return (
      <section className={`kiosk-result-stage customer-stage-enter ${revealed ? 'is-revealed' : ''}`}>
        <div className="kiosk-result-heading">
          <p className="customer-kicker">Kiosk delivery</p>
          <h1>Your photo<br /><em>is ready.</em></h1>
          <p>Scan to save this photo to your phone.</p>
        </div>
        <figure className="kiosk-result-photo">
          <PrivateImage id={resultId} src={result} resolve={delivery.resolveResultImage} alt="Your finished Photobooth AI portrait" />
        </figure>
        <div className="kiosk-claim-panel">
          {claim ? <QRCodeSVG value={claim.qr_payload} size={238} level="M" includeMargin bgColor="#ffffff" fgColor="#111216" title="Scan to save your Photobooth AI photo" /> : <div className="kiosk-qr-placeholder">{claimBusy ? 'Preparing secure QR...' : 'QR unavailable'}</div>}
          <strong>Scan to save</strong>
          <small>{expires ? `Available until ${expires}.` : 'Available for 24 hours.'}</small>
          {claimError && <p className="kiosk-claim-error">{claimError}</p>}
          {claimError && <button className="customer-inline-button" disabled={claimBusy} onClick={refreshClaim}>{claimBusy ? 'Creating...' : 'Create a new QR link'}</button>}
        </div>
        <div className="kiosk-result-actions">
          <button className="customer-solid-button" onClick={onReset}>Create another <b>-&gt;</b></button>
          {remaining <= 15 && <small>Returning to start in {remaining}s.</small>}
        </div>
      </section>
    )
  }

  return (
    <section className={`result-stage customer-stage-enter ${revealed ? 'is-revealed' : ''}`}>
      <header>
        <div><p className="customer-kicker">{mode === 'CLASSIC' ? 'Photo Booth' : 'Your finished portrait'}</p><h1>{mode === 'CLASSIC' ? 'Your moments.' : 'Another you.'}</h1>{chargedCredits != null && <p>{chargeEstimated ? 'Estimasi biaya: ' : ''}{chargedCredits} kredit dipakai untuk hasil ini.</p>}</div>
        {original && <button className={`compare-toggle ${comparing ? 'is-active' : ''}`} onClick={() => setComparing((value) => !value)}>{comparing ? 'Close comparison' : 'Compare before / after'}</button>}
      </header>
      <figure className={`result-frame ${comparing ? 'is-comparing' : ''}`}>
        <PrivateImage id={resultId} src={result} resolve={delivery.resolveResultImage} alt="Your finished Photobooth AI portrait" />
        {comparing && original && (
          <>
            <div className="compare-before" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}>
              <img src={original} alt="Your original portrait" />
              <span>Before</span>
            </div>
            <div className="compare-divider" style={{ left: `${split}%` }}><i>&lt;-&gt;</i></div>
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
          <button className="customer-inline-button" onClick={shareResult} disabled={claimBusy || !claim}>Share</button>
          <button className="customer-inline-button" onClick={() => window.print()}>Print</button>
          {printDownload && <a className="customer-inline-button" href={printDownload} download>Download print · 2 × 6 in</a>}
          {shareMessage && <small className="result-share-message" role="status">{shareMessage}</small>}
        </div>
        <a className="customer-solid-button" href={resultDownloadUrl(resultId)} download>Download photo <b>v</b></a>
      </footer>
      <div className="result-phone-panel">
        {claim ? <QRCodeSVG value={claim.qr_payload} size={238} level="M" includeMargin bgColor="#ffffff" fgColor="#111216" title="Scan to view your photo" /> : <div className="kiosk-qr-placeholder">{claimBusy ? 'Preparing secure QR...' : 'QR unavailable'}</div>}
        <div>
          <strong>Scan to view your photo</strong>
          <p>The link opens a page with the photo only.</p>
          {expires && <small>Available until {expires}.</small>}
          {claimError && <p role="alert">{claimError}</p>}
          {claimError && <button className="customer-inline-button" disabled={claimBusy} onClick={refreshClaim}>{claimBusy ? 'Creating...' : 'Try QR again'}</button>}
        </div>
      </div>
    </section>
  )
}
