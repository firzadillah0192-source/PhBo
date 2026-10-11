import { Navigate, Route, Routes } from 'react-router-dom'
import { ToastProvider } from './components/overlays'
import { homeFor, RoleProvider, useRole } from './lib/role'
import { ClassicLayouts, ExperienceEditor, Experiences, Plans, Presets, PreviewSource, AdminUsers, Templates } from './pages/LiveCatalog'
import { GenerationDetail, Generations, Overview, Login, UserDetail, Users, Subscriptions, Providers, AuditLog, CreditsLedger, Settings, Usage, UsageGenerationDetail } from './pages/LiveAdmin'

function Home() {
  const { role, loading, authenticated, error, refresh } = useRole()
  if (loading) return <p role="status">Checking admin session…</p>
  if (error) return <div role="alert">{error}<button onClick={refresh}>Retry</button></div>
  if (!authenticated) return <Navigate to="/login" replace />
  return <Navigate to={homeFor(role)} replace />
}

export default function App() {
  return (
    <RoleProvider>
      <ToastProvider>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/overview" element={<Overview />} />
          <Route path="/generations" element={<Generations />} />
          <Route path="/generations/:id" element={<GenerationDetail />} />
          <Route path="/users" element={<Users />} />
          <Route path="/users/:id" element={<UserDetail />} />

          <Route path="/credits" element={<CreditsLedger />} />
          <Route path="/usage" element={<Usage />} />
          <Route path="/usage/generations/:id" element={<UsageGenerationDetail />} />
          <Route path="/providers" element={<Providers />} />

          <Route path="/experiences" element={<Experiences />} />
          <Route path="/experiences/:id" element={<ExperienceEditor />} />
          <Route path="/templates" element={<Templates />} />
          <Route path="/classic-layouts" element={<ClassicLayouts />} />
          <Route path="/presets" element={<Presets />} />
          <Route path="/preview-source" element={<PreviewSource />} />

          <Route path="/plans" element={<Plans />} />
          <Route path="/subscriptions" element={<Subscriptions />} />

          <Route path="/audit" element={<AuditLog />} />
          <Route path="/admin-users" element={<AdminUsers />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </ToastProvider>
    </RoleProvider>
  )
}
