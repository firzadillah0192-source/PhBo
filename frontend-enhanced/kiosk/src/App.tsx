import { Navigate, Route, Routes } from 'react-router-dom'
import { Kiosk } from './pages/LiveKiosk'

export default function App() {
  return (
    <Routes>
      <Route path="/kiosk" element={<Kiosk />} />
      <Route path="*" element={<Navigate to="/kiosk" replace />} />
    </Routes>
  )
}
