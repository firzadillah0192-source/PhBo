import React, { useEffect, useState } from 'react'
import { login, logout, signup } from '../../api.js'

const ACCOUNT_MENU = [
  ['overview', 'Profile'],
  ['plan', 'Plan & Credits'],
  ['creations', 'My Creations'],
  ['personalization', 'Settings'],
]

function initials(account) {
  const source = account?.display_name || account?.email || 'Account'
  return source.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'A'
}

function AccountAvatar({ account }) {
  return account?.avatar_url
    ? <img className="customer-avatar" src={account.avatar_url} alt="" />
    : <span className="customer-avatar customer-avatar-initials" aria-hidden="true">{initials(account)}</span>
}

export default function CustomerNav({ usage, account, mode, onHome, onMode, onUsageChanged, onAccountNavigate, openRequest }) {
  const [open, setOpen] = useState(false)
  const [register, setRegister] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => setOpen(false), [mode])
  useEffect(() => { if (openRequest) setOpen(true) }, [openRequest])

  const openAccount = (tab) => {
    setOpen(false)
    onAccountNavigate?.(tab)
  }

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

  const signOut = async () => {
    setBusy(true)
    try {
      await logout()
      setOpen(false)
      await onUsageChanged()
      onHome()
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
        <button type="button" className="customer-account-trigger" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          {usage?.authenticated && <AccountAvatar account={account} />}
          <span>{usage?.authenticated ? 'Account' : 'Sign in'}</span>
          {usage?.authenticated && <b aria-hidden="true">⌄</b>}
        </button>
        {open && (
          <div className={`customer-account-popover ${usage?.authenticated ? 'is-account-menu' : ''}`}>
            {usage?.authenticated ? (
              <>
                <div className="customer-account-summary">
                  <AccountAvatar account={account} />
                  <span><strong>{account?.display_name || 'Your account'}</strong><small>{account?.email}</small></span>
                </div>
                <nav className="customer-account-menu" aria-label="Account">
                  {ACCOUNT_MENU.map(([tab, label]) => <button key={tab} type="button" onClick={() => openAccount(tab)}>{label}<b aria-hidden="true">→</b></button>)}
                </nav>
                <button type="button" className="customer-account-signout" disabled={busy} onClick={signOut}>Sign out</button>
              </>
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
