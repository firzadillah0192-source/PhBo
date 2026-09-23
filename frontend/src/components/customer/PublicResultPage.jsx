import React, { useEffect, useState } from 'react'
import { getPublicResultClaim } from '../../api.js'

function friendlyDate(value) {
  try {
    return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return ''
  }
}

export default function PublicResultPage({ token }) {
  const [claim, setClaim] = useState(null)
  const [error, setError] = useState('')
  const [shareMessage, setShareMessage] = useState('')
  const [imageError, setImageError] = useState(false)

  useEffect(() => {
    let alive = true
    setClaim(null)
    setError('')
    setImageError(false)
    setShareMessage('')
    getPublicResultClaim(token).then((data) => {
      if (alive) setClaim(data)
    }).catch(() => {
      if (alive) setError('This photo link is no longer available.')
    })
    return () => { alive = false }
  }, [token])

  const share = async () => {
    setShareMessage('')
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Photobooth AI photo', url: window.location.href })
        return
      } catch (shareError) {
        if (shareError?.name === 'AbortError') return
      }
    }
    try {
      await navigator.clipboard.writeText(window.location.href)
      setShareMessage('Link copied. You can share it from your phone.')
    } catch {
      setShareMessage('Use your browser share menu to send this photo.')
    }
  }

  const download = async (event) => {
    event.preventDefault()
    setShareMessage('')
    try {
      const response = await fetch(claim.download_url)
      if (!response.ok) throw new Error('download unavailable')
      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[claim.content_type] || 'image'
      link.download = `photobooth-result.${extension}`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
    } catch {
      setShareMessage('We could not download your photo right now. Please try again.')
    }
  }

  if (error) {
    return <main className="public-claim-page public-claim-error"><p className="public-claim-kicker">Photobooth AI</p><h1>This photo link is no longer available.</h1><p>The link may have expired or been revoked.</p></main>
  }

  if (!claim) {
    return <main className="public-claim-page public-claim-loading"><span className="public-claim-loader" /><p>Loading your photo...</p></main>
  }

  return (
    <main className="public-claim-page">
      <p className="public-claim-kicker">Photobooth AI</p>
      <h1>Your photo<br /><em>is ready.</em></h1>
      <figure className="public-claim-photo">{imageError ? <p className="public-claim-image-error">We could not load your photo right now. Please try again.</p> : <img src={claim.image_url} alt="Your Photobooth AI photo" onError={() => setImageError(true)} />}</figure>
      <p className="public-claim-expiry">Available until {friendlyDate(claim.expires_at)}.</p>
      <div className="public-claim-actions">
        <a className="public-claim-download" href={claim.download_url} onClick={download}>Download photo <b>-&gt;</b></a>
        <button className="public-claim-share" onClick={share}>Share</button>
      </div>
      {shareMessage && <p className="public-claim-message" role="status">{shareMessage}</p>}
    </main>
  )
}
