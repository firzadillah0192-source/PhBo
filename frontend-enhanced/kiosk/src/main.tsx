import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, useLocation } from 'react-router-dom'
import App from './App'
import { Analytics } from '../../shared/Analytics'
import './index.css'

function RouteAnalytics() { return <Analytics pathname={useLocation().pathname} /> }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <RouteAnalytics />
      <App />
    </BrowserRouter>
  </StrictMode>,
)
