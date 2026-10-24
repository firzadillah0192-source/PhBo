import { useEffect, useRef, useState } from 'react'
// @ts-ignore Reuse production's Google SDK lifecycle.
import { loadGoogleIdentity, initializeGoogleIdentity, clearGoogleIdentityHandler } from '../../frontend/src/googleIdentity.js'
import { message } from './api'

export function GoogleSignIn({ signIn, onSuccess }: { signIn: (token: string) => Promise<any>; onSuccess: () => void | Promise<void> }) {
  const host = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let stopped = false
    const clientId = (import.meta as any).env.VITE_GOOGLE_CLIENT_ID
    const credential = async (token: string) => {
      try { setError(''); await signIn(token); if (!stopped) await onSuccess() }
      catch (e) { if (!stopped) setError(message(e)) }
    }
    if (!clientId) { setError('Google sign-in is not configured.'); return }
    loadGoogleIdentity().then((identity: any) => {
      if (stopped || !host.current) return
      initializeGoogleIdentity(identity, clientId, credential)
      identity.renderButton(host.current, { theme: 'outline', size: 'large', width: 280 })
    }).catch((e: any) => { if (!stopped) setError(message(e)) })
    return () => { stopped = true; clearGoogleIdentityHandler(credential) }
  }, [signIn, onSuccess])
  return <div><div ref={host} />{error && <p role="alert" className="mt-2 text-danger">{error}</p>}</div>
}
