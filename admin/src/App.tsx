import { Navigate, Route, Routes } from 'react-router-dom'
import { ToastProvider } from './components/overlays'
import { homeFor, RoleProvider, useRole } from './lib/role'
import { ClassicLayouts } from './pages/ClassicLayouts'
import { ExperienceEditor } from './pages/ExperienceEditor'
import { Experiences } from './pages/Experiences'
import { GenerationDetail, Generations, Overview } from './pages/Operations'
import { Login } from './pages/Login'
import { UserDetail, Users } from './pages/Users'
import { Plans, Subscriptions } from './pages/Business'
import { Presets } from './pages/Presets'
import { PreviewSource } from './pages/PreviewSource'
import { Providers } from './pages/Providers'
import { AdminUsers, AuditLog, CreditsLedger, Settings } from './pages/System'
import { Templates } from './pages/Templates'
import { Usage } from './pages/Usage'
import { UsageGenerationDetail } from './pages/UsageGenerationDetail'

function Home() {
  const { role } = useRole()
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
