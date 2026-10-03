import React, { useEffect, useState } from 'react'
import './publicResult.css'

export default function PublicResultPage({ token }) {
  const [imageError, setImageError] = useState(false)

  useEffect(() => {
    setImageError(false)
  }, [token])

  if (imageError) return <main className="public-photo-viewer public-photo-viewer-error" role="alert">This photo link is no longer available.</main>
  return (
    <main className="public-photo-viewer">
      <img
        src={`/api/public/results/${encodeURIComponent(token)}/image`}
        alt="Your photo"
        onError={() => setImageError(true)}
      />
    </main>
  )
}
