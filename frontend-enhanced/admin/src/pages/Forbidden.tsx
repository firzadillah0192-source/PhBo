import { Link } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { homeFor, type Role, useRole } from '../lib/role'

/** Shown for `403 ADMIN_FORBIDDEN` — role checks are exact, so this is reachable by URL. */
export function Forbidden({ required }: { required: Role[] }) {
  const { role } = useRole()
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 py-20 text-center">
      <span className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-warning-soft text-warning">
        <Lock size={32} aria-hidden />
      </span>
      <div>
        <h1 className="t-h2">Your role can't open this page</h1>
        <p className="t-body-s mx-auto mt-2 max-w-md text-text-muted">
          You're signed in as <code className="t-mono text-text">{role}</code>. This page needs{' '}
          {required.map((r, i) => (
            <span key={r}>
              {i > 0 && ' or '}
              <code className="t-mono text-text">{r}</code>
            </span>
          ))}
          . Ask a superadmin if you need access.
        </p>
      </div>
      <Link to={homeFor(role)} className="t-label-s inline-flex h-10 items-center rounded-sm bg-primary px-3.5 text-white hover:bg-primary-hover">
        Go to my home page
      </Link>
    </div>
  )
}
