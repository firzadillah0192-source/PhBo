import React, { useEffect, useId, useRef, useState } from 'react'
import { login, logout, signInWithGoogle, signup } from '../../api.js'
import GoogleSignInButton from './GoogleSignInButton.jsx'
import { LanguageToggle } from './LanguageSwitch.jsx'
import { useT } from '../../i18n.js'

const ACCOUNT_MENU = [
  ['overview', 'Profil', 'Profile'],
  ['plan', 'Paket & Kredit', 'Plans & Credits'],
  ['creations', 'Kreasi Saya', 'My Creations'],
  ['personalization', 'Pengaturan', 'Settings'],
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

export default function CustomerNav({ usage, account, mode, onHome, onMode, onUsageChanged, onAccountNavigate, openRequest, marketing = false }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [register, setRegister] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const accountRoot = useRef(null)
  const accountTrigger = useRef(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    const panel = accountRoot.current?.querySelector('.customer-account-popover')
    panel?.querySelector('input, button')?.focus()
    const closeOutside = (event) => {
      if (!accountRoot.current?.contains(event.target)) setOpen(false)
    }
    const escape = (event) => {
      if (event.key === 'Escape') {
        setOpen(false)
        accountTrigger.current?.focus()
      }
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

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
      setMessage(register ? t('Akun belum bisa dibuat.', 'We could not create that account.') : t('Email atau password tidak cocok.', 'Those sign-in details did not work.'))
    } finally {
      setBusy(false)
    }
  }

  const googleSignIn = async (credential) => {
    if (busy) return
    setBusy(true)
    setMessage('')
    try {
      await signInWithGoogle(credential)
    } catch (error) {
      const errors = {
        GOOGLE_AUTH_UNAVAILABLE: t('Masuk dengan Google belum dikonfigurasi.', 'Google sign-in is not configured yet.'),
        GOOGLE_TOKEN_INVALID: t('Google tidak dapat memverifikasi login ini. Silakan coba lagi.', 'Google could not verify this sign-in. Please try again.'),
        ACCOUNT_SUSPENDED: t('Akun ini sedang tidak tersedia.', 'This account is currently unavailable.'),
        AUTH_IDENTITY_ORPHANED: t('Akun Google ini belum terhubung ke akun NXBooth yang aktif.', 'This Google account is not linked to an active NXBooth account.'),
      }
      setMessage(errors[error?.errorCode] || t('Masuk dengan Google gagal. Coba lagi atau gunakan email dan password.', 'Google sign-in failed. Please try again or use email and password.'))
      setBusy(false)
      return
    }
    setBusy(false)
    setPassword('')
    setOpen(false)
    try {
      await onUsageChanged()
    } catch {
      window.location.reload()
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
    <header className={`customer-nav ${marketing ? 'landing-nav' : ''}`}>
      <button type="button" className="customer-logo" onClick={onHome} aria-label="NXBooth" title={t('Kembali ke beranda', 'Back to home')}><svg className="studio-logo-icon" aria-hidden="true" width="30" height="30" viewBox="0 0 30 30" fill="none"><rect x="3" y="7" width="24" height="19" rx="5" stroke="currentColor" strokeWidth="2" /><path d="M9 7l2-3h8l2 3" stroke="currentColor" strokeWidth="2" /><circle cx="15" cy="16" r="5" stroke="currentColor" strokeWidth="2" /><circle cx="23" cy="11" r="1" fill="currentColor" /></svg>NXBooth</button>
      {marketing ? <nav className="landing-nav-links" aria-label={t('Jelajahi NXBooth', 'Explore NXBooth')}>
        <a href="#experiences">{t('Pengalaman', 'Experiences')}</a>
        <a href="#how-it-works">{t('Cara Kerja', 'How It Works')}</a>
        <a href="#modes">{t('Mode', 'Modes')}</a>
      </nav> : <nav className="customer-mode-nav" aria-label={t('Studio', 'Studios')}>
        <button aria-pressed={mode === 'CLASSIC'} className={mode === 'CLASSIC' ? 'is-active' : ''} onClick={() => onMode('CLASSIC')}>Photo Booth</button>
        <button aria-pressed={mode === 'BASIC'} className={mode === 'BASIC' ? 'is-active' : ''} onClick={() => onMode('BASIC')}>Scene Remix</button>
        <button aria-pressed={mode === 'ADVANCED'} className={mode === 'ADVANCED' ? 'is-active' : ''} onClick={() => onMode('ADVANCED')}>Creative Studio</button>
      </nav>}
      <div className="customer-account" ref={accountRoot}>
        {marketing && <a className="landing-nav-cta" href="/create">{t('Coba Gratis', 'Try for Free')} <span aria-hidden="true">↗</span></a>}
        <LanguageToggle />
        {!marketing && usage && <span className="customer-credit">{usage.subscription ? `AI ${usage.ai_remaining} · Classic ${usage.subscription.classic.remaining}` : `${usage.ai_remaining} ${t('kredit', usage.ai_remaining === 1 ? 'credit' : 'credits')}`}</span>}
        <button ref={accountTrigger} type="button" className="customer-account-trigger" aria-controls={panelId} aria-expanded={open} onClick={() => { if (!usage?.authenticated) setRegister(false); setOpen((value) => !value) }}>
          {usage?.authenticated && <AccountAvatar account={account} />}
          <span>{usage?.authenticated ? t('Akun', 'Account') : t('Masuk', 'Sign In')}</span>
          {usage?.authenticated && <b aria-hidden="true">⌄</b>}
        </button>
        {open && (
          <div id={panelId} className={`customer-account-popover ${usage?.authenticated ? 'is-account-menu' : ''}`}>
            {usage?.authenticated ? (
              <>
                <div className="customer-account-summary">
                  <AccountAvatar account={account} />
                  <span><strong>{account?.display_name || t('Akun Anda', 'Your account')}</strong><small>{account?.email}</small></span>
                </div>
                <nav className="customer-account-menu" aria-label={t('Akun', 'Account')}>
                  {ACCOUNT_MENU.map(([tab, id, en]) => <button key={tab} type="button" onClick={() => openAccount(tab)}>{t(id, en)}<b aria-hidden="true">→</b></button>)}
                </nav>
                <button type="button" className="customer-account-signout" disabled={busy} onClick={signOut}>{t('Keluar', 'Sign out')}</button>
              </>
            ) : (
              <form onSubmit={submit}>
                <p className="customer-kicker">{register ? t('Bergabung ke studio', 'Join the studio') : t('Selamat datang kembali', 'Welcome back')}</p>
                <h2>{register ? t('Buat akun Anda', 'Create your account') : t('Masuk', 'Sign in')}</h2>
                {register && <small>{usage?.subscription ? t('500 Classic Credit per bulan, maksimal 2 hasil per hari pada paket Free.', '500 Classic Credit per month, up to 2 results per day on the Free plan.') : t('50 kredit gratis, diperbarui setiap 14 hari.', '50 free credits, refreshed every 14 days.')}</small>}
                <label>Email<input type="email" autoComplete="email" value={email} required onChange={(event) => setEmail(event.target.value)} /></label>
                <label>Password<input type="password" autoComplete={register ? 'new-password' : 'current-password'} minLength="8" value={password} required onChange={(event) => setPassword(event.target.value)} /></label>
                {message && <p className="customer-form-error" role="alert">{message}</p>}
                <button className="customer-solid-button" disabled={busy} type="submit">{busy ? t('Sebentar…', 'One moment…') : register ? t('Buat akun', 'Create account') : t('Masuk', 'Sign in')}</button>
                <div className="customer-auth-divider" aria-hidden="true"><span>{t('atau', 'or')}</span></div>
                <GoogleSignInButton
                  text={register ? 'signup_with' : 'signin_with'}
                  disabled={busy}
                  onCredential={googleSignIn}
                />
                <button className="customer-inline-button" type="button" onClick={() => { setRegister((value) => !value); setMessage('') }}>{register ? t('Sudah punya akun?', 'Already have an account?') : t('Buat akun baru', 'Create an account')}</button>
              </form>
            )}
          </div>
        )}
      </div>
    </header>
  )
}
