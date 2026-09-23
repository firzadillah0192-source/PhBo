import React, { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { createResultClaim, resultImageUrl } from '../../api.js'

function tokenFromClaimUrl(value) {
  try {
    const path = new URL(value, window.location.origin).pathname
    return path.startsWith('/r/') ? decodeURIComponent(path.slice(3)) : null
  } catch {
    return null
  }
}

export default function KioskResultStage({ resultId, onReset, resetSeconds = 90 }) {
  const [claim, setClaim] = useState(null)
  const [busy, setBusy] = useState(true)
  const [message, setMessage] = useState('')
  const [remaining, setRemaining] = useState(resetSeconds)
  const key = `photobooth:result-claim:${resultId}`

  const loadClaim = (refresh = false) => {
    setBusy(true)
    setMessage('')
    const reuseToken = refresh ? null : window.sessionStorage.getItem(key)
    createResultClaim(resultId, reuseToken, refresh, true).then((next) => {
      setClaim(next)
      const token = tokenFromClaimUrl(next.claim_url)
      if (token) window.sessionStorage.setItem(key, token)
    }).catch((error) => {
      setMessage(error?.errorCode === 'CLAIM_REFRESH_REQUIRED'
        ? 'This QR link expired or was revoked. Create a new link to continue.'
        : error?.status === 409
          ? 'A valid QR link already exists for this photo.'
          : 'We could not prepare the QR link.')
    }).finally(() => setBusy(false))
  }

  useEffect(() => {
    loadClaim()
  }, [resultId])

  useEffect(() => {
    setRemaining(resetSeconds)
    let lastActivity = Date.now()
    const activity = () => {
      lastActivity = Date.now()
      setRemaining(resetSeconds)
    }
    const interval = window.setInterval(() => {
      const remainingSeconds = Math.max(0, resetSeconds - Math.floor((Date.now() - lastActivity) / 1000))
      setRemaining(remainingSeconds)
      if (remainingSeconds === 0) {
        window.clearInterval(interval)
        onReset()
      }
    }, 1000)
    window.addEventListener('pointerdown', activity)
    window.addEventListener('keydown', activity)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('pointerdown', activity)
      window.removeEventListener('keydown', activity)
    }
  }, [onReset, resetSeconds, resultId])

  const expiry = claim?.expires_at ? new Date(claim.expires_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : null

  return (
    <section className="kiosk-result-stage customer-stage-enter">
      <div className="kiosk-result-heading">
        <p className="customer-kicker">Kiosk delivery</p>
        <h1>Your photo<br /><em>is ready.</em></h1>
        <p>Scan to save this photo to your phone.</p>
      </div>
      <figure className="kiosk-result-photo">
        <img src={claim?.image_url || resultImageUrl(resultId)} alt="Your finished Photobooth AI portrait" />
      </figure>
      <div className="kiosk-claim-panel">
        {claim ? <QRCodeSVG value={claim.qr_payload} size={238} level="M" includeMargin bgColor="#ffffff" fgColor="#111216" title="Scan to save your Photobooth AI photo" /> : <div className="kiosk-qr-placeholder">{busy ? 'Preparing secure QR...' : 'QR unavailable'}</div>}
        <strong>Scan to save</strong>
        <small>{expiry ? `Available until ${expiry}.` : 'Available for 24 hours.'}</small>
        {message && <p className="kiosk-claim-error">{message}</p>}
        {message && <button className="customer-inline-button" disabled={busy} onClick={() => loadClaim(true)}>{busy ? 'Creating...' : 'Create a new QR link'}</button>}
      </div>
      <div className="kiosk-result-actions">
        <button className="customer-solid-button" onClick={onReset}>Create another <b>-&gt;</b></button>
        {remaining <= 15 && <small>Returning to start in {remaining}s.</small>}
      </div>
    </section>
  )
}
