import React, { useRef, useState } from 'react'
import { TOP_UP_OPTIONS, topUpPrice, formatRupiah } from '../../creditCatalog.js'
import { createTopUpCheckout } from '../../api.js'
import { checkoutDestination, checkoutUnavailable } from '../../topUpCheckout.js'
import StudioModal from './StudioModal.jsx'

export function WalletSummary({ usage }) {
  const wallet = usage.credit_wallet
  return <div className="account-credit-summary">
    <div className="account-credit-stat"><small>Kredit Gratis</small><strong>{wallet?.free_remaining ?? '—'}<em> / 50</em></strong><span>Kembali ke 50 setiap 14 hari. Tidak ditambahkan.</span></div>
    <div className="account-credit-stat"><small>Kredit Tambahan</small><strong>{wallet?.top_up_remaining ?? '—'}</strong><span>Saldo top up tersedia sampai habis.</span></div>
    <div className="account-credit-stat"><small>Pembaruan Gratis</small><strong>{wallet?.next_reset_at ? new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(wallet.next_reset_at)) : '—'}</strong><span>{usage.ai_reserved || 0} kredit sedang diproses.</span></div>
  </div>
}

export default function CreditTopUp({ data, compact = false }) {
  const payButton = useRef(null)
  const [selected, setSelected] = useState(100)
  const [custom, setCustom] = useState('')
  const [notice, setNotice] = useState('')
  const [unavailable, setUnavailable] = useState(false)
  const [paying, setPaying] = useState(false)
  const isCustom = selected === 'custom'
  const credits = isCustom ? custom : selected
  const price = topUpPrice(credits)
  const selectedName = isCustom ? 'Racik Bekalmu' : TOP_UP_OPTIONS.find(item => item.credits === selected)?.name
  const choose = value => { setSelected(value); setNotice('') }
  const pay = async () => {
    if (paying || price === null) return
    setPaying(true); setNotice('')
    try {
      const checkout = await createTopUpCheckout(Number(credits))
      const destination = checkoutDestination(checkout, window.location.origin)
      if (destination) window.location.assign(destination)
      else setUnavailable(true)
    } catch (error) {
      if (checkoutUnavailable(error)) setUnavailable(true)
      else setNotice(error?.status === 401 ? 'Silakan sign in kembali untuk melanjutkan pembayaran.' : 'Pembayaran belum dapat dilanjutkan. Silakan coba kembali.')
    } finally { setPaying(false) }
  }
  return <>
    {!compact && <header className="account-page-heading"><p className="customer-kicker">Isi kredit</p><h1>Tambah Bekal Kreatif.</h1><p>Sekali isi, pakai untuk berkarya sampai habis. Tanpa langganan.</p></header>}
    {!compact && <WalletSummary usage={data.usage} />}
    {!compact && <section className="account-panel account-credit-panel"><div className="account-panel-heading"><div><p className="account-eyebrow">Saldo tersedia</p><h2>{data.usage.ai_remaining} kredit</h2></div></div><p>Kredit gratis dipakai lebih dulu. Semua mode memakai kredit; generate gagal tidak memotong saldo.</p><p>Photo Booth: 1 kredit per hasil. AI memerlukan minimal 10 kredit untuk mulai; biaya token dihitung dan kredit dipotong setelah hasil berhasil.</p></section>}
    <section aria-labelledby="bekal-options"><div className="account-panel-heading"><div><p className="account-eyebrow">Rp100 per kredit</p><h2 id="bekal-options">Pilih bekalmu</h2></div></div>
      <div className="bekal-option-grid">{TOP_UP_OPTIONS.map(item => <button type="button" className={`bekal-option ${selected === item.credits ? 'is-selected' : ''}`} key={item.credits} aria-pressed={selected === item.credits} onClick={() => choose(item.credits)}><strong>{item.name}</strong><span>{item.credits.toLocaleString('id-ID')} kredit</span><b>{formatRupiah(topUpPrice(item.credits))}</b></button>)}<button type="button" className={`bekal-option ${isCustom ? 'is-selected' : ''}`} aria-pressed={isCustom} onClick={() => choose('custom')}><strong>Racik Bekalmu</strong><span>Tentukan jumlah sendiri</span><b>Rp100 / kredit</b></button></div>
    </section>
    <section className="account-panel bekal-checkout" aria-label="Ringkasan isi bekal">
      {isCustom && <label className="bekal-custom-label">Jumlah kredit<input type="number" aria-label="Jumlah kredit" min="1" step="1" inputMode="numeric" value={custom} onChange={event => { setCustom(event.target.value); setNotice('') }} aria-describedby="bekal-custom-help" /><small id="bekal-custom-help">Masukkan jumlah kredit dalam bilangan bulat positif.</small></label>}
      <div className="bekal-total" aria-live="polite"><span>{selectedName}{price !== null ? ` · ${Number(credits).toLocaleString('id-ID')} kredit` : ''}</span><strong>{price !== null ? formatRupiah(price) : 'Masukkan jumlah yang valid'}</strong></div>
      <p className="bekal-payment-note"><span aria-hidden="true">✦</span> Kredit ditambahkan setelah pembayaran berhasil dikonfirmasi.</p>
      <button ref={payButton} className="customer-solid-button" type="button" disabled={price === null || paying} onClick={pay}>{paying ? 'Menyiapkan pembayaran…' : 'Bayar'} <span aria-hidden="true">→</span></button>
      {notice && <p role="status" className="account-inline-notice">{notice}</p>}
    </section>
    {unavailable && <StudioModal title="Pembayaran belum tersedia" returnFocus={payButton} onClose={() => setUnavailable(false)}><div className="payment-unavailable"><p className="customer-kicker">Isi bekal</p><h2>Pembayaran saat ini belum tersedia.</h2><p>Silakan coba lagi nanti. Untuk bantuan, hubungi kami melalui email di bawah ini.</p><a className="payment-support-email" href="mailto:support@gennexbyte.com">support@gennexbyte.com</a><button type="button" className="customer-solid-button" onClick={() => setUnavailable(false)}>Kembali ke pilihan bekal</button></div></StudioModal>}
  </>
}
