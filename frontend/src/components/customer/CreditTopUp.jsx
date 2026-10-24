import SubscriptionPlans, { SubscriptionWalletSummary } from './SubscriptionPlans.jsx'
import SandboxNotice from './SandboxNotice.jsx'
import React, { useRef, useState } from 'react'
import { TOP_UP_OPTIONS, topUpPrice, formatRupiah } from '../../creditCatalog.js'
import { createTopUpCheckout } from '../../api.js'
import { checkoutDestination, checkoutUnavailable } from '../../topUpCheckout.js'
import StudioModal from './StudioModal.jsx'
import PaymentHistory from './PaymentHistory.jsx'
import { useLocale, useT } from '../../i18n.js'

export function WalletSummary({ usage }) {
  const t = useT()
  const locale = useLocale()
  if (usage.subscription) return <SubscriptionWalletSummary subscription={usage.subscription} />
  const wallet = usage.credit_wallet
  return <div className="account-credit-summary">
    <div className="account-credit-stat"><small>{t('Kredit Gratis', 'Free Credits')}</small><strong>{wallet?.free_remaining ?? '—'}<em> / 50</em></strong><span>{t('Kembali ke 50 setiap 14 hari. Tidak ditambahkan.', 'Resets to 50 every 14 days. Not cumulative.')}</span></div>
    <div className="account-credit-stat"><small>{t('Kredit Tambahan', 'Extra Credits')}</small><strong>{wallet?.top_up_remaining ?? '—'}</strong><span>{t('Saldo top up tersedia sampai habis.', 'Top-up balance lasts until used.')}</span></div>
    <div className="account-credit-stat"><small>{t('Pembaruan Gratis', 'Free Refresh')}</small><strong>{wallet?.next_reset_at ? new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(wallet.next_reset_at)) : '—'}</strong><span>{t(`${usage.ai_reserved || 0} kredit sedang diproses.`, `${usage.ai_reserved || 0} credits in progress.`)}</span></div>
  </div>
}

export default function CreditTopUp(props) {
  return props.data.usage.subscription ? <SubscriptionPlans {...props} /> : <LegacyCreditTopUp {...props} />
}

function LegacyCreditTopUp({ data, compact = false }) {
  const t = useT()
  const locale = useLocale()
  const payButton = useRef(null)
  const checkoutKey = useRef({ credits: null, key: null })
  const [selected, setSelected] = useState(100)
  const [custom, setCustom] = useState('')
  const [notice, setNotice] = useState('')
  const [unavailable, setUnavailable] = useState(false)
  const [paying, setPaying] = useState(false)
  const isCustom = selected === 'custom'
  const credits = isCustom ? custom : selected
  const price = topUpPrice(credits)
  const selectedName = isCustom ? t('Atur jumlah sendiri', 'Custom amount') : TOP_UP_OPTIONS.find(item => item.credits === selected)?.name
  const choose = value => { setSelected(value); setNotice('') }
  const pay = async () => {
    if (paying || price === null) return
    setPaying(true); setNotice('')
    try {
      if (checkoutKey.current.credits !== Number(credits)) checkoutKey.current = { credits: Number(credits), key: crypto.randomUUID() }
      const checkout = await createTopUpCheckout(Number(credits), checkoutKey.current.key)
      const destination = checkoutDestination(checkout, window.location.origin)
      if (destination) window.location.assign(destination)
      else setUnavailable(true)
    } catch (error) {
      if (checkoutUnavailable(error)) setUnavailable(true)
      else { if (error?.errorCode === 'PAYMENT_ORDER_CLOSED') checkoutKey.current = { credits: null, key: null }; setNotice(error?.status === 401 ? t('Silakan masuk kembali untuk melanjutkan pembayaran.', 'Please sign in again to continue the payment.') : error?.message || t('Pembayaran belum dapat dilanjutkan. Silakan coba kembali.', 'The payment could not continue. Please try again.')) }
    } finally { setPaying(false) }
  }
  return <>
    {!compact && <header className="account-page-heading"><p className="customer-kicker">{t('Isi kredit', 'Add credits')}</p><h1>{t('Tambah Kredit Kreatif.', 'Add Creative Credits.')}</h1><p>{t('Sekali isi, pakai untuk berkarya sampai habis. Tanpa langganan.', 'Top up once and use it until it runs out. No subscription.')}</p></header>}
    {!compact && <WalletSummary usage={data.usage} />}
    {!compact && <section className="account-panel account-credit-panel"><div className="account-panel-heading"><div><p className="account-eyebrow">{t('Saldo tersedia', 'Available balance')}</p><h2>{data.usage.ai_remaining} {t('kredit', 'credits')}</h2></div></div><p>{t('Kredit gratis dipakai lebih dulu. Semua mode memakai kredit; generate gagal tidak memotong saldo.', 'Free credits are used first. Every mode uses credits; a failed generation does not deduct your balance.')}</p><p>{t('Photo Booth: 1 kredit per hasil. AI memerlukan minimal 10 kredit untuk mulai; biaya token dihitung dan kredit dipotong setelah hasil berhasil.', 'Photo Booth: 1 credit per result. AI needs at least 10 credits to start; token cost is calculated and credits are deducted after a successful result.')}</p></section>}
    <section aria-labelledby="bekal-options"><div className="account-panel-heading"><div><p className="account-eyebrow">{t('Rp100 per kredit', 'Rp100 per credit')}</p><h2 id="bekal-options">{t('Pilih jumlah kredit', 'Choose your credits')}</h2></div></div>
      <div className="bekal-option-grid">{TOP_UP_OPTIONS.map(item => <button type="button" className={`bekal-option ${selected === item.credits ? 'is-selected' : ''}`} key={item.credits} aria-pressed={selected === item.credits} onClick={() => choose(item.credits)}><strong>{item.name}</strong><span>{item.credits.toLocaleString(locale)} {t('kredit', 'credits')}</span><b>{formatRupiah(topUpPrice(item.credits))}</b></button>)}<button type="button" className={`bekal-option ${isCustom ? 'is-selected' : ''}`} aria-pressed={isCustom} onClick={() => choose('custom')}><strong>{t('Atur jumlah sendiri', 'Custom amount')}</strong><span>{t('Tentukan jumlah sendiri', 'Set your own amount')}</span><b>{t('Rp100 / kredit', 'Rp100 / credit')}</b></button></div>
    </section>
    <section className="account-panel bekal-checkout" aria-label={t('Ringkasan isi kredit', 'Top-up summary')}>
      {isCustom && <label className="bekal-custom-label">{t('Jumlah kredit', 'Credit amount')}<input type="number" aria-label={t('Jumlah kredit', 'Credit amount')} min="1" step="1" inputMode="numeric" value={custom} onChange={event => { setCustom(event.target.value); setNotice('') }} aria-describedby="bekal-custom-help" /><small id="bekal-custom-help">{t('Masukkan jumlah kredit dalam bilangan bulat positif.', 'Enter the credit amount as a positive whole number.')}</small></label>}
      <div className="bekal-total" aria-live="polite"><span>{selectedName}{price !== null ? ` · ${Number(credits).toLocaleString(locale)} ${t('kredit', 'credits')}` : ''}</span><strong>{price !== null ? formatRupiah(price) : t('Masukkan jumlah yang valid', 'Enter a valid amount')}</strong></div>
      <SandboxNotice />
      <button ref={payButton} className="customer-solid-button" type="button" disabled={price === null || paying} onClick={pay}>{paying ? t('Menyiapkan pembayaran…', 'Preparing payment…') : t('Bayar', 'Pay')} <span aria-hidden="true">→</span></button>
      {notice && <p role="status" className="account-inline-notice">{notice}</p>}
    </section>
    {!compact && <PaymentHistory />}
    {unavailable && <StudioModal title={t('Pembayaran belum tersedia', 'Payments not available')} returnFocus={payButton} onClose={() => setUnavailable(false)}><div className="payment-unavailable"><p className="customer-kicker">{t('Isi kredit', 'Add credits')}</p><h2>{t('Pembayaran saat ini belum tersedia.', 'Payments are not available right now.')}</h2><p>{t('Silakan coba lagi nanti. Untuk bantuan, hubungi kami melalui email di bawah ini.', 'Please try again later. For help, contact us at the email below.')}</p><a className="payment-support-email" href="mailto:support@gennexbyte.com">support@gennexbyte.com</a><button type="button" className="customer-solid-button" onClick={() => setUnavailable(false)}>{t('Kembali ke pilihan kredit', 'Back to credit options')}</button></div></StudioModal>}
  </>
}
