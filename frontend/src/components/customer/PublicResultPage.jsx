import React, { useEffect, useState } from 'react'
import { useT } from '../../i18n.js'
import './publicResult.css'

export default function PublicResultPage({ token }) {
  const t = useT()
  const [imageError, setImageError] = useState(false)

  useEffect(() => {
    setImageError(false)
  }, [token])

  if (imageError) return <main className="public-photo-viewer public-photo-viewer-error" role="alert">{t('Tautan foto ini sudah tidak tersedia.', 'This photo link is no longer available.')}</main>
  return (
    <main className="public-photo-viewer">
      <img
        src={`/api/public/results/${encodeURIComponent(token)}/image`}
        alt={t('Foto Anda', 'Your photo')}
        onError={() => setImageError(true)}
      />
    </main>
  )
}
