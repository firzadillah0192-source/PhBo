import { useCallback, useEffect, useState } from 'react'
import { Link, NavLink, Navigate, Outlet, useNavigate, useLocation, useOutletContext } from 'react-router-dom'
import { Check, ChevronRight, Clock, Download, Loader2, LogOut, TriangleAlert, X } from 'lucide-react'
import { Button, Chip, cn, InlineAlert, TextField, Thumb } from '../../components/ui'
import { Avatar, BigButton, Page } from '../../components/customer'
import { useToast } from '../../components/overlays'
import { useCustomer } from '../../lib/customer'
import { customer as api, date, message, type Row } from '../../../../shared/api'
import { GoogleSignIn } from '../../../../shared/GoogleSignIn'
import { useResource } from '../../../../shared/useResource'
// @ts-ignore Shared payment UI uses the same backend contract as the legacy client.
import SandboxTopUp from '../../../../../frontend/src/components/customer/SandboxTopUp.jsx'
export { SharedPhoto } from './LiveResult'

function Auth({ signup = false }) {
  const c = useCustomer(); const navigate = useNavigate(); const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const done = useCallback(async () => { await c.refreshAccount(); navigate('/app/account/creations', { replace: true }) }, [navigate])
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (busy) return
    setBusy(true); setError('')
    try { await (signup ? api.signup : api.login)(email, password); await done() }
    catch (e) { setError(message(e)) } finally { setBusy(false) }
  }
  return <Page narrow className="pt-8"><form className="space-y-5" onSubmit={submit}>
    <div><h1 className="t-h2">{signup ? 'Create your account' : 'Welcome back'}</h1><p className="t-body-s mt-1 text-text-muted">{signup ? 'Get 50 free credits, reset to 50 every 14 days, and keep your creations.' : 'Sign in to keep your creations and credits.'}</p></div>
    <GoogleSignIn signIn={api.signInWithGoogle} onSuccess={done} />
    <p className="t-caption text-center text-text-muted">or</p>
    <TextField label="Email" type="email" required value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" />
    <TextField label="Password" type="password" required minLength={signup ? 8 : undefined} helper={signup ? 'At least 8 characters' : undefined} value={password} onChange={e => setPassword(e.target.value)} autoComplete={signup ? 'new-password' : 'current-password'} />
    {error && <InlineAlert tone="danger">{error}</InlineAlert>}
    <BigButton type="submit" disabled={busy || (signup && password.length < 8)}>{busy ? 'Please wait…' : signup ? 'Create account' : 'Sign in'}</BigButton>
    <p className="t-body-s text-center text-text-muted">{signup ? 'Already have an account? ' : 'New here? '}<Link className="font-semibold text-primary hover:underline" to={signup ? '/app/signin' : '/app/signup'}>{signup ? 'Sign in' : 'Create an account'}</Link></p>
    <p className="t-caption text-center text-text-muted">Your current photos will be saved to your account.</p>
  </form></Page>
}
export function SignIn() { return <Auth /> }
export function SignUp() { return <Auth signup /> }
const accountTabs = [['creations', 'Creations'], ['credits', 'Credits & plan'], ['profile', 'Profile'], ['security', 'Security'], ['privacy', 'Privacy']] as const
export function AccountLayout() {
  const c = useCustomer(); const navigate = useNavigate(); const location = useLocation(); const resource = useResource(() => api.getAccountCenter())
  const [error, setError] = useState('')
  useEffect(() => { if (location.pathname.endsWith('/credits')) resource.refresh() }, [location.pathname, resource.refresh])
  useEffect(() => { if (resource.data?.usage) c.setUsage(resource.data.usage) }, [resource.data?.usage, c.setUsage])
  useEffect(() => { const refresh = () => { if (document.visibilityState === 'visible') resource.refresh() }; window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh); return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) } }, [resource.refresh])
  if (c.loading) return <Page>Loading account…</Page>
  if (!c.signedIn) return <Navigate to="/app/signin" replace />
  if (resource.loading) return <Page>Loading account…</Page>
  if (resource.error) return <Page><InlineAlert tone="danger">{resource.error}</InlineAlert><BigButton onClick={resource.refresh}>Retry</BigButton></Page>
  const row = resource.data.account
  return <Page>
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-border bg-surface p-4">
      <div className="flex items-center gap-3"><Avatar initials={(row.display_name || row.email || '?').slice(0, 2).toUpperCase()} size={48} /><div><p className="t-label">{row.display_name || row.email}</p><p className="t-caption text-text-muted">{row.email}</p></div></div>
      <Button variant="secondary" icon={LogOut} onClick={async () => { try { await api.logout(); await c.refreshAccount(); navigate('/app') } catch (e) { setError(message(e)) } }}>Sign out</Button>
    </div>
    {error && <InlineAlert tone="danger">{error}</InlineAlert>}
    <nav aria-label="Account" className="-mx-4 mt-4 flex gap-6 overflow-x-auto border-b border-border px-4 md:mx-0 md:px-0">{accountTabs.map(([to, label]) => <NavLink key={to} to={'/app/account/' + to} className={({ isActive }) => cn('t-label-s -mb-px shrink-0 border-b-2 px-1 pb-3 pt-2', isActive ? 'border-primary text-primary' : 'border-transparent text-text-muted hover:text-text')}>{label}</NavLink>)}</nav>
    <div className="mt-5"><Outlet context={resource} /></div>
  </Page>
}
function useCenter() { return useOutletContext<any>() }
function creationStatus(r: Row) {
  if (r.expired) return { tone: 'neutral', icon: Clock, label: 'Expired' } as const
  if (r.status === 'COMPLETED') return { tone: 'success', icon: Check, label: 'Completed' } as const
  if (r.status === 'FAILED') return { tone: 'danger', icon: X, label: 'Failed' } as const
  if (r.status === 'QUEUED' || r.status === 'PROCESSING') return { tone: 'info', icon: Loader2, label: 'Processing' } as const
  return { tone: 'neutral', icon: Clock, label: String(r.status || '').toLowerCase().replace(/^./, ch => ch.toUpperCase()) } as const
}
export function Creations() {
  const { data } = useCenter()
  return <section aria-labelledby="mc" className="space-y-4">
    <div className="flex items-baseline justify-between"><h1 id="mc" className="t-h3">My Creations</h1><span className="t-caption text-text-muted">{data.creations.length} of last 100</span></div>
    {!data.creations.length && <p className="t-body text-text-muted">No creations yet.</p>}
    <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">{data.creations.map((r: Row) => { const st = creationStatus(r); const mode = String(r.mode || '').toLowerCase(); return <li key={r.job_id}>
      <Link to={r.result_id && r.status === 'COMPLETED' && !r.expired ? '/app/result/' + r.result_id : '/app/processing?job=' + r.job_id} className="flex items-center gap-3 rounded-md border border-border bg-surface p-3 hover:shadow-e2">
        <Thumb src={r.image_url || undefined} missing={!r.image_url} alt="" className="h-[72px] w-12 shrink-0" />
        <div className="min-w-0 flex-1 space-y-1.5"><p className="t-label-s truncate">{r.title}</p><div className="flex flex-wrap gap-1.5">{mode && <Chip tone={mode === 'classic' ? 'classic' : mode === 'basic' ? 'basic' : 'primary'}>{mode[0].toUpperCase() + mode.slice(1)}</Chip>}<Chip tone={st.tone} icon={st.icon}>{st.label}</Chip></div><p className="t-caption text-text-muted">{date(r.created_at)}{st.label === 'Completed' ? ' · Tap to view' : ''}</p></div>
        <ChevronRight size={18} className="shrink-0 text-text-muted" aria-hidden />
      </Link></li> })}</ul>
  </section>
}
export function CreditsPlan() {
  const { data } = useCenter()
  const u = data.usage
  return <section className="space-y-5">
    <div className="rounded-md border border-border bg-surface p-5"><h1 className="t-h4">Credits</h1><p className="mt-2 flex items-baseline gap-2"><span className="t-display">{u.ai_remaining}</span><span className="t-body text-text-muted">left</span></p>
      <dl className="mt-4 grid grid-cols-3 gap-3 text-center">{[['Used this period', u.used_this_period ?? u.ai_used], ['On hold', u.ai_reserved], ['Available', u.ai_remaining]].map(([label, value]) => <div key={label as string} className="rounded-sm bg-surface-2 p-3"><dt className="t-caption text-text-muted">{label}</dt><dd className="t-h3">{value}</dd></div>)}</dl>
      {u.credit_wallet && <p className="t-caption mt-3 text-text-muted">Free: {u.credit_wallet.free_remaining} · Top-up: {u.credit_wallet.top_up_remaining} · Resets to {u.credit_wallet.free_allocation} every {u.credit_wallet.reset_every_days} days · Next reset: {date(u.credit_wallet.next_reset_at)}</p>}</div>
    <p className="t-body-s text-text-muted">Free credits are used first. Classic costs 1 credit per successful result. AI requires at least 10 credits to start; the final cost is calculated after success. Failed jobs do not spend credits.</p>
    <div className="space-y-3"><h2 className="t-h4">Plans</h2>{(data.plans.some((r: Row) => r.id === data.current_plan.id) ? data.plans : [data.current_plan, ...data.plans]).map((r: Row) => { const current = r.id === data.current_plan.id; return <div key={r.id} className={cn('flex items-center justify-between gap-3 rounded-md border bg-surface p-4', current ? 'border-2 border-primary' : 'border-border')}><div><p className="t-label-s">{r.name}</p><p className="t-caption text-text-muted">{r.code === 'free' && u.credit_wallet ? `${u.credit_wallet.free_allocation} free credits, reset every ${u.credit_wallet.reset_every_days} days.` : r.description}</p></div>{current ? <Chip tone="primary" icon={Check}>Current</Chip> : <Chip>Coming soon</Chip>}</div> })}<InlineAlert tone="info">{data.billing.message}</InlineAlert></div>
    <SandboxTopUp />
  </section>
}
export function Profile() {
  const { data, refresh } = useCenter(); const c = useCustomer(); const toast = useToast(); const [name, setName] = useState(data.account.display_name || ''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  return <form className="max-w-lg space-y-5" onSubmit={async e => { e.preventDefault(); setBusy(true); setError(''); try { await api.updateAccountProfile({ display_name: name }); await c.refreshAccount(); refresh(); toast({ tone: 'success', title: 'Profile saved' }) } catch (e) { setError(message(e)) } finally { setBusy(false) } }}>
    <h1 className="t-h3">Profile</h1>
    <TextField label="Display name" value={name} maxLength={120} onChange={e => setName(e.target.value)} helper="Shown on your account only." />
    <TextField label="Email" value={data.account.email} readOnly disabled helper="Email can't be changed here." />
    {error && <InlineAlert tone="danger">{error}</InlineAlert>}
    <BigButton type="submit" disabled={busy}>Save changes</BigButton>
  </form>
}
export function Security() {
  const { data, refresh } = useCenter(); const c = useCustomer(); const navigate = useNavigate(); const toast = useToast(); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  async function revoke(id?: string) { setBusy(true); setError(''); try { if (id) { await api.revokeAccountSession(id); refresh(); toast({ tone: 'success', title: 'Session revoked' }) } else if (window.confirm('Sign out on every device?')) { await api.revokeAllAccountSessions(); await c.refreshAccount(); navigate('/app/signin') } } catch (e) { setError(message(e)) } finally { setBusy(false) } }
  return <section className="max-w-2xl space-y-5"><h1 className="t-h3">Signed-in sessions</h1>
    <ul className="space-y-3">{data.sessions.map((r: Row) => <li key={r.id} className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface p-4"><div><p className="t-label-s flex items-center gap-2">Session started {date(r.created_at)}{r.is_current && <Chip tone="primary">This device</Chip>}</p><p className="t-caption text-text-muted">Last seen {date(r.last_seen_at)} · Expires {date(r.expires_at)}</p></div>{!r.is_current && <Button variant="secondary" disabled={busy} onClick={() => revoke(r.id)}>Revoke</Button>}</li>)}</ul>
    {error && <InlineAlert tone="danger">{error}</InlineAlert>}
    <div className="rounded-md border border-border bg-surface p-4"><Button variant="destructive" icon={LogOut} disabled={busy} onClick={() => revoke()}>Sign out everywhere</Button><p className="t-caption mt-2 text-text-muted">This signs you out on this device too.</p></div>
  </section>
}
export function Privacy() {
  const { data } = useCenter(); const p = data.privacy
  const list = [
    { title: 'Delete a creation', body: 'Remove any photo from My Creations.', chip: p.creation_deletion_available ? <Chip tone="success" icon={Check}>Available</Chip> : <Chip icon={TriangleAlert}>Not yet available</Chip> },
    { title: 'Export my data', body: 'Download a copy of your account data.', chip: p.export_available ? <Chip tone="success" icon={Check}>Available</Chip> : <Chip icon={Download}>Not yet available</Chip> },
    { title: 'Delete my account', body: 'Permanently remove your account.', chip: p.deletion_available ? <Chip tone="success" icon={Check}>Available</Chip> : <Chip icon={TriangleAlert}>Not yet available</Chip> },
  ]
  return <section className="max-w-2xl space-y-4"><h1 className="t-h3">Privacy</h1><p className="t-body-s text-text-muted">{p.retention_message}</p>
    {list.map(r => <div key={r.title} className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface p-4"><div><p className="t-label-s">{r.title}</p><p className="t-caption text-text-muted">{r.body}</p></div>{r.chip}</div>)}
  </section>
}
