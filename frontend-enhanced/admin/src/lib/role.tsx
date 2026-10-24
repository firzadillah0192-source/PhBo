import { createContext, type ReactNode, useContext, useState, useEffect } from 'react'
import { customer as api } from '../../../shared/api'
import {
  BarChart3,
  CreditCard,
  FileText,
  Film,
  Home,
  Image,
  KeyRound,
  type LucideIcon,
  RefreshCw,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  SquareUser,
  User,
  Users,
  Zap,
} from 'lucide-react'

export type Role = 'superadmin' | 'operator' | 'content_manager'

/**
 * Role checks on the API are exact-match, except that superadmin passes every check.
 * `superadmin` in `roles` therefore means "superadmin only".
 */
export const can = (role: Role, roles: Role[]) => role === 'superadmin' || roles.includes(role)

export type NavItem = { label: string; to: string; icon: LucideIcon; roles: Role[] }

export const NAV: Array<{ group: string; items: NavItem[] }> = [
  {
    group: 'Operations',
    items: [
      { label: 'Overview', to: '/overview', icon: Home, roles: ['operator'] },
      { label: 'Generations', to: '/generations', icon: Image, roles: ['operator'] },
      { label: 'Users', to: '/users', icon: Users, roles: ['operator'] },
      { label: 'Credits ledger', to: '/credits', icon: Zap, roles: ['operator'] },
      { label: 'Usage', to: '/usage', icon: BarChart3, roles: ['operator'] },
      { label: 'Providers', to: '/providers', icon: Server, roles: ['operator'] },
    ],
  },
  {
    group: 'Catalog',
    items: [
      { label: 'Experiences', to: '/experiences', icon: Sparkles, roles: ['content_manager'] },
      { label: 'Templates', to: '/templates', icon: SquareUser, roles: ['content_manager'] },
      { label: 'Classic layouts', to: '/classic-layouts', icon: Film, roles: ['content_manager'] },
      { label: 'Presets', to: '/presets', icon: SlidersHorizontal, roles: ['content_manager'] },
      { label: 'Preview source', to: '/preview-source', icon: User, roles: ['content_manager'] },
    ],
  },
  {
    group: 'Business',
    items: [
      { label: 'Plans', to: '/plans', icon: CreditCard, roles: ['operator'] },
      { label: 'Subscriptions', to: '/subscriptions', icon: RefreshCw, roles: ['operator'] },
    ],
  },
  {
    group: 'System',
    items: [
      { label: 'Audit log', to: '/audit', icon: FileText, roles: ['operator'] },
      { label: 'Admin users', to: '/admin-users', icon: ShieldCheck, roles: ['superadmin'] },
      { label: 'Settings', to: '/settings', icon: KeyRound, roles: ['operator'] },
    ],
  },
]

/** Landing page per role — content_manager has no access to Overview. */
export const homeFor = (role: Role) => (role === 'content_manager' ? '/experiences' : '/overview')

const RoleCtx = createContext<{ role: Role; authenticated: boolean; loading: boolean; error: string; refresh: () => Promise<void> }>({ role: 'operator', authenticated: false, loading: true, error: '', refresh: async () => {} })
export const useRole = () => useContext(RoleCtx)

/**
 * In production the role comes from the admin session created by
 * `POST /api/admin/login`. It is held in state here only so each role's
 * navigation can be previewed.
 */
export function RoleProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role>('operator')
  const [authenticated, setAuthenticated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const refresh = async () => {
    setLoading(true)
    try { const identity = await api.getAdminMe(); setRole(identity.role); setAuthenticated(true); setError('') }
    catch (e: any) { setAuthenticated(false); setError([401, 403].includes(e.status) ? '' : 'Could not verify the admin session. Please try again.') }
    finally { setLoading(false) }
  }
  useEffect(() => { refresh() }, [])
  return <RoleCtx.Provider value={{ role, authenticated, loading, error, refresh }}>{children}</RoleCtx.Provider>
}
