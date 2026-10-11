import { useState } from 'react'
import { Link, NavLink, Outlet, useNavigate, useParams } from 'react-router-dom'
import { Check, ChevronRight, Clock, Download, Loader2, LogOut, TriangleAlert, X } from 'lucide-react'
import { Button, Chip, cn, InlineAlert, TextField, Thumb } from '../../components/ui'
import { Avatar, BigButton, Page, StatusBlock } from '../../components/customer'
import { useToast } from '../../components/overlays'
import { creations, type Creation, plans, sessions, user } from '../../data/customer'
import { useCustomer } from '../../lib/customer'

/* ───────────── 10a Sign in / 10b Sign up ───────────── */

function GoogleButton() {
  return (
    <BigButton variant="secondary">
      <span aria-hidden className="font-bold text-info">G</span>
      Continue with Google
    </BigButton>
  )
}

export function SignIn() {
  const navigate = useNavigate()
  const { setSignedIn } = useCustomer()
  const [email, setEmail] = useState('ayu.rahma@example.com')
  const [password, setPassword] = useState('')
  return (
    <Page narrow className="pt-8">
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault()
          setSignedIn(true)
          navigate('/app/account/creations')
        }}
      >
        <div>
          <h1 className="t-h2">Welcome back</h1>
          <p className="t-body-s mt-1 text-text-muted">Sign in to keep your creations and credits.</p>
        </div>
        <GoogleButton />
        <p className="t-caption text-center text-text-muted">or</p>
        <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        <TextField label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        <BigButton type="submit">Sign in</BigButton>
        <p className="t-body-s text-center text-text-muted">
          New here?{' '}
          <Link to="/app/signup" className="font-semibold text-primary hover:underline">Create an account</Link>
        </p>
        <p className="t-caption text-center text-text-muted">Your current photos will be saved to your account.</p>
      </form>
    </Page>
  )
}

export function SignUp() {
  const navigate = useNavigate()
  const { setSignedIn, setCredits } = useCustomer()
  const [email, setEmail] = useState('ayu.rahma@example.com')
  const [password, setPassword] = useState('')
  const [taken, setTaken] = useState(true)
  return (
    <Page narrow className="pt-8">
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault()
          if (email === 'ayu.rahma@example.com') return setTaken(true)
          setSignedIn(true)
          setCredits(5)
          navigate('/app/account/creations')
        }}
      >
        <div>
          <h1 className="t-h2">Create your account</h1>
          <p className="t-body-s mt-1 text-text-muted">Get 5 AI credits and keep your creations.</p>
        </div>
        <GoogleButton />
        <p className="t-caption text-center text-text-muted">or</p>
        <TextField
          label="Email"
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            setTaken(false)
          }}
          error={taken && email === 'ayu.rahma@example.com' ? 'An account with this email already exists' : undefined}
        />
        <TextField label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} helper="At least 8 characters" autoComplete="new-password" />
        <BigButton type="submit" disabled={password.length < 8}>Create account</BigButton>
        <p className="t-body-s text-center text-text-muted">
          Already have an account?{' '}
          <Link to="/app/signin" className="font-semibold text-primary hover:underline">Sign in</Link>
        </p>
        <p className="t-caption text-center text-text-muted">Your current photos will be saved to your account.</p>
      </form>
    </Page>
  )
}

/* ───────────── 11 Account center ───────────── */

const accountTabs = [
  ['creations', 'Creations'],
  ['credits', 'Credits'],
  ['profile', 'Profile'],
  ['security', 'Security'],
  ['privacy', 'Privacy'],
] as const

export function AccountLayout() {
  const { setSignedIn } = useCustomer()
  const navigate = useNavigate()
  return (
    <Page>
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-border bg-surface p-4">
        <div className="flex items-center gap-3">
          <Avatar initials={user.initials} size={48} />
          <div>
            <p className="t-label">{user.name}</p>
            <p className="t-caption text-text-muted">{user.email} · Signed in with {user.provider}</p>
          </div>
        </div>
        <Button variant="secondary" icon={LogOut} onClick={() => { setSignedIn(false); navigate('/app') }}>Sign out</Button>
      </div>
      <nav aria-label="Account" className="-mx-4 mt-4 flex gap-6 overflow-x-auto border-b border-border px-4 md:mx-0 md:px-0">
        {accountTabs.map(([to, label]) => (
          <NavLink key={to} to={`/app/account/${to}`} className={({ isActive }) => cn('t-label-s -mb-px shrink-0 border-b-2 px-1 pb-3 pt-2', isActive ? 'border-primary text-primary' : 'border-transparent text-text-muted hover:text-text')}>
            {to === 'credits' ? 'Credits & plan' : label}
          </NavLink>
        ))}
      </nav>
      <div className="mt-5">
        <Outlet />
      </div>
    </Page>
  )
}

const statusChip = (c: Creation) => {
  const map = {
    completed: { tone: 'success', icon: Check, label: 'Completed' },
    processing: { tone: 'info', icon: Loader2, label: 'Processing' },
    failed: { tone: 'danger', icon: X, label: 'Failed' },
    expired: { tone: 'neutral', icon: Clock, label: 'Expired' },
  } as const
  const m = map[c.status]
  return (
    <Chip tone={m.tone} icon={m.icon}>
      {m.label}
    </Chip>
  )
}

export function Creations() {
  return (
    <section aria-labelledby="mc" className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 id="mc" className="t-h3">My Creations</h1>
        <span className="t-caption text-text-muted">{creations.length} of last 100</span>
      </div>
      <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {creations.map((c) => (
          <li key={c.id}>
            <Link to={c.status === 'processing' ? '/app/processing?state=processing&hold' : c.status === 'failed' ? '/app/processing?state=failed' : `/app/result/${c.mode === 'classic' ? 'classic' : 'ai'}`} className="flex items-center gap-3 rounded-md border border-border bg-surface p-3 hover:shadow-e2">
              <Thumb seed={c.seed} alt="" missing={c.status === 'expired'} className="h-[72px] w-12 shrink-0" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="t-label-s truncate">{c.name}</p>
                <div className="flex flex-wrap gap-1.5">
                  <Chip tone={c.mode === 'classic' ? 'classic' : c.mode === 'basic' ? 'basic' : 'primary'}>{c.mode[0].toUpperCase() + c.mode.slice(1)}</Chip>
                  {statusChip(c)}
                </div>
                <p className="t-caption text-text-muted">{c.note ? `${c.when} · ${c.note}` : c.status === 'failed' ? `${c.when} · Credit returned` : `${c.when}${c.status === 'completed' ? ' · Tap to view' : ''}`}</p>
              </div>
              <ChevronRight size={18} className="shrink-0 text-text-muted" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function CreditsPlan() {
  const { credits } = useCustomer()
  const used = 1
  const hold = 1
  return (
    <section className="space-y-5">
      <div className="rounded-md border border-border bg-surface p-5">
        <h1 className="t-h4">AI credits</h1>
        <p className="mt-2 flex items-baseline gap-2"><span className="t-display">{Math.max(credits, 3)}</span><span className="t-body text-text-muted">of 5 left</span></p>
        <dl className="mt-4 grid grid-cols-3 gap-3 text-center">
          {[['Used', used], ['On hold (job in progress)', hold], ['Remaining', Math.max(credits, 3)]].map(([k, v]) => (
            <div key={k as string} className="rounded-sm bg-surface-2 p-3">
              <dt className="t-caption text-text-muted">{k}</dt>
              <dd className="t-h3">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="t-caption mt-3 text-text-muted">Used this period: {used}</p>
      </div>
      <div className="space-y-3">
        <h2 className="t-h4">Plans</h2>
        {plans.map((p) => (
          <div key={p.name} className={cn('flex items-center justify-between gap-3 rounded-md border bg-surface p-4', p.current ? 'border-2 border-primary' : 'border-border')}>
            <div>
              <p className="t-label-s">{p.name}</p>
              <p className="t-caption text-text-muted">{p.body}</p>
            </div>
            {p.current ? <Chip tone="primary" icon={Check}>Current</Chip> : <Chip>Coming soon</Chip>}
          </div>
        ))}
        <InlineAlert tone="info">Paid plans aren't available yet. No payment method or invoices are needed.</InlineAlert>
      </div>
    </section>
  )
}

export function Profile() {
  const toast = useToast()
  const [name, setName] = useState(user.name)
  return (
    <form
      className="max-w-lg space-y-5"
      onSubmit={(e) => {
        e.preventDefault()
        toast({ tone: 'success', title: 'Profile saved' })
      }}
    >
      <h1 className="t-h3">Profile</h1>
      <TextField label="Display name" value={name} onChange={(e) => setName(e.target.value)} helper="Shown on your account only." />
      <TextField label="Email" value={user.email} readOnly disabled helper="Signed in with Google. Email can't be changed here." />
      <BigButton type="submit">Save changes</BigButton>
    </form>
  )
}

export function Security() {
  const toast = useToast()
  const [list, setList] = useState(sessions)
  return (
    <section className="max-w-2xl space-y-5">
      <h1 className="t-h3">Signed-in sessions</h1>
      <ul className="space-y-3">
        {list.map((s) => (
          <li key={s.started} className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface p-4">
            <div>
              <p className="t-label-s flex items-center gap-2">
                Session started {s.started}
                {s.current && <Chip tone="primary">This device</Chip>}
              </p>
              <p className="t-caption text-text-muted">{s.seen} · {s.expires}</p>
            </div>
            {!s.current && (
              <Button variant="secondary" onClick={() => { setList((l) => l.filter((x) => x !== s)); toast({ tone: 'success', title: 'Session revoked' }) }}>
                Revoke
              </Button>
            )}
          </li>
        ))}
      </ul>
      <div className="rounded-md border border-border bg-surface p-4">
        <Button variant="destructive" icon={LogOut}>Sign out everywhere</Button>
        <p className="t-caption mt-2 text-text-muted">This signs you out on this device too.</p>
      </div>
    </section>
  )
}

export function Privacy() {
  const rows = [
    { title: 'Delete a creation', body: 'Remove any photo from My Creations.', chip: <Chip tone="success" icon={Check}>Available</Chip> },
    { title: 'Export my data', body: 'Download a copy of your account data.', chip: <Chip icon={Download}>Not yet available</Chip> },
    { title: 'Delete my account', body: 'Permanently remove your account.', chip: <Chip icon={TriangleAlert}>Not yet available</Chip> },
  ]
  return (
    <section className="max-w-2xl space-y-4">
      <h1 className="t-h3">Privacy</h1>
      <p className="t-body-s text-text-muted">Uploads are removed after 24 hours. Automatic retention for finished creations isn't configured yet, so delete any you don't want to keep.</p>
      {rows.map((r) => (
        <div key={r.title} className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface p-4">
          <div>
            <p className="t-label-s">{r.title}</p>
            <p className="t-caption text-text-muted">{r.body}</p>
          </div>
          {r.chip}
        </div>
      ))}
    </section>
  )
}

/* ───────────── /r/:token — shared photo ───────────── */

export function SharedPhoto() {
  const { token = '' } = useParams()
  const available = token !== 'expired'
  return (
    <div className="min-h-screen bg-bg">
      <header className="flex h-14 items-center justify-center border-b border-border bg-surface">
        <span className="t-h4">NXBooth</span>
      </header>
      <main className="mx-auto flex max-w-sm flex-col items-center gap-4 px-4 py-8">
        {available ? (
          <>
            <p className="t-caption flex items-center gap-1.5 text-text-muted"><Clock size={14} aria-hidden />Link expires Oct 11, 18:00</p>
            <Thumb seed={0} alt="Shared photo" className="aspect-[2/3] w-full shadow-e2" />
            <BigButton icon={Download}>Download</BigButton>
            <p className="t-caption text-text-muted">Made with NXBooth</p>
          </>
        ) : (
          <StatusBlock icon={TriangleAlert} tone="warning" title="This photo is no longer available" body="The link may have expired or the photo was removed.">
            <p className="t-caption text-text-muted">Made with NXBooth</p>
          </StatusBlock>
        )}
      </main>
    </div>
  )
}
