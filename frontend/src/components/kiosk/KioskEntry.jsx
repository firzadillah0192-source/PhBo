import React, { useEffect, useState } from 'react'
import KioskAccessGate from './KioskAccessGate.jsx'
import KioskPreview from './KioskPreview.jsx'

export default function KioskEntry({ children }) {
  const [path, setPath] = useState(window.location.pathname)
  useEffect(() => {
    const update = () => setPath(window.location.pathname)
    window.addEventListener('popstate', update)
    return () => window.removeEventListener('popstate', update)
  }, [])
  const kiosk=path==='/kiosk'||path.startsWith('/kiosk/')
  if(!kiosk)return children
  return <KioskAccessGate><KioskPreview/></KioskAccessGate>
}
