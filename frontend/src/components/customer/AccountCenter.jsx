import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  getAccountCenter,
  revokeAccountSession,
  revokeAllAccountSessions,
  updateAccountProfile,
} from '../../api.js'

const TABS = [
  ['overview', 'Overview'],
  ['plan', 'Plan & Credits'],
  ['billing', 'Billing'],
  ['creations', 'My Creations'],
  ['personalization', 'Personalization'],
  ['security', 'Account & Security'],
  ['privacy', 'Data & Privacy'],
]

const PLAN_ORDER = ['lite', 'go', 'plus', 'pro', 'business']
const PLAN_COPY = {
  lite: { name: 'Lite', position: 'Casual personal use' },
  go: { name: 'Go', position: 'Regular use' },
  plus: { name: 'Plus', position: 'Creator / frequent use' },
  pro: { name: 'Pro', position: 'Heavy creator / professional use' },
  business: { name: 'Business', position: 'Team / studio / event use' },
}

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

function CreditSummary({ data }) {
  const usage = data.usage
  const plan = data.current_plan
  const allocation = plan.monthly_ai_credits
  return <div className="account-credit-summary">
    <div className="account-credit-stat"><small>AI credits</small><strong>{usage.ai_remaining}<em>{usage.ai_total ? ` / ${usage.ai_total}` : ''}</em></strong><CreditBar usage={usage} /><span>{allocation ? `${allocation} monthly allocation` : 'Current account allocation'}</span></div>
    <div className="account-credit-stat"><small>Used this period</small><strong>{usage.used_this_period}</strong><span>Completed Advanced creations</span></div>
    <div className="account-credit-stat"><small>Next renewal</small><strong>{shortDate(plan.current_period_end)}</strong><span>{plan.current_period_end ? (plan.cancel_at_period_end ? 'Scheduled to end' : 'Current plan period') : 'No subscription renewal'}</span></div>
  </div>
}

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

function CreationCard({ item }) {
  const status = String(item.status || '').toLowerCase()
  return <article className="account-creation-card">
    <div className="account-creation-media">
      {item.image_url ? <img src={item.image_url} alt={`${item.title} creation`} loading="lazy" /> : <div className="account-creation-placeholder"><span>{item.expired ? 'Expired' : status === 'failed' ? 'Not completed' : 'In progress'}</span></div>}
    </div>
    <div className="account-creation-copy"><strong>{item.title}</strong><span>{shortDate(item.created_at)} · {item.mode === 'ADVANCED' ? 'Advanced' : 'Basic'}</span><small className={`account-status account-status-${status}`}>{item.expired ? 'Expired' : status}</small></div>
    <div className="account-creation-actions">{item.image_url && <a href={`/result/${encodeURIComponent(item.id)}`}>View</a>}{item.download_url && <a href={item.download_url}>Download</a>}</div>
  </article>
}

function RecentCreations({ data, onViewAll }) {
  const recent = data.creations.slice(0, 4)
  return <section className="account-panel account-recent-panel"><div className="account-panel-heading"><div><p className="account-eyebrow">Your studio</p><h2>Recent creations</h2></div>{data.creations.length > 4 && <button className="account-text-button" onClick={onViewAll}>View all creations <b>→</b></button>}</div>{recent.length ? <div className="account-creation-grid">{recent.map((item) => <CreationCard key={`${item.job_id}-${item.id}`} item={item} />)}</div> : <div className="account-empty"><strong>Your next portrait starts here.</strong><span>Creations you make while signed in will appear here.</span></div>}</section>
}

function Overview({ data, onTabChange, onSaved }) {
  const account = data.account
  return <>
    <header className="account-page-heading"><p className="customer-kicker">Account center</p><h1>Welcome back, {account.display_name || account.email?.split('@')[0] || 'creator'}.</h1><p>A calm place for your credits, creations, and studio preferences.</p></header>
    <section className="account-hero-card"><div className="account-hero-identity"><Avatar account={account} large /><div><p className="account-eyebrow">{data.current_plan.name} plan</p><h2>{account.display_name || 'Your account'}</h2><p>{account.email}</p></div></div><div className="account-hero-actions"><span className="account-plan-badge">{data.current_plan.name}</span><button className="customer-solid-button" onClick={() => onTabChange('plan')}>{data.current_plan.code === 'free' ? 'Explore plans' : 'View plan'}</button></div></section>
    <CreditSummary data={data} />
    <ProfileCard data={data} onSaved={onSaved} />
    <RecentCreations data={data} onViewAll={() => onTabChange('creations')} />
  </>
}

function planList(data) {
  const configured = new Map((data.plans || []).map((plan) => [String(plan.code).toLowerCase(), plan]))
  return PLAN_ORDER.map((code) => ({
    id: configured.get(code)?.id || code,
    code,
    name: configured.get(code)?.name || PLAN_COPY[code].name,
    description: configured.get(code)?.description || PLAN_COPY[code].position,
    position: PLAN_COPY[code].position,
    monthly_ai_credits: configured.get(code)?.monthly_ai_credits ?? null,
    configured: Boolean(configured.get(code)),
  }))
}

function PlanCard({ item, current, onAction }) {
  const isBusiness = item.code === 'business'
  return <article className={`account-plan-card ${current ? 'is-current' : ''} ${isBusiness ? 'is-business' : ''}`}>
    <div className="account-plan-card-top"><p className="account-eyebrow">{isBusiness ? 'For teams' : 'Individual'}</p>{current && <span className="account-current-badge">Current plan</span>}</div>
    <h3>{item.name}</h3><p>{item.position}</p>
    <div className="account-plan-allowance">{item.monthly_ai_credits ? <><strong>{item.monthly_ai_credits}</strong><span>AI credits / {item.billing_period || 'month'}</span></> : <><strong>—</strong><span>{item.configured ? 'Allowance not configured' : 'Available when configured'}</span></>}</div>
    <button className={current ? 'account-muted-button' : 'account-outline-button'} disabled={current} onClick={() => onAction(item)}>{current ? 'Current plan' : isBusiness ? 'Request access' : 'Upgrade plan'}</button>
  </article>
}

function PlanTab({ data, onTabChange }) {
  const [notice, setNotice] = useState('')
  const currentCode = String(data.current_plan.code || 'free').toLowerCase()
  const items = useMemo(() => planList(data), [data])
  const action = (item) => setNotice(item.code === 'business' ? 'Business access will be available through a separate studio conversation.' : 'Plan upgrades are coming soon. Your current plan remains unchanged.')
  return <>
    <header className="account-page-heading"><p className="customer-kicker">Plan & credits</p><h1>Keep your creative rhythm.</h1><p>See the balance assigned by your account and the plan registry available to this studio.</p></header>
    <section className="account-panel account-current-plan"><div><p className="account-eyebrow">Current plan</p><h2>{data.current_plan.name}</h2><p>{data.current_plan.description || 'Your current Photobooth AI access.'}</p></div><div className="account-current-plan-meta"><strong>{data.usage.ai_remaining}</strong><span>AI credits remaining</span><small>{data.current_plan.current_period_end ? `Renews ${date(data.current_plan.current_period_end)}` : 'No renewal date is configured'}</small></div></section>
    <section className="account-panel account-credit-panel"><div className="account-panel-heading"><div><p className="account-eyebrow">Usage</p><h2>Your current allocation</h2></div><span className="account-credit-number">{data.usage.ai_remaining} / {data.usage.ai_total || '—'}</span></div><CreditBar usage={data.usage} /><div className="account-credit-details"><span><strong>{data.usage.used_this_period}</strong> used this period</span><span><strong>{data.usage.ai_reserved}</strong> processing now</span><span><strong>{data.current_plan.monthly_ai_credits || '—'}</strong> monthly allocation</span></div></section>
    <section className="account-plan-section"><div className="account-panel-heading"><div><p className="account-eyebrow">The plan library</p><h2>Choose your pace</h2></div><span className="account-muted-label">No prices until billing launches</span></div>{notice && <p className="account-inline-notice">{notice}</p>}<div className="account-plan-grid">{items.map((item) => <PlanCard key={item.code} item={item} current={currentCode === item.code} onAction={action} />)}</div></section>
    <button className="account-back-link" onClick={() => onTabChange('billing')}>See billing readiness <b>→</b></button>
  </>
}

function BillingTab({ data, onTabChange }) {
  return <><header className="account-page-heading"><p className="customer-kicker">Billing</p><h1>Simple, when it is ready.</h1><p>Payment details stay out of the studio until the billing system is fully connected.</p></header><section className="account-panel account-info-panel"><div className="account-info-icon">○</div><div><p className="account-eyebrow">Billing is not live yet</p><h2>{data.billing.message}</h2><p>There are no payment methods, invoices, charges, or cancellation actions to show right now.</p><button className="account-back-link" onClick={() => onTabChange('plan')}>Back to plans <b>→</b></button></div></section><div className="account-placeholder-grid"><article><small>Payment method</small><strong>Not configured</strong><span>Nothing is stored here yet.</span></article><article><small>Invoices</small><strong>Not available</strong><span>Billing history will appear after launch.</span></article><article><small>Subscription changes</small><strong>Not available</strong><span>Your current plan is unchanged.</span></article></div></>
}

function CreationsTab({ data }) {
  return <><header className="account-page-heading"><p className="customer-kicker">My creations</p><h1>Your visual archive.</h1><p>Only creations owned by this account appear here. Availability follows the current retention state.</p></header><section className="account-panel account-archive-panel">{data.creations.length ? <div className="account-creation-grid account-creation-grid-large">{data.creations.map((item) => <CreationCard key={`${item.job_id}-${item.id}`} item={item} />)}</div> : <div className="account-empty"><strong>No creations yet.</strong><span>Make a portrait while signed in and it will land here.</span></div>}</section></>
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
  return <><header className="account-page-heading"><p className="customer-kicker">Personalization</p><h1>Set the studio to your pace.</h1><p>These light preferences stay on this device and do not change your account balance.</p></header><section className="account-panel account-settings-panel"><PreferenceSelect label="Default output format" value={preferences.outputFormat} onChange={(value) => update('outputFormat', value)} options={ [['feed', 'Feed · 4:5'], ['story', 'Story · 9:16'], ['square', 'Square'] ] } /><PreferenceSelect label="Preferred download format" value={preferences.downloadFormat} onChange={(value) => update('downloadFormat', value)} options={ [['png', 'PNG'], ['jpeg', 'JPEG'] ] } /><PreferenceSelect label="Default studio" value={preferences.defaultStudio} onChange={(value) => update('defaultStudio', value)} options={ [['advanced', 'Advanced'], ['basic', 'Basic'] ] } /><PreferenceSelect label="Motion preference" value={preferences.motion} onChange={(value) => update('motion', value)} options={ [['full', 'Full'], ['reduced', 'Reduced'] ] } /></section></>
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

function PrivacyTab({ data }) {
  return <><header className="account-page-heading"><p className="customer-kicker">Data & privacy</p><h1>Your photographs stay yours.</h1><p>Clear information matters when the studio works with personal images.</p></header><section className="account-panel account-info-panel"><div className="account-info-icon">⌁</div><div><p className="account-eyebrow">Current policy state</p><h2>{data.privacy.retention_message}</h2><p>Deletion and export controls remain unavailable until their server-side behavior is defined end to end.</p></div></section><div className="account-privacy-actions"><button className="account-outline-button" disabled={!data.privacy.export_available}>Export account data</button><button className="account-danger-button" disabled={!data.privacy.deletion_available}>Delete account</button><button className="account-outline-button" disabled>Delete creations</button></div></>
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
  const content = {
    overview: <Overview data={data} onTabChange={onTabChange} onSaved={updateAccount} />,
    plan: <PlanTab data={data} onTabChange={onTabChange} />,
    billing: <BillingTab data={data} onTabChange={onTabChange} />,
    creations: <CreationsTab data={data} />,
    personalization: <PersonalizationTab />,
    security: <SecurityTab data={data} onReload={load} onUsageChanged={onUsageChanged} onHome={onHome} />,
    privacy: <PrivacyTab data={data} />,
  }[activeTab]

  return <section className="account-center-shell">
    <div className="account-center-top"><div className="account-center-profile"><Avatar account={data.account} /><span><strong>{data.account.display_name || 'Your account'}</strong><small>{data.account.email}</small></span></div><span className="account-plan-badge">{data.current_plan.name} plan</span></div>
    <div className="account-center-layout">
      <nav className="account-section-nav" aria-label="Account center sections">{TABS.map(([key, label]) => <button key={key} className={activeTab === key ? 'is-active' : ''} onClick={() => onTabChange(key)}>{label}</button>)}</nav>
      <div className="account-center-content">{content}</div>
    </div>
  </section>
}
