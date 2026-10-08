import React, { useEffect, useState } from 'react'
import KioskPreview from './KioskPreview.jsx'

export default function KioskEntry({ children }) {
  const [path, setPath] = useState(window.location.pathname)
  useEffect(() => {
    const update = () => setPath(window.location.pathname)
    window.addEventListener('popstate', update)
    return () => window.removeEventListener('popstate', update)
  }, [])
  return path.replace(/\/$/, '') === '/kiosk' ? <KioskPreview /> : children
}
