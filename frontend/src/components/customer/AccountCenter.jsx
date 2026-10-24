import { ApiKeyManager } from './DeveloperApi.jsx'
import PhotoFolders from './PhotoFolders.jsx'
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
import PaymentHistory from './PaymentHistory.jsx'
import { LanguageSelect } from './LanguageSwitch.jsx'
import SandboxNotice from './SandboxNotice.jsx'
import { useLocale, useT } from '../../i18n.js'

const TABS = [
  ['overview', 'Ringkasan', 'Overview'],
  ['plan', 'Paket & Kredit', 'Plans & Credits'],
  ['billing', 'Tagihan', 'Billing'],
  ['creations', 'Kreasi Saya', 'My Creations'],
  ['personalization', 'Personalisasi', 'Personalization'],
  ['security', 'Akun & Keamanan', 'Account & Security'],
  ['privacy', 'Data & Privasi', 'Data & Privacy'],
  ['developer', 'API & Integrasi', 'API & Integrations'],
]

function useDates() {
  const locale = useLocale()
  const t = useT()
  return {
    date: (value, fallback = t('Belum diatur', 'Not set')) => {
      if (!value) return fallback
      const parsed = new Date(value)
      if (Number.isNaN(parsed.getTime())) return fallback
      return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric' }).format(parsed)
    },
    shortDate: (value) => {
      if (!value) return '—'
      const parsed = new Date(value)
      if (Number.isNaN(parsed.getTime())) return '—'
      return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(parsed)
    },
  }
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
  const t = useT()
  return <section className="account-center-message"><p className="customer-kicker">{t('Pusat akun', 'Account center')}</p><h1>{t('Akun Anda belum bisa dimuat sekarang.', 'We couldn’t load your account right now.')}</h1><p>{t('Silakan coba lagi sebentar lagi.', 'Please try again in a moment.')}</p><button className="customer-solid-button" onClick={onRetry}>{t('Coba lagi', 'Try again')}</button></section>
}

function AuthRequired({ onHome }) {
  const t = useT()
  return <section className="account-center-message"><p className="customer-kicker">{t('Pusat akun', 'Account center')}</p><h1>{t('Masuk untuk melihat studio Anda.', 'Sign in to see your studio.')}</h1><p>{t('Kredit, kreasi, dan pengaturan Anda ada di sini setelah masuk.', 'Your credits, creations, and settings live here once you are signed in.')}</p><button className="customer-solid-button" onClick={onHome}>{t('Kembali ke studio', 'Back to studio')}</button></section>
}

function CreditSummary({ data }) { return <WalletSummary usage={data.usage} /> }

function ProfileCard({ data, onSaved }) {
  const t = useT()
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
      setMessage(t('Profil tersimpan.', 'Profile saved.'))
    } catch {
      setMessage(t('Profil belum bisa disimpan sekarang.', 'We could not save your profile right now.'))
    } finally {
      setBusy(false)
    }
  }
  return <form className="account-panel account-profile-panel" onSubmit={save}>
    <div className="account-panel-heading"><div><p className="account-eyebrow">{t('Profil', 'Profile')}</p><h2>{t('Identitas studio Anda', 'Your studio identity')}</h2></div><Avatar account={data.account} large /></div>
    <div className="account-profile-fields">
      <label><span>{t('Nama tampilan', 'Display name')}</span><input value={name} maxLength="255" placeholder={t('Nama Anda', 'Your name')} onChange={(event) => setName(event.target.value)} /></label>
      <label><span>Email</span><input value={data.account.email || ''} readOnly /><small>{t('Email diatur oleh identitas masuk Anda.', 'Email is controlled by your sign-in identity.')}</small></label>
      <LanguageSelect />
    </div>
    <div className="account-form-footer"><span role="status">{message}</span><button className="customer-solid-button" disabled={busy} type="submit">{busy ? t('Menyimpan…', 'Saving…') : t('Simpan profil', 'Save profile')}</button></div>
  </form>
}

export function CreationCard({ item, onDeleted }) {
  const t = useT()
  const { date, shortDate } = useDates()
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const remove = async () => {
    if (deleting) return
    setDeleting(true)
    setDeleteError('')
    try { await deleteResultPhoto(item.result_id); onDeleted(item.result_id) } catch (caught) { setDeleteError(caught.message || t('Foto ini belum bisa dihapus.', 'Could not delete this photo.')); setDeleting(false) }
  }
  const status = String(item.status || '').toLowerCase()
  const statusLabel = item.expired ? t('Kedaluwarsa', 'Expired') : { completed: t('Selesai', 'Completed'), failed: t('Gagal', 'Failed'), queued: t('Antre', 'Queued'), processing: t('Diproses', 'Processing'), pending_usage: t('Menunggu rincian', 'Awaiting details'), needs_top_up: t('Perlu kredit', 'Needs credits') }[status] || status
  return <article className="account-creation-card">
    <div className="account-creation-media">
      {item.image_url ? <img src={item.image_url} alt={t(`Kreasi ${item.title}`, `${item.title} creation`)} loading="lazy" /> : <div className="account-creation-placeholder"><span>{item.expired ? t('Kedaluwarsa', 'Expired') : status === 'pending_usage' ? t('Menunggu rincian pemakaian', 'Waiting for usage details') : status === 'needs_top_up' ? t('Perlu tambahan kredit', 'More credits needed') : status === 'failed' ? t('Tidak selesai', 'Not completed') : t('Sedang diproses', 'In progress')}</span></div>}
    </div>
    <div className="account-creation-copy"><strong>{item.title}</strong><span>{shortDate(item.created_at)} · {MODE_NAMES[item.mode] || item.mode}{item.credits_spent != null ? ` · ${item.credits_spent} ${t('kredit', 'credits')}` : ''}</span><small className={`account-status account-status-${status}`}>{statusLabel}</small>{item.expires_at && <small className="account-photo-expiry">{t('Disimpan sampai', 'Kept until')} {date(item.expires_at)}</small>}</div>
    <div className="account-creation-actions">{item.image_url && <a className="account-outline-button" href={`/result/${encodeURIComponent(item.id)}`}>{t('Lihat', 'View')}</a>}{item.download_url && <a className="account-outline-button" href={item.download_url}>{t('Unduh', 'Download')}</a>}{item.result_id && onDeleted && <button type="button" className="account-danger-button account-delete-photo" disabled={deleting} onClick={() => { setDeleteError(''); setConfirmDelete(true) }}>{deleting ? t('Menghapus…', 'Deleting…') : t('Hapus foto', 'Delete photo')}</button>}</div>
    {confirmDelete && <StudioModal title={t('Hapus foto', 'Delete photo')} onClose={() => { if (!deleting) setConfirmDelete(false) }}><div className="photo-delete-confirm"><p className="customer-kicker">{t('Kreasi Saya', 'My Creations')}</p><h2>{t('Hapus foto ini?', 'Delete this photo?')}</h2><p>{t(`Foto “${item.title}” akan dihapus permanen. Unduhan dan tautan berbagi tidak dapat digunakan lagi. Kredit yang sudah dipakai tidak dikembalikan.`, `The photo “${item.title}” will be permanently deleted. Downloads and share links will stop working. Credits already used are not refunded.`)}</p>{deleteError && <p role="alert" className="account-inline-notice">{deleteError}</p>}<div className="photo-delete-actions"><button type="button" className="customer-solid-button" disabled={deleting} onClick={() => setConfirmDelete(false)}>{t('Simpan foto', 'Keep photo')}</button><button type="button" className="account-danger-button" disabled={deleting} onClick={remove}>{deleting ? t('Menghapus…', 'Deleting…') : t('Ya, hapus foto', 'Yes, delete photo')}</button></div></div></StudioModal>}
  </article>
}

function RecentCreations({ data, onViewAll, onDeleted }) {
  const t = useT()
  const recent = data.creations.slice(0, 4)
  return <section className="account-panel account-recent-panel"><div className="account-panel-heading"><div><p className="account-eyebrow">{t('Studio Anda', 'Your studio')}</p><h2>{t('Kreasi terbaru', 'Recent creations')}</h2></div>{data.creations.length > 4 && <button className="account-text-button" onClick={onViewAll}>{t('Lihat semua kreasi', 'View all creations')} <b>→</b></button>}</div>{recent.length ? <div className="account-creation-grid">{recent.map((item) => <CreationCard key={`${item.job_id}-${item.id}`} item={item} onDeleted={onDeleted} />)}</div> : <div className="account-empty"><strong>{t('Potret berikutnya dimulai di sini.', 'Your next portrait starts here.')}</strong><span>{t('Kreasi yang Anda buat saat masuk akan muncul di sini.', 'Creations you make while signed in will appear here.')}</span><a className="customer-solid-button account-empty-cta" href="/create">{t('Buat potret pertama', 'Create your first portrait')}</a></div>}</section>
}

function Overview({ data, onTabChange, onSaved, onDeleted }) {
  const t = useT()
  const account = data.account
  return <>
    <header className="account-page-heading"><p className="customer-kicker">{t('Pusat akun', 'Account center')}</p><h1>{t('Selamat datang kembali,', 'Welcome back,')} {account.display_name || account.email?.split('@')[0] || t('kreator', 'creator')}.</h1><p>{t('Tempat tenang untuk kredit, kreasi, dan preferensi studio Anda.', 'A calm place for your credits, creations, and studio preferences.')}</p></header>
    <div className="account-overview-grid">
      <ProfileCard data={data} onSaved={onSaved} />
      <div className="account-overview-side">
        <CreditSummary data={data} />
        <button className="customer-solid-button" onClick={() => onTabChange('plan')}>{t('Tambah kredit', 'Add credits')}</button>
      </div>
    </div>
    <RecentCreations data={data} onViewAll={() => onTabChange('creations')} onDeleted={onDeleted} />
  </>
}

function PlanTab({ data, onTabChange }) { return <CreditTopUp data={data} onTabChange={onTabChange} /> }

function BillingTab({ data, onTabChange }) {
  const t = useT()
  return <>
    <header className="account-page-heading"><p className="customer-kicker">{t('Tagihan', 'Billing')}</p><h1>{t('Riwayat pembayaran.', 'Payment history.')}</h1><p>{t('Lihat pesanan isi kredit dan status pembayarannya di akun ini.', 'See your credit orders and their payment status on this account.')}</p></header>
    <section className="account-panel account-info-panel"><div><p className="account-eyebrow">{data.billing.enabled ? t('Pembayaran Sandbox', 'Sandbox payments') : t('Pembayaran belum tersedia', 'Payments not available yet')}</p>{data.billing.enabled ? <SandboxNotice /> : <h2>{data.billing.message}</h2>}<button className="account-back-link" type="button" onClick={() => onTabChange('plan')}>{t('Tambah kredit', 'Add credits')} <b aria-hidden="true">→</b></button></div></section>
    {data.billing.enabled && <PaymentHistory />}
  </>
}

function CreationsTab({ data, onDeleted }) {
  const t = useT()
  if(data.usage.photo_folders_enabled) return <><header className="account-page-heading"><p className="customer-kicker">{t('Kreasi Saya', 'My Creations')}</p><h1>{t('Folder foto Anda.', 'Your photo folders.')}</h1><p>{data.privacy.retention_message}</p></header><PhotoFolders onDeleted={onDeleted} renderCard={(item,remove)=><CreationCard item={item} onDeleted={remove}/>} /></>
  return <><header className="account-page-heading"><p className="customer-kicker">{t('Kreasi Saya', 'My creations')}</p><h1>{t('Arsip visual Anda.', 'Your visual archive.')}</h1><p>{data.privacy?.retention_message || t('Unduh sebelum tanggal kedaluwarsa, atau hapus hasil kapan saja.', 'Download before the expiry date, or delete results any time.')}</p></header><section className="account-panel account-archive-panel">{data.creations.length ? <div className="account-creation-grid account-creation-grid-large">{data.creations.map((item) => <CreationCard key={`${item.job_id}-${item.id}`} item={item} onDeleted={onDeleted} />)}</div> : <div className="account-empty"><strong>{t('Belum ada kreasi.', 'No creations yet.')}</strong><span>{t('Buat potret saat masuk dan hasilnya akan tersimpan di sini.', 'Make a portrait while signed in and it will land here.')}</span><a className="customer-solid-button account-empty-cta" href="/create">{t('Buat potret pertama', 'Create your first portrait')}</a></div>}</section></>
}

const DEFAULT_PREFERENCES = { outputFormat: 'feed', downloadFormat: 'png', defaultStudio: 'advanced', motion: 'full' }
function readPreferences() {
  try { return { ...DEFAULT_PREFERENCES, ...JSON.parse(window.localStorage.getItem('photobooth_preferences') || '{}') } } catch { return DEFAULT_PREFERENCES }
}

function PersonalizationTab() {
  const t = useT()
  const [preferences, setPreferences] = useState(readPreferences)
  const update = (key, value) => {
    const next = { ...preferences, [key]: value }
    setPreferences(next)
    window.localStorage.setItem('photobooth_preferences', JSON.stringify(next))
  }
  return <><header className="account-page-heading"><p className="customer-kicker">{t('Personalisasi', 'Personalization')}</p><h1>{t('Atur studio sesuai ritme Anda.', 'Set the studio to your pace.')}</h1><p>{t('Preferensi ringan ini tersimpan di perangkat dan tidak mengubah saldo akun Anda.', 'These light preferences stay on this device and do not change your account balance.')}</p></header><section className="account-panel account-settings-panel"><div className="account-preference"><LanguageSelect /></div><PreferenceSelect label={t('Format keluaran bawaan', 'Default output format')} value={preferences.outputFormat} onChange={(value) => update('outputFormat', value)} options={ [['feed', 'Feed · 4:5'], ['story', 'Story · 9:16'], ['square', t('Persegi', 'Square')] ] } /><PreferenceSelect label={t('Format unduhan pilihan', 'Preferred download format')} value={preferences.downloadFormat} onChange={(value) => update('downloadFormat', value)} options={ [['png', 'PNG'], ['jpeg', 'JPEG'] ] } /><PreferenceSelect label={t('Studio bawaan', 'Default studio')} value={preferences.defaultStudio} onChange={(value) => update('defaultStudio', value)} options={ [['classic', 'Photo Booth'], ['basic', 'Scene Remix'], ['advanced', 'Creative Studio'] ] } /><PreferenceSelect label={t('Preferensi gerak', 'Motion preference')} value={preferences.motion} onChange={(value) => update('motion', value)} options={ [['full', t('Penuh', 'Full')], ['reduced', t('Dikurangi', 'Reduced')] ] } /></section></>
}

function PreferenceSelect({ label, value, onChange, options }) {
  const t = useT()
  return <label className="account-preference"><span><strong>{label}</strong><small>{t('Disimpan di perangkat ini', 'Saved on this device')}</small></span><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
}

function SecurityTab({ data, onReload, onUsageChanged, onHome }) {
  const t = useT()
  const { date } = useDates()
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const revoke = async (id) => {
    setBusy(id)
    setMessage('')
    try {
      const result = await revokeAccountSession(id)
      if (result.current) { await onUsageChanged(); onHome(); return }
      await onReload()
    } catch { setMessage(t('Sesi itu tidak bisa dicabut. Mungkin sudah ditutup.', 'That session could not be revoked. It may already be closed.')) } finally { setBusy('') }
  }
  const revokeAll = async () => {
    if (!window.confirm(t('Keluarkan akun ini dari semua perangkat?', 'Sign out this account on every device?'))) return
    setBusy('all')
    try { await revokeAllAccountSessions(); await onUsageChanged(); onHome() } catch { setMessage(t('Belum bisa keluar dari semua perangkat sekarang.', 'We could not sign out all devices right now.')) } finally { setBusy('') }
  }
  return <><header className="account-page-heading"><p className="customer-kicker">{t('Akun & keamanan', 'Account & security')}</p><h1>{t('Jaga akun Anda tetap aman.', 'Keep your account close.')}</h1><p>{t('NXBooth memakai sesi yang dikelola server. Token tidak pernah tampil di halaman ini.', 'NXBooth uses server-owned sessions. Tokens never appear in this view.')}</p></header><section className="account-panel account-security-summary"><div><p className="account-eyebrow">{t('Akun terhubung', 'Connected account')}</p><h2>{data.account.provider === 'google' ? 'Google' : t('Email dan password', 'Email and password')}</h2><p>{data.account.email}</p></div><div><p className="account-eyebrow">{t('Dibuat', 'Created')}</p><strong>{date(data.account.created_at)}</strong></div></section>{message && <p className="account-inline-notice">{message}</p>}<section className="account-panel account-sessions-panel"><div className="account-panel-heading"><div><p className="account-eyebrow">{t('Sesi', 'Sessions')}</p><h2>{t('Perangkat yang sedang masuk', 'Your signed-in devices')}</h2></div><button className="account-outline-button" disabled={busy === 'all'} onClick={revokeAll}>{t('Keluar dari semua perangkat', 'Sign out all devices')}</button></div>{data.sessions.length ? <div className="account-session-list">{data.sessions.map((session) => <div className="account-session-row" key={session.id}><span><strong>{session.is_current ? t('Perangkat ini', 'This device') : t('Perangkat yang masuk', 'Signed-in device')}</strong><small>{t('Aktif terakhir', 'Last active')} {date(session.last_seen_at)} · {t('Berakhir', 'Expires')} {date(session.expires_at)}</small></span><button className="account-text-button" disabled={busy === session.id} onClick={() => revoke(session.id)}>{busy === session.id ? t('Mencabut…', 'Revoking…') : t('Cabut', 'Revoke')}</button></div>)}</div> : <div className="account-empty"><strong>{t('Tidak ada sesi aktif.', 'No active sessions found.')}</strong><span>{t('Masuk lagi untuk membuat sesi baru.', 'Sign in again to create a new one.')}</span></div>}</section></>
}

function PrivacyTab({ data, onTabChange }) {
  const t = useT()
  return <><header className="account-page-heading"><p className="customer-kicker">{t('Data & privasi', 'Data & privacy')}</p><h1>{t('Foto Anda tetap milik Anda.', 'Your photographs stay yours.')}</h1><p>{t('Informasi yang jelas penting saat studio memproses gambar pribadi.', 'Clear information matters when the studio works with personal images.')}</p></header><section className="account-panel account-info-panel"><div><p className="account-eyebrow">{t('Status kebijakan saat ini', 'Current policy state')}</p><h2>{data.privacy.retention_message}</h2><p>{t('Hapus foto hasil satu per satu dari Kreasi Saya. Penghapusan akun dan ekspor data belum tersedia.', 'Delete individual generated photos from My Creations. Account deletion and data export are not available.')}</p></div></section><div className="account-privacy-actions"><button className="account-outline-button" disabled={!data.privacy.export_available}>{t('Ekspor data akun', 'Export account data')}</button><button className="account-danger-button" disabled={!data.privacy.deletion_available}>{t('Hapus akun', 'Delete account')}</button><button className="account-outline-button" disabled={!data.privacy.creation_deletion_available} onClick={() => onTabChange('creations')}>{t('Kelola kreasi', 'Manage creations')}</button></div></>
}

export default function AccountCenter({ usage, tab = 'overview', onTabChange, onHome, onUsageChanged }) {
  const t = useT()
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
  const planName = data.usage?.subscription?.plan?.name
  const content = {
    overview: <Overview data={data} onTabChange={onTabChange} onSaved={updateAccount} onDeleted={removeCreation} />,
    plan: <PlanTab data={data} onTabChange={onTabChange} />,
    billing: <BillingTab data={data} onTabChange={onTabChange} />,
    creations: <CreationsTab data={data} onDeleted={removeCreation} />,
    personalization: <PersonalizationTab />,
    security: <SecurityTab data={data} onReload={load} onUsageChanged={onUsageChanged} onHome={onHome} />,
    developer: <ApiKeyManager />,
    privacy: <PrivacyTab data={data} onTabChange={onTabChange} />,
  }[activeTab]

  return <section className="account-center-shell">
    <div className="account-center-layout">
      <aside className="account-center-side">
        <div className="account-center-profile"><Avatar account={data.account} large /><span><strong>{data.account.display_name || t('Akun Anda', 'Your account')}</strong><small>{data.account.email}</small>{planName && <em className="account-plan-badge">{t('Paket', 'Plan')} {planName}</em>}</span></div>
        <nav className="account-section-nav" aria-label={t('Bagian pusat akun', 'Account center sections')}>{TABS.map(([key, id, en]) => <button key={key} className={activeTab === key ? 'is-active' : ''} aria-current={activeTab === key ? 'page' : undefined} onClick={() => onTabChange(key)}>{t(id, en)}</button>)}</nav>
      </aside>
      <div className="account-center-content">{content}</div>
    </div>
  </section>
}
