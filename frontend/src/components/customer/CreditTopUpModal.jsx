import React from 'react'
import StudioModal from './StudioModal.jsx'
import CreditTopUp from './CreditTopUp.jsx'
export default function CreditTopUpModal({ usage, required = 10, onClose, onSignIn }) {
  return <StudioModal title="Tambah Bekal Kreatif" onClose={onClose}><p className="bekal-minimum" role="status">{usage?.ai_remaining < required ? `Kredit tidak mencukupi. Perlu minimal ${required} kredit; saldo kamu ${usage?.ai_remaining ?? 0}.` : 'Isi bekal untuk melanjutkan berkarya.'}</p>{usage?.authenticated ? <CreditTopUp data={{ usage }} compact /> : <div className="customer-empty"><h2>Mulai dengan bekal gratis.</h2><p>Masuk untuk mendapat 50 kredit gratis, kembali penuh setiap 14 hari.</p><button className="customer-solid-button" type="button" onClick={onSignIn}>Sign in / Create account</button></div>}</StudioModal>
}
