import React, { useCallback, useEffect, useState } from 'react'
import {
  getAccountCenter,
  deleteResultPhoto,
  revokeAccountSession,
  revokeAllAccountSessions,
  updateAccountProfile,
} from '../../api.js'

import CreditTopUp, { WalletSummary } from './CreditTopUp.jsx'
import { MODE_NAMES } from '../../creditCatalog.js'
import StudioModal from './StudioModal.jsx'

const TABS = [
  ['overview', 'Overview'],
  ['plan', 'Tambah Bekal'],
  ['billing', 'Billing'],
  ['creations', 'My Creations'],
  ['personalization', 'Personalization'],
  ['security', 'Account & Security'],
  ['privacy', 'Data & Privacy'],
]

function date(value, fallback = 'Not set') {
  if (!value) return fallback
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return fallback
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(parsed)
}

function shortDate(value) {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(parsed)
}

function initials(account) {
  const source = account?.display_name || account?.email || 'Account'
  return source.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'A'
}

function Avatar({ account, large = false }) {
  return account?.avatar_url
    ? <img className={`account-avatar ${large ? 'is-large' : ''}`} src={account.avatar_url} alt="" />
    : <span className={`account-avatar account-avatar-initials ${large ? 'is-large' : ''}`} aria-hidden="true">{initials(account)}</span>
}

function LoadingState() {
  return <section className="account-center-shell account-loading-shell" aria-busy="true"><div className="account-skeleton account-skeleton-wide" /><div className="account-skeleton-grid"><div className="account-skeleton" /><div className="account-skeleton" /><div className="account-skeleton" /></div><div className="account-skeleton account-skeleton-tall" /></section>
}

function ErrorState({ onRetry }) {
  return <section className="account-center-message"><p className="customer-kicker">Account center</p><h1>We couldn't load your account right now.</h1><p>Please try again in a moment.</p><button className="customer-solid-button" onClick={onRetry}>Try again</button></section>
}

function AuthRequired({ onHome }) {
  return <section className="account-center-message"><p className="customer-kicker">Account center</p><h1>Sign in to see your studio.</h1><p>Your credits, creations, and settings live here once you are signed in.</p><button className="customer-solid-button" onClick={onHome}>Back to studio</button></section>
}

function CreditBar({ usage }) {
  const total = Math.max(0, Number(usage?.ai_total || 0))
  const remaining = Math.max(0, Number(usage?.ai_remaining || 0))
  const percentage = total ? Math.min(100, Math.max(0, (remaining / total) * 100)) : 0
  return <div className="account-credit-bar" aria-label={`${remaining} of ${total} AI credits remaining`}><span style={{ width: `${percentage}%` }} /></div>
}

function CreditSummary({ data }) { return <WalletSummary usage={data.usage} /> }

function ProfileCard({ data, onSaved }) {
  const [name, setName] = useState(data.account.display_name || '')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => setName(data.account.display_name || ''), [data.account.display_name])
  const save = async (event) => {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      const account = await updateAccountProfile({ display_name: name })
      onSaved(account)
      setMessage('Profile saved.')
    } catch {
      setMessage('We could not save your profile right now.')
    } finally {
      setBusy(false)
    }
  }
  return <form className="account-panel account-profile-panel" onSubmit={save}>
    <div className="account-panel-heading"><div><p className="account-eyebrow">Profile</p><h2>Your studio identity</h2></div><Avatar account={data.account} large /></div>
    <div className="account-profile-fields">
      <label>Display name<input value={name} maxLength="255" placeholder="Your name" onChange={(event) => setName(event.target.value)} /></label>
      <label>Email<input value={data.account.email || ''} readOnly /><small>Email is controlled by your sign-in identity.</small></label>
    </div>
    <div className="account-form-footer"><span>{message}</span><button className="customer-solid-button" disabled={busy} type="submit">{busy ? 'Saving…' : 'Save profile'}</button></div>
  </form>
}

export function CreationCard({ item, onDeleted }) {
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const remove = async () => {
    if (deleting) return
    setDeleting(true)
    setDeleteError('')
    try { await deleteResultPhoto(item.result_id); onDeleted(item.result_id) } catch (caught) { setDeleteError(caught.message || 'Could not delete this photo.'); setDeleting(false) }
  }
  const status = String(item.status || '').toLowerCase()
  return <article className="account-creation-card">
    <div className="account-creation-media">
      {item.image_url ? <img src={item.image_url} alt={`${item.title} creation`} loading="lazy" /> : <div className="account-creation-placeholder"><span>{item.expired ? 'Expired' : status === 'pending_usage' ? 'Menunggu rincian pemakaian' : status === 'needs_top_up' ? 'Perlu tambahan kredit' : status === 'failed' ? 'Not completed' : 'In progress'}</span></div>}
    </div>
    <div className="account-creation-copy"><strong>{item.title}</strong><span>{shortDate(item.created_at)} · {MODE_NAMES[item.mode] || item.mode}{item.credits_spent != null ? ` · ${item.credits_spent} kredit` : ''}</span><small className={`account-status account-status-${status}`}>{item.expired ? 'Expired' : status}</small>{item.expires_at && <small className="account-photo-expiry">Disimpan sampai {date(item.expires_at)}</small>}</div>
    <div className="account-creation-actions">{item.image_url && <a href={`/result/${encodeURIComponent(item.id)}`}>View</a>}{item.download_url && <a href={item.download_url}>Download</a>}{item.result_id && onDeleted && <button type="button" className="account-danger-button account-delete-photo" disabled={deleting} onClick={() => { setDeleteError(''); setConfirmDelete(true) }}>{deleting ? 'Deleting…' : 'Delete photo'}</button>}</div>
    {confirmDelete && <StudioModal title="Hapus foto" onClose={() => { if (!deleting) setConfirmDelete(false) }}><div className="photo-delete-confirm"><p className="customer-kicker">My Creations</p><h2>Hapus foto ini?</h2><p>Foto “{item.title}” akan dihapus permanen. Download dan tautan berbagi tidak dapat digunakan lagi. Kredit yang sudah dipakai tidak dikembalikan.</p>{deleteError && <p role="alert" className="account-inline-notice">{deleteError}</p>}<div className="photo-delete-actions"><button type="button" className="customer-solid-button" disabled={deleting} onClick={() => setConfirmDelete(false)}>Simpan foto</button><button type="button" className="account-danger-button" disabled={deleting} onClick={remove}>{deleting ? 'Menghapus…' : 'Ya, hapus foto'}</button></div></div></StudioModal>}
  </article>
}

function RecentCreations({ data, onViewAll, onDeleted }) {
  const recent = data.creations.slice(0, 4)
  return <section className="account-panel account-recent-panel"><div className="account-panel-heading"><div><p className="account-eyebrow">Your studio</p><h2>Recent creations</h2></div>{data.creations.length > 4 && <button className="account-text-button" onClick={onViewAll}>View all creations <b>→</b></button>}</div>{recent.length ? <div className="account-creation-grid">{recent.map((item) => <CreationCard key={`${item.job_id}-${item.id}`} item={item} onDeleted={onDeleted} />)}</div> : <div className="account-empty"><strong>Your next portrait starts here.</strong><span>Creations you make while signed in will appear here.</span></div>}</section>
}

function Overview({ data, onTabChange, onSaved, onDeleted }) {
  const account = data.account
  return <>
    <header className="account-page-heading"><p className="customer-kicker">Account center</p><h1>Welcome back, {account.display_name || account.email?.split('@')[0] || 'creator'}.</h1><p>A calm place for your credits, creations, and studio preferences.</p></header>
    <section className="account-hero-card"><div className="account-hero-identity"><Avatar account={account} large /><div><p className="account-eyebrow">Bekal kreatif</p><h2>{account.display_name || 'Your account'}</h2><p>{account.email}</p></div></div><div className="account-hero-actions"><span className="account-plan-badge">Kredit</span><button className="customer-solid-button" onClick={() => onTabChange('plan')}>Tambah Bekal</button></div></section>
    <CreditSummary data={data} />
    <ProfileCard data={data} onSaved={onSaved} />
    <RecentCreations data={data} onViewAll={() => onTabChange('creations')} onDeleted={onDeleted} />
  </>
}

function PlanTab({ data }) { return <CreditTopUp data={data} /> }

function BillingTab({ data, onTabChange }) {
  return <><header className="account-page-heading"><p className="customer-kicker">Billing</p><h1>Simple, when it is ready.</h1><p>Payment details stay out of the studio until the billing system is fully connected.</p></header><section className="account-panel account-info-panel"><div className="account-info-icon">○</div><div><p className="account-eyebrow">Billing is not live yet</p><h2>{data.billing.message}</h2><p>There are no payment methods, invoices, charges, or cancellation actions to show right now.</p><button className="account-back-link" onClick={() => onTabChange('plan')}>Kembali ke bekal <b>→</b></button></div></section><div className="account-placeholder-grid"><article><small>Payment method</small><strong>Not configured</strong><span>Nothing is stored here yet.</span></article><article><small>Invoices</small><strong>Not available</strong><span>Billing history will appear after launch.</span></article><article><small>Isi kredit</small><strong>Not available</strong><span>Belum ada pembayaran yang diproses.</span></article></div></>
}

function CreationsTab({ data, onDeleted }) {
  return <><header className="account-page-heading"><p className="customer-kicker">My creations</p><h1>Your visual archive.</h1><p>Foto web disimpan selama 14 hari sejak dibuat. Download sebelum kedaluwarsa, atau hapus kapan saja.</p></header><section className="account-panel account-archive-panel">{data.creations.length ? <div className="account-creation-grid account-creation-grid-large">{data.creations.map((item) => <CreationCard key={`${item.job_id}-${item.id}`} item={item} onDeleted={onDeleted} />)}</div> : <div className="account-empty"><strong>No creations yet.</strong><span>Make a portrait while signed in and it will land here.</span></div>}</section></>
}

const DEFAULT_PREFERENCES = { outputFormat: 'feed', downloadFormat: 'png', defaultStudio: 'advanced', motion: 'full' }
function readPreferences() {
  try { return { ...DEFAULT_PREFERENCES, ...JSON.parse(window.localStorage.getItem('photobooth_preferences') || '{}') } } catch { return DEFAULT_PREFERENCES }
}

function PersonalizationTab() {
  const [preferences, setPreferences] = useState(readPreferences)
  const update = (key, value) => {
    const next = { ...preferences, [key]: value }
    setPreferences(next)
    window.localStorage.setItem('photobooth_preferences', JSON.stringify(next))
  }
  return <><header className="account-page-heading"><p className="customer-kicker">Personalization</p><h1>Set the studio to your pace.</h1><p>These light preferences stay on this device and do not change your account balance.</p></header><section className="account-panel account-settings-panel"><PreferenceSelect label="Default output format" value={preferences.outputFormat} onChange={(value) => update('outputFormat', value)} options={ [['feed', 'Feed · 4:5'], ['story', 'Story · 9:16'], ['square', 'Square'] ] } /><PreferenceSelect label="Preferred download format" value={preferences.downloadFormat} onChange={(value) => update('downloadFormat', value)} options={ [['png', 'PNG'], ['jpeg', 'JPEG'] ] } /><PreferenceSelect label="Default studio" value={preferences.defaultStudio} onChange={(value) => update('defaultStudio', value)} options={ [['classic', 'Photo Booth'], ['basic', 'Scene Remix'], ['advanced', 'Creative Studio'] ] } /><PreferenceSelect label="Motion preference" value={preferences.motion} onChange={(value) => update('motion', value)} options={ [['full', 'Full'], ['reduced', 'Reduced'] ] } /></section></>
}

function PreferenceSelect({ label, value, onChange, options }) {
  return <label className="account-preference"><span><strong>{label}</strong><small>Saved on this device</small></span><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
}

function SecurityTab({ data, onReload, onUsageChanged, onHome }) {
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const revoke = async (id) => {
    setBusy(id)
    setMessage('')
    try {
      const result = await revokeAccountSession(id)
      if (result.current) { await onUsageChanged(); onHome(); return }
      await onReload()
    } catch { setMessage('That session could not be revoked. It may already be closed.') } finally { setBusy('') }
  }
  const revokeAll = async () => {
    if (!window.confirm('Sign out this account on every device?')) return
    setBusy('all')
    try { await revokeAllAccountSessions(); await onUsageChanged(); onHome() } catch { setMessage('We could not sign out all devices right now.') } finally { setBusy('') }
  }
  return <><header className="account-page-heading"><p className="customer-kicker">Account & security</p><h1>Keep your account close.</h1><p>Photobooth uses server-owned sessions. Tokens never appear in this view.</p></header><section className="account-panel account-security-summary"><div><p className="account-eyebrow">Connected account</p><h2>{data.account.provider === 'google' ? 'Google' : 'Email and password'}</h2><p>{data.account.email}</p></div><div><p className="account-eyebrow">Created</p><strong>{date(data.account.created_at)}</strong></div></section>{message && <p className="account-inline-notice">{message}</p>}<section className="account-panel account-sessions-panel"><div className="account-panel-heading"><div><p className="account-eyebrow">Sessions</p><h2>Your signed-in devices</h2></div><button className="account-outline-button" disabled={busy === 'all'} onClick={revokeAll}>Sign out all devices</button></div>{data.sessions.length ? <div className="account-session-list">{data.sessions.map((session) => <div className="account-session-row" key={session.id}><span><strong>{session.is_current ? 'This device' : 'Signed-in device'}</strong><small>Last active {date(session.last_seen_at)} · Expires {date(session.expires_at)}</small></span><button className="account-text-button" disabled={busy === session.id} onClick={() => revoke(session.id)}>{busy === session.id ? 'Revoking…' : 'Revoke'}</button></div>)}</div> : <div className="account-empty"><strong>No active sessions found.</strong><span>Sign in again to create a new one.</span></div>}</section></>
}

function PrivacyTab({ data, onTabChange }) {
  return <><header className="account-page-heading"><p className="customer-kicker">Data & privacy</p><h1>Your photographs stay yours.</h1><p>Clear information matters when the studio works with personal images.</p></header><section className="account-panel account-info-panel"><div className="account-info-icon">⌁</div><div><p className="account-eyebrow">Current policy state</p><h2>{data.privacy.retention_message}</h2><p>Delete individual generated photos from My Creations. Account deletion and data export are not available.</p></div></section><div className="account-privacy-actions"><button className="account-outline-button" disabled={!data.privacy.export_available}>Export account data</button><button className="account-danger-button" disabled={!data.privacy.deletion_available}>Delete account</button><button className="account-outline-button" disabled={!data.privacy.creation_deletion_available} onClick={() => onTabChange('creations')}>Manage creations</button></div></>
}

export default function AccountCenter({ usage, tab = 'overview', onTabChange, onHome, onUsageChanged }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const load = useCallback(async () => {
    setLoading(true)
    setError(false)
    try { setData(await getAccountCenter()) } catch (caught) { setError(caught?.errorCode !== 'AUTHENTICATION_REQUIRED') } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  if (loading) return <LoadingState />
  if (error) return <ErrorState onRetry={load} />
  if (!data || !usage?.authenticated) return <AuthRequired onHome={onHome} />

  const activeTab = TABS.some(([key]) => key === tab) ? tab : 'overview'
  const updateAccount = (account) => setData((current) => ({ ...current, account, usage: { ...current.usage, email: account.email, display_name: account.display_name, avatar_url: account.avatar_url } }))
  const removeCreation = (resultId) => setData(current => ({ ...current, creations: current.creations.filter(item => item.result_id !== resultId) }))
  const content = {
    overview: <Overview data={data} onTabChange={onTabChange} onSaved={updateAccount} onDeleted={removeCreation} />,
    plan: <PlanTab data={data} onTabChange={onTabChange} />,
    billing: <BillingTab data={data} onTabChange={onTabChange} />,
    creations: <CreationsTab data={data} onDeleted={removeCreation} />,
    personalization: <PersonalizationTab />,
    security: <SecurityTab data={data} onReload={load} onUsageChanged={onUsageChanged} onHome={onHome} />,
    privacy: <PrivacyTab data={data} onTabChange={onTabChange} />,
  }[activeTab]

  return <section className="account-center-shell">
    <div className="account-center-top"><div className="account-center-profile"><Avatar account={data.account} /><span><strong>{data.account.display_name || 'Your account'}</strong><small>{data.account.email}</small></span></div><span className="account-plan-badge">Bekal kreatif</span></div>
    <div className="account-center-layout">
      <nav className="account-section-nav" aria-label="Account center sections">{TABS.map(([key, label]) => <button key={key} className={activeTab === key ? 'is-active' : ''} onClick={() => onTabChange(key)}>{label}</button>)}</nav>
      <div className="account-center-content">{content}</div>
    </div>
  </section>
}
