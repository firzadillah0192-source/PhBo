import { Fragment, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { ChevronRight, LogOut, Sun } from 'lucide-react'
import { can, homeFor, NAV, type Role, useRole } from '../lib/role'
import { Button, Chip, cn, InlineSelect } from './ui'
import { Forbidden } from '../pages/Forbidden'

export function Logo() {
  return (
    <span className="flex items-center gap-2">
      <span className="flex h-7 w-7 items-center justify-center rounded-sm bg-primary text-white">
        <Sun size={16} aria-hidden />
      </span>
      <span className="t-h4">NXBooth</span>
    </span>
  )
}

function Sidebar() {
  const { role } = useRole()
  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col gap-5 overflow-y-auto border-r border-border bg-surface px-4 py-5">
      <Link to={homeFor(role)} className="flex items-center gap-2 px-1">
        <Logo />
        <Chip>Admin</Chip>
      </Link>
      <nav aria-label="Admin" className="flex flex-col gap-5">
        {NAV.map(({ group, items }) => {
          const visible = items.filter((i) => can(role, i.roles))
          if (!visible.length) return null
          return (
            <div key={group} className="flex flex-col gap-0.5">
              <p className="t-label-xs px-3 pb-1.5 uppercase tracking-wide text-text-muted">{group}</p>
              {visible.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    cn('t-label-s flex h-10 items-center gap-3 rounded-sm px-3', isActive ? 'bg-primary-soft text-primary' : 'text-text hover:bg-surface-2')
                  }
                >
                  {({ isActive }) => (
                    <>
                      <item.icon size={18} className={isActive ? 'text-primary' : 'text-text-muted'} aria-hidden />
                      {item.label}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          )
        })}
      </nav>
    </aside>
  )
}

export type Crumb = { label: string; to?: string }

function TopBar({ crumbs }: { crumbs: Crumb[] }) {
  const { role, setRole } = useRole()
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b border-border bg-surface px-8">
      <nav aria-label="Breadcrumb">
        <ol className="flex items-center gap-2">
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1
            return (
              <Fragment key={c.label}>
                <li className={last ? 't-label-s' : 't-body-s text-text-muted'} aria-current={last ? 'page' : undefined}>
                  {c.to && !last ? (
                    <Link to={c.to} className="hover:text-text hover:underline">
                      {c.label}
                    </Link>
                  ) : (
                    c.label
                  )}
                </li>
                {!last && <ChevronRight size={14} className="text-text-muted" aria-hidden />}
              </Fragment>
            )
          })}
        </ol>
      </nav>
      <div className="flex items-center gap-3">
        {/* Preview-only control: the real role is fixed by the admin session. */}
        <InlineSelect
          aria-label="Preview as role"
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          className="h-8 font-medium text-primary"
          options={[
            { value: 'superadmin', label: 'superadmin' },
            { value: 'operator', label: 'operator' },
            { value: 'content_manager', label: 'content_manager' },
          ]}
        />
        <Button variant="tertiary" icon={LogOut}>
          Sign out
        </Button>
      </div>
    </header>
  )
}

/** Page frame: role-filtered sidebar, breadcrumbs, and an exact-match role guard. */
export function AdminPage({ crumbs, roles, children }: { crumbs: Crumb[]; roles: Role[]; children: ReactNode }) {
  const { role } = useRole()
  const { pathname } = useLocation()
  return (
    <div className="flex min-h-screen min-w-[1180px]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar crumbs={crumbs} />
        <main key={pathname} className="flex flex-1 flex-col gap-6 p-8">
          {can(role, roles) ? children : <Forbidden required={roles} />}
        </main>
      </div>
    </div>
  )
}
