import React from 'react'
import { BUSINESS } from '../../businessInfo.js'
import { useT } from '../../i18n.js'

// One warning for every place that offers checkout while Duitku runs in Sandbox. Remove it when payments go to production.
export default function SandboxNotice({ className = '' }) {
  const t = useT()
  return <div className={`sandbox-notice ${className}`.trim()} role="note">
    <svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M12 3.2 22 20.5H2L12 3.2Z" fill="#ffda50" stroke="#26201a" strokeWidth="2" strokeLinejoin="round" /><path d="M12 9.5v5" stroke="#26201a" strokeWidth="2" strokeLinecap="round" /><circle cx="12" cy="17.4" r="1.1" fill="#26201a" /></svg>
    <p>{t('Saat ini pembayaran masih berjalan di lingkungan Sandbox (uji coba). Untuk pertanyaan atau permintaan terkait pembayaran, silakan hubungi ', 'Payments currently run in the Sandbox (test) environment. For questions or requests about payments, please contact ')}<a href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a>.</p>
  </div>
}
