import React, { useEffect, useState } from 'react'
import { login, logout, signup } from '../../api.js'

export default function CustomerNav({ usage, mode, onHome, onMode, onUsageChanged, openRequest }) {
  const [open, setOpen] = useState(false)
  const [register, setRegister] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => setOpen(false), [mode])
  useEffect(() => { if (openRequest) setOpen(true) }, [openRequest])

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      if (register) await signup(email, password)
      else await login(email, password)
      setPassword('')
      setOpen(false)
      await onUsageChanged()
    } catch {
      setMessage(register ? 'We could not create that account.' : 'Those sign-in details did not work.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <header className="customer-nav">
      <button type="button" className="customer-logo" onClick={onHome}><span aria-hidden="true" />Photobooth AI</button>
      <nav className="customer-mode-nav" aria-label="Studios">
        <button className={mode === 'BASIC' ? 'is-active' : ''} onClick={() => onMode('BASIC')}>Basic</button>
        <button className={mode === 'ADVANCED' ? 'is-active' : ''} onClick={() => onMode('ADVANCED')}>Advanced</button>
      </nav>
      <div className="customer-account">
        {usage && <span className="customer-credit">{usage.ai_remaining} AI {usage.ai_remaining === 1 ? 'credit' : 'credits'}</span>}
        <button type="button" className="customer-account-trigger" onClick={() => setOpen((value) => !value)}>{usage?.authenticated ? 'Account' : 'Sign in'}</button>
        {open && (
          <div className="customer-account-popover">
            {usage?.authenticated ? (
              <><p>Signed in as</p><strong>{usage.email || 'Your account'}</strong><button type="button" onClick={async () => { await logout(); setOpen(false); await onUsageChanged() }}>Sign out</button></>
            ) : (
              <form onSubmit={submit}>
                <p className="customer-kicker">{register ? 'Join the studio' : 'Welcome back'}</p>
                <h2>{register ? 'Create your account' : 'Sign in'}</h2>
                {register && <small>Includes 5 complimentary AI credits.</small>}
                <label>Email<input type="email" value={email} required onChange={(event) => setEmail(event.target.value)} /></label>
                <label>Password<input type="password" minLength="8" value={password} required onChange={(event) => setPassword(event.target.value)} /></label>
                {message && <p className="customer-form-error">{message}</p>}
                <button className="customer-solid-button" disabled={busy} type="submit">{busy ? 'One moment…' : register ? 'Create account' : 'Sign in'}</button>
                <button className="customer-inline-button" type="button" onClick={() => { setRegister((value) => !value); setMessage('') }}>{register ? 'Already have an account?' : 'Create an account'}</button>
              </form>
            )}
          </div>
        )}
      </div>
    </header>
  )
}
