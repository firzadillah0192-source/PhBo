import React, { useRef, useState } from 'react'
import { createSubscriptionCheckout, createTopUpCheckout } from '../../api.js'
import { checkoutDestination } from '../../topUpCheckout.js'
import { formatRupiah } from '../../creditCatalog.js'
import { useLocale, useT } from '../../i18n.js'
import SandboxNotice from './SandboxNotice.jsx'
import '../../subscription.css'

const TOP_UP_PRESETS = [1000, 2500, 5000, 10000]

export function SubscriptionWalletSummary({ subscription }) {
  const t = useT()
  const locale = useLocale()
  const { ai, classic, storage, plan } = subscription
  return <div className="account-credit-summary">
    <div className="account-credit-stat"><small>AI Credit</small><strong>{ai.remaining.toLocaleString(locale)}</strong><span>{t(`${ai.monthly_remaining} dari paket · ${ai.top_up_remaining} top-up. Standard 50 / Fast 100 kredit.`, `${ai.monthly_remaining} from plan · ${ai.top_up_remaining} top-up. Standard 50 / Fast 100 credits.`)}</span></div>
    <div className="account-credit-stat"><small>Classic Credit</small><strong>{classic.remaining.toLocaleString(locale)}</strong><span>{t(`10 kredit/hasil · sisa harian ${classic.daily_remaining}/${classic.daily_limit}. Reset 00.00 WIB.`, `10 credits/result · ${classic.daily_remaining}/${classic.daily_limit} left today. Resets 00:00 WIB.`)}</span></div>
    <div className="account-credit-stat"><small>{t('Penyimpanan', 'Storage')} · {plan.name}</small><strong>{(storage.used_bytes / 1e6).toFixed(1)} MB</strong><span>{t(`Dari ${(storage.limit_bytes / 1e6).toLocaleString(locale)} MB · retensi foto baru ${plan.retention_days} hari.`, `Of ${(storage.limit_bytes / 1e6).toLocaleString(locale)} MB · new photos kept ${plan.retention_days} days.`)}</span></div>
  </div>
}

export default function SubscriptionPlans({ data, compact = false, onTabChange }) {
  const t = useT()
  const locale = useLocale()
  const subscription = data.usage.subscription
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [credits, setCredits] = useState(1000)
  const request = useRef({ product: '', key: '' })
  const checkout = async (product, action) => {
    if (busy) return
    setBusy(product); setError('')
    if (request.current.product !== product) request.current = { product, key: crypto.randomUUID() }
    try {
      const result = await action(request.current.key)
      const destination = checkoutDestination(result, window.location.origin)
      if (!destination) throw new Error(t('Alamat checkout tidak tersedia.', 'Checkout address is not available.'))
      window.location.assign(destination)
    } catch (e) {
      if (e?.errorCode === 'PAYMENT_ORDER_CLOSED') request.current = { product: '', key: '' }
      setError(e.message || t('Checkout belum tersedia.', 'Checkout is not available yet.'))
    } finally { setBusy('') }
  }
  const validCredits = /^\d+$/.test(String(credits)) && Number(credits) > 0 && Number(credits) <= 100000
  const topUp = <section className="account-panel subscription-section subscription-topup" aria-label={t('Top-up AI Credit', 'AI Credit top-up')}>
    <div className="topup-form">
      <h2>{t('Tambah AI Credit', 'Add AI Credit')}</h2>
      <p>{t('Rp10/kredit · 1.000 AI Credit = Rp10.000. Menambah kredit tidak mengubah akses Fast atau batas Classic harian.', 'Rp10/credit · 1,000 AI Credit = Rp10,000. Adding credits does not change Fast access or the daily Classic limit.')}</p>
      <div className="topup-presets" role="group" aria-label={t('Pilihan jumlah cepat', 'Quick amounts')}>
        {TOP_UP_PRESETS.map(value => <button key={value} type="button" className={Number(credits) === value ? 'is-selected' : ''} aria-pressed={Number(credits) === value} onClick={() => setCredits(value)}>{value.toLocaleString(locale)}</button>)}
      </div>
      <label>{t('Jumlah AI Credit', 'AI Credit amount')}<input type="number" min="1" max="100000" step="1" value={credits} onChange={e => setCredits(e.target.value)} /></label>
    </div>
    <div className="topup-summary">
      <h3>{t('Ringkasan pesanan', 'Order summary')}</h3>
      <dl>
        <div><dt>{t('Jumlah', 'Amount')}</dt><dd>{validCredits ? `${Number(credits).toLocaleString(locale)} AI Credit` : '—'}</dd></div>
        <div><dt>{t('Total bayar', 'Total')}</dt><dd className="topup-total">{validCredits ? formatRupiah(Number(credits) * 10) : t('Masukkan 1–100.000 kredit dalam bilangan bulat.', 'Enter 1–100,000 credits as a whole number.')}</dd></div>
      </dl>
      <button type="button" className="customer-solid-button" disabled={!validCredits || !!busy} onClick={() => checkout(`ai:${credits}`, key => createTopUpCheckout(Number(credits), key))}>{busy ? t('Menyiapkan…', 'Preparing…') : t('Checkout AI Credit', 'Checkout AI Credit')}</button>
      {error && <p className="payment-error" role="alert">{error}</p>}
      <SandboxNotice />
      <ul className="topup-notes">
        <li>{t('Top-up Classic serta add-on Storage + Retensi menyusul setelah ukuran dan harganya ditetapkan.', 'Classic top-ups and Storage + Retention add-ons follow once sizes and prices are set.')}</li>
      </ul>
    </div>
  </section>
  return <>
    {!compact && <><header className="account-page-heading"><p className="customer-kicker">{t('Paket & kredit', 'Plans & credits')}</p><h1>{t('Kredit untuk setiap kreasi.', 'Credits for every creation.')}</h1><p>{t('AI Credit dan Classic Credit terpisah. Jatah paket berlaku satu periode; top-up tidak ikut reset.', 'AI Credit and Classic Credit are separate. Plan allowances last one period; top-ups do not reset.')}</p></header><SubscriptionWalletSummary subscription={subscription} />
      <section className="account-panel subscription-section" aria-label={t('Paket langganan', 'Subscription plans')}><h2>{t('Pilih paket bulanan', 'Choose a monthly plan')}</h2><p>{t('Paket berbayar membuka Fast. Custom Creation sedang disiapkan; belum tersedia pada rilis ini.', 'Paid plans unlock Fast. Custom Creation is being prepared and is not available in this release.')}</p><div className="subscription-plan-grid">
        {subscription.catalog.plans.map(plan => { const current = subscription.plan.code === plan.code; return <article className={`account-plan-card subscription-plan-card ${current ? 'is-current' : ''}`} key={plan.code}>
          <div className="plan-head"><h3>{plan.name}</h3>{current && <span className="account-current-badge">{t('Paket Anda', 'Your plan')}</span>}</div>
          <p className="plan-price"><strong>{plan.price_rupiah ? formatRupiah(plan.price_rupiah) : t('Gratis', 'Free')}</strong>{plan.price_rupiah ? <span>{t('/bulan', '/month')}</span> : null}</p>
          <ul className="plan-features">
            <li><b>{plan.monthly_ai_credits.toLocaleString(locale)} AI Credit</b><span>{t(`${plan.fast_results_per_period} hasil Fast atau ${plan.monthly_ai_credits / 50} hasil Standard`, `${plan.fast_results_per_period} Fast or ${plan.monthly_ai_credits / 50} Standard results`)}</span></li>
            <li><b>{plan.monthly_classic_credits.toLocaleString(locale)} Classic Credit</b><span>{t(`${plan.classic_results_per_period} hasil/periode · maks. ${plan.classic_daily_results}/hari`, `${plan.classic_results_per_period} results/period · max ${plan.classic_daily_results}/day`)}</span></li>
            <li><b>{(plan.storage_bytes / 1e6).toLocaleString(locale)} MB</b><span>{t(`penyimpanan · retensi ${plan.retention_days} hari`, `storage · ${plan.retention_days}-day retention`)}</span></li>
          </ul>
          {plan.code === 'max' && <small>{t('Batas 20/hari memungkinkan maksimal 600 hasil Classic dalam 30 hari, dari jatah 625.', 'The 20/day cap allows at most 600 Classic results in 30 days, out of a 625 allowance.')}</small>}
          {plan.premium
            ? <button type="button" className={current ? 'customer-outline-button' : 'customer-solid-button'} disabled={!!busy || current} onClick={() => checkout(`plan:${plan.code}`, key => createSubscriptionCheckout(plan.code, key))}>{busy === `plan:${plan.code}` ? t('Menyiapkan…', 'Preparing…') : current ? t('Paket aktif', 'Active plan') : t(`Pilih ${plan.name}`, `Choose ${plan.name}`)}</button>
            : <button type="button" className="customer-outline-button" disabled>{current ? t('Paket aktif', 'Active plan') : t('Paket dasar', 'Base plan')}</button>}
        </article> })}
      </div></section></>}
    {topUp}
    {!compact && onTabChange && <p className="topup-history-link"><button type="button" className="account-text-button" onClick={() => onTabChange('billing')}>{t('Lihat riwayat pembayaran', 'View payment history')} <b aria-hidden="true">→</b></button></p>}
  </>
}
