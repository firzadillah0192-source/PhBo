import { Navigate, Route, Routes } from 'react-router-dom'
import { CustomerLayout, CustomerRoot, MinimalLayout, CustomerProvider } from './lib/customer'
import { Home, ClassicLayoutPick, ClassicPhotos, CreatePhoto, CreateReview, CreateStyle } from './pages/customer/LiveCreate'
import { Processing, Result } from './pages/customer/LiveResult'
import { AccountLayout, Creations, CreditsPlan, Privacy, Profile, Security, SharedPhoto, SignIn, SignUp } from './pages/customer/LiveAccount'
import { ToastProvider } from './components/overlays'

export default function App() {
  return (
    <ToastProvider>
      <CustomerProvider><Routes>
        <Route path="/" element={<Navigate to="/app" replace />} />
        <Route path="/claim/:code" element={<SharedPhoto />} />
        <Route path="/r/:token" element={<SharedPhoto />} />
        <Route path="/app" element={<CustomerRoot />}>
          <Route element={<CustomerLayout />}>
            <Route index element={<Home />} />
            <Route path="create/photo" element={<CreatePhoto />} />
            <Route path="create/style" element={<CreateStyle />} />
            <Route path="create/layout" element={<ClassicLayoutPick />} />
            <Route path="create/classic-photos" element={<ClassicPhotos />} />
            <Route path="create/review" element={<CreateReview />} />
            <Route path="result/:kind" element={<Result />} />
            <Route path="account" element={<AccountLayout />}>
              <Route index element={<Navigate to="creations" replace />} />
              <Route path="creations" element={<Creations />} />
              <Route path="credits" element={<CreditsPlan />} />
              <Route path="profile" element={<Profile />} />
              <Route path="security" element={<Security />} />
              <Route path="privacy" element={<Privacy />} />
            </Route>
          </Route>
          <Route element={<MinimalLayout />}>
            <Route path="signin" element={<SignIn />} />
            <Route path="signup" element={<SignUp />} />
          </Route>
          <Route path="processing" element={<Processing />} />
        </Route>
        <Route path="*" element={<Navigate to="/app" replace />} />
      </Routes></CustomerProvider>
    </ToastProvider>
  )
}
