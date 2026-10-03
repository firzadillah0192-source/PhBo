import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  clearGoogleIdentityHandler,
  initializeGoogleIdentity,
  loadGoogleIdentity,
} from '../../googleIdentity.js'

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() || ''

export default function GoogleSignInButton({ text, disabled = false, onCredential }) {
  const container = useRef(null)
  const onCredentialRef = useRef(onCredential)
  const [status, setStatus] = useState(CLIENT_ID ? 'loading' : 'unconfigured')
  onCredentialRef.current = onCredential

  const dispatchCredential = useCallback((credential) => {
    onCredentialRef.current?.(credential)
  }, [])

  useEffect(() => {
    if (!CLIENT_ID) return undefined
    let active = true

    loadGoogleIdentity().then((identity) => {
      if (!active || !container.current) return
      initializeGoogleIdentity(identity, CLIENT_ID, dispatchCredential)
      identity.renderButton(container.current, {
        theme: 'outline',
        size: 'large',
        type: 'standard',
        text,
        shape: 'rectangular',
        logo_alignment: 'left',
        width: Math.min(292, Math.floor(container.current.getBoundingClientRect().width || 292)),
      })
      setStatus('ready')
    }).catch(() => {
      if (active) setStatus('unavailable')
    })

    return () => {
      active = false
      clearGoogleIdentityHandler(dispatchCredential)
      container.current?.replaceChildren()
    }
  }, [dispatchCredential, text])

  if (!CLIENT_ID) {
    return <p className="google-signin-status" role="status">Google sign-in is not configured yet.</p>
  }

  return <div className="google-signin-wrap">
    {status === 'loading' && <p className="google-signin-status" role="status">Loading Google sign-in…</p>}
    {status === 'unavailable' && <p className="google-signin-status customer-form-error" role="alert">Google sign-in could not load. Please try again or use email and password.</p>}
    <div
      className={`google-signin-button ${disabled ? 'is-disabled' : ''}`}
      ref={container}
      aria-label="Sign in with Google"
      aria-busy={status === 'loading'}
    />
  </div>
}
