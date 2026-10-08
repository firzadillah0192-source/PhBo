import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import KioskEntry from './components/kiosk/KioskEntry.jsx'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <KioskEntry><App /></KioskEntry>
  </React.StrictMode>,
)
