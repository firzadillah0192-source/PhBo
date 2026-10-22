import React, { useRef, useState } from 'react'
import { createTopUpCheckout } from '../../api.js'
import { TOP_UP_OPTIONS, formatRupiah, topUpPrice } from '../../creditCatalog.js'
import { checkoutDestination } from '../../topUpCheckout.js'
import PaymentHistory from './PaymentHistory.jsx'
export default function SandboxTopUp() {
  const [credits, setCredits] = useState(100), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const request = useRef(null)
  const submit = async event => {
    event.preventDefault(); if (busy) return
    setBusy(true); setError('')
    try {
      if (request.current?.credits !== Number(credits)) request.current = { credits: Number(credits), key: crypto.randomUUID() }
      const checkout = await createTopUpCheckout(Number(credits), request.current.key)
      const url = checkoutDestination(checkout, window.location.origin)
      if (!url) throw new Error('Checkout belum tersedia. Periksa riwayat pembayaran.')
      window.location.assign(url)
    } catch (e) { if (e.errorCode === 'PAYMENT_ORDER_CLOSED') request.current = null; setError(e.message) } finally { setBusy(false) }
  }
  return <section className="space-y-3"><h2>Checkout Sandbox</h2><p>Simulasi pembayaran. Kredit uji terpisah dari saldo produksi dan tidak dapat digunakan untuk membuat foto.</p>
    <form className="space-y-3" onSubmit={submit}>
      <label>Paket kredit uji<select className="block w-full rounded-md border p-3" value={credits} onChange={e => { setCredits(Number(e.target.value)); setError('') }}>{TOP_UP_OPTIONS.map(p => <option key={p.credits} value={p.credits}>{p.name} · {p.credits} kredit · {formatRupiah(topUpPrice(p.credits))}</option>)}</select></label>
      <button className="rounded-md bg-primary px-5 py-3 font-semibold text-white" type="submit" disabled={busy}>{busy ? 'Menyiapkan…' : `Bayar uji ${formatRupiah(topUpPrice(credits))}`}</button>
    </form>{error && <p role="alert">{error}</p>}<PaymentHistory />
  </section>
}
