import React, { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { createResultClaim, getResult, resultDownloadUrl, resultImageUrl, uploadPreviewUrl } from '../../api.js'
import PrivateImage from './PrivateImage.jsx'
import { localeFor, useLanguage, useT } from '../../i18n.js'
const defaultDelivery = { createResultClaim, getResult, resultDownloadUrl, resultImageUrl, uploadPreviewUrl }

function claimTokenFromUrl(claimUrl) {
  try {
    const path = new URL(claimUrl, window.location.origin).pathname
    return path.startsWith('/r/') ? decodeURIComponent(path.slice(3)) : null
  } catch {
    return null
  }
}

export default function ResultStage({ resultId, uploadId, mode, chargedCredits, chargedCurrency, chargeEstimated = false, onReset, onTryLook, kiosk = false, resetSeconds = 90, delivery = defaultDelivery }) {
  const { createResultClaim, getResult, resultDownloadUrl, resultImageUrl, uploadPreviewUrl } = delivery
  const t = useT()
  const language = useLanguage()
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
      if (alive) setClaimError(error?.status === 409 ? t('Tautan QR yang valid sudah ada untuk foto ini.', 'A valid QR link already exists for this photo.') : t('Tautan QR belum bisa disiapkan.', 'We could not prepare the QR link.'))
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
      setShareMessage(t('Tautan berbagi aman sudah disalin.', 'Secure share link copied.'))
    } catch {
      setShareMessage(t('Gunakan menu bagikan browser Anda untuk membagikan foto ini.', 'Use your browser share menu to share this photo.'))
    }
  }

  const refreshClaim = () => {
    setClaimBusy(true)
    setClaimError('')
    createResultClaim(resultId, null, true, kiosk).then((next) => {
      setClaim(next)
      const token = claimTokenFromUrl(next.claim_url)
      if (token) window.sessionStorage.setItem(`photobooth:result-claim:${resultId}`, token)
    }).catch(() => setClaimError(t('Tautan QR baru belum bisa dibuat. Silakan coba lagi.', 'We could not create a new QR link. Please try again.'))).finally(() => setClaimBusy(false))
  }

  const result = claim?.image_url || resultImageUrl(resultId)
  const original = mode !== 'CLASSIC' && uploadId ? uploadPreviewUrl(uploadId) : null
  const expires = claim?.expires_at ? new Date(claim.expires_at).toLocaleString(localeFor(language), { dateStyle: 'medium', timeStyle: 'short' }) : null

  const qrBlock = claim
    ? <QRCodeSVG value={claim.qr_payload} size={238} level="M" includeMargin bgColor="#ffffff" fgColor="#111216" title={kiosk ? t('Pindai untuk menyimpan foto NXBooth Anda', 'Scan to save your Photobooth AI photo') : t('Pindai untuk melihat foto Anda', 'Scan to view your photo')} />
    : <div className="kiosk-qr-placeholder">{claimBusy ? t('Menyiapkan QR aman...', 'Preparing secure QR...') : t('QR tidak tersedia', 'QR unavailable')}</div>

  if (kiosk) {
    return (
      <section className={`kiosk-result-stage customer-stage-enter ${revealed ? 'is-revealed' : ''}`}>
        <div className="kiosk-result-heading">
          <p className="customer-kicker">{t('Pengiriman kiosk', 'Kiosk delivery')}</p>
          <h1>{t('Foto Anda', 'Your photo')}<br /><em>{t('sudah siap.', 'is ready.')}</em></h1>
          <p>{t('Pindai untuk menyimpan foto ini ke ponsel Anda.', 'Scan to save this photo to your phone.')}</p>
        </div>
        <figure className="kiosk-result-photo">
          <PrivateImage id={resultId} src={result} resolve={delivery.resolveResultImage} alt={t('Potret NXBooth Anda yang sudah jadi', 'Your finished Photobooth AI portrait')} />
        </figure>
        <div className="kiosk-claim-panel">
          {qrBlock}
          <strong>{t('Pindai untuk menyimpan', 'Scan to save')}</strong>
          <small>{expires ? t(`Tersedia hingga ${expires}.`, `Available until ${expires}.`) : t('Tersedia selama 24 jam.', 'Available for 24 hours.')}</small>
          {claimError && <p className="kiosk-claim-error">{claimError}</p>}
          {claimError && <button className="customer-inline-button" disabled={claimBusy} onClick={refreshClaim}>{claimBusy ? t('Membuat...', 'Creating...') : t('Buat tautan QR baru', 'Create a new QR link')}</button>}
        </div>
        <div className="kiosk-result-actions">
          <button className="customer-solid-button" onClick={onReset}>{t('Buat lagi', 'Create another')} <b>-&gt;</b></button>
          {remaining <= 15 && <small>{t(`Kembali ke awal dalam ${remaining} dtk.`, `Returning to start in ${remaining}s.`)}</small>}
        </div>
      </section>
    )
  }

  const chargeUnit = chargedCurrency === 'CLASSIC' ? 'Classic Credit' : chargedCurrency === 'AI' ? 'AI Credit' : t('kredit', 'credits')
  return (
    <section className={`result-stage customer-stage-enter ${revealed ? 'is-revealed' : ''}`}>
      <nav className="result-navigation" aria-label={t('Navigasi hasil', 'Result navigation')}>
        <button className="customer-inline-button" onClick={onReset}>{t('Buat lagi', 'Create another')}</button>
        <button className="customer-inline-button" onClick={onTryLook}>{t('Coba tampilan lain', 'Try another look')}</button>
      </nav>
      <header>
        <div><p className="customer-kicker">{mode === 'CLASSIC' ? 'Photo Booth' : t('Potret jadi Anda', 'Your finished portrait')}</p><h1>{mode === 'CLASSIC' ? t('Momen Anda.', 'Your moments.') : t('Anda yang lain.', 'Another you.')}</h1>{chargedCredits != null && <p>{chargeEstimated ? t('Estimasi biaya: ', 'Estimated cost: ') : ''}{t(`${chargedCredits} ${chargeUnit} dipakai untuk hasil ini.`, `${chargedCredits} ${chargeUnit} used for this result.`)}</p>}</div>
        {original && <button className={`compare-toggle ${comparing ? 'is-active' : ''}`} onClick={() => setComparing((value) => !value)}>{comparing ? t('Tutup perbandingan', 'Close comparison') : t('Bandingkan sebelum / sesudah', 'Compare before / after')}</button>}
      </header>
      <div className="result-layout">
        <figure className={`result-frame ${comparing ? 'is-comparing' : ''}`}>
          <PrivateImage id={resultId} src={result} resolve={delivery.resolveResultImage} alt={t('Potret NXBooth Anda yang sudah jadi', 'Your finished Photobooth AI portrait')} />
          {comparing && original && (
            <>
              <div className="compare-before" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}>
                <img src={original} alt={t('Potret asli Anda', 'Your original portrait')} />
                <span>{t('Sebelum', 'Before')}</span>
              </div>
              <div className="compare-divider" style={{ left: `${split}%` }}><i>&lt;-&gt;</i></div>
              <span className="compare-after">{t('Sesudah', 'After')}</span>
              <input aria-label={t('Perbandingan sebelum dan sesudah', 'Before and after comparison')} type="range" min="0" max="100" value={split} onChange={(event) => setSplit(Number(event.target.value))} />
            </>
          )}
          <div className="result-light" aria-hidden="true" />
        </figure>
        <aside className="result-side">
          <a className="customer-solid-button result-download" href={resultDownloadUrl(resultId)} download>{t('Unduh foto', 'Download photo')} <b>↓</b></a>
          <div className="result-actions">
            <button className="customer-outline-button" onClick={shareResult} disabled={claimBusy || !claim}>{t('Bagikan', 'Share')}</button>
            <button className="customer-outline-button" onClick={() => window.print()}>{t('Cetak', 'Print')}</button>
            {printDownload && <a className="customer-outline-button" href={printDownload} download>{t('Unduh cetak · 2 × 6 in', 'Download print · 2 × 6 in')}</a>}
          </div>
          {shareMessage && <small className="result-share-message" role="status">{shareMessage}</small>}
          <div className="result-phone-panel">
            {qrBlock}
            <div>
              <strong>{t('Pindai untuk melihat foto Anda', 'Scan to view your photo')}</strong>
              <p>{t('Tautan ini membuka halaman yang hanya berisi foto.', 'The link opens a page with the photo only.')}</p>
              {expires && <small>{t(`Tersedia hingga ${expires}.`, `Available until ${expires}.`)}</small>}
              {claimError && <p role="alert">{claimError}</p>}
              {claimError && <button className="customer-inline-button" disabled={claimBusy} onClick={refreshClaim}>{claimBusy ? t('Membuat...', 'Creating...') : t('Coba QR lagi', 'Try QR again')}</button>}
            </div>
          </div>
        </aside>
      </div>
    </section>
  )
}
