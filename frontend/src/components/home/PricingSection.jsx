import React from 'react'
import { formatRupiah } from '../../creditCatalog.js'
import { localeFor, useLanguage, useT } from '../../i18n.js'
import { BUSINESS } from '../../businessInfo.js'

const DESCRIPTIONS = {
  free: ['Mulai berkreasi tanpa biaya dengan strip Photo Booth klasik.', 'Start creating at no cost with classic Photo Booth strips.'],
  starter: ['Untuk pencipta santai yang ingin mencoba dunia AI.', 'For casual creators trying the AI worlds.'],
  plus: ['Lebih banyak hasil setiap bulan untuk kreasi rutin.', 'More results every month for regular creating.'],
  pro: ['Untuk kreator aktif dengan penyimpanan lebih lega.', 'For active creators with roomier storage.'],
  max: ['Kapasitas terbesar untuk acara dan produksi berulang.', 'The largest capacity for events and repeat production.'],
}

// Products and prices come from the API catalog (the same one checkout charges), never from copied numbers.
export default function PricingSection({ catalog, onBuy }) {
  const t = useT()
  const locale = localeFor(useLanguage())
  const plans = catalog?.plans || []
  const perCredit = catalog?.ai_top_up_rupiah_per_credit
  const number = (value) => Number(value).toLocaleString(locale)
  return <section id="harga" className="landing-pricing landing-container landing-section" aria-labelledby="pricing-title">
    <div className="landing-section-heading">
      <p className="landing-eyebrow">{t('Produk & harga', 'Products & pricing')}</p>
      <h2 id="pricing-title">{t('Pilih paket yang sesuai', 'Choose the plan that fits')} <br />{t('cerita Anda.', 'your story.')}</h2>
      <p className="landing-pricing-note">{t('Semua harga dalam Rupiah (IDR).', 'All prices are in Rupiah (IDR).')}</p>
      <div className="landing-pricing-alert" role="note">
        <svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M12 3.2 22 20.5H2L12 3.2Z" fill="#ffda50" stroke="#26201a" strokeWidth="2" strokeLinejoin="round" /><path d="M12 9.5v5" stroke="#26201a" strokeWidth="2" strokeLinecap="round" /><circle cx="12" cy="17.4" r="1.1" fill="#26201a" /></svg>
        <p>{t('Saat ini pembayaran masih berjalan di lingkungan Sandbox (uji coba). Untuk pertanyaan atau permintaan terkait pembayaran, silakan hubungi ', 'Payments currently run in the Sandbox (test) environment. For questions or requests about payments, please contact ')}<a href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a>.</p>
      </div>
    </div>
    {plans.length ? <>
      <ul className="landing-plan-grid" aria-label={t('Daftar paket langganan', 'Subscription plans')}>
        {plans.map((plan) => <li key={plan.code} className="landing-plan-card">
          <h3>{plan.name}</h3>
          <p className="landing-plan-price"><strong>{plan.price_rupiah ? formatRupiah(plan.price_rupiah) : t('Gratis', 'Free')}</strong>{plan.price_rupiah ? <span>{t('/bulan', '/month')}</span> : null}</p>
          <p className="landing-plan-desc">{t(...(DESCRIPTIONS[plan.code] || ['', '']))}</p>
          <ul className="landing-plan-features">
            <li><b>{number(plan.monthly_ai_credits)} AI Credit</b><span>{t(`${plan.fast_results_per_period ?? Math.floor(plan.monthly_ai_credits / 100)} hasil Fast atau ${Math.floor(plan.monthly_ai_credits / 50)} hasil Standard`, `${plan.fast_results_per_period ?? Math.floor(plan.monthly_ai_credits / 100)} Fast or ${Math.floor(plan.monthly_ai_credits / 50)} Standard results`)}</span></li>
            <li><b>{number(plan.monthly_classic_credits)} Classic Credit</b><span>{t(`${Math.floor(plan.monthly_classic_credits / 10)} hasil Photo Booth · maks. ${plan.classic_daily_results}/hari`, `${Math.floor(plan.monthly_classic_credits / 10)} Photo Booth results · max ${plan.classic_daily_results}/day`)}</span></li>
            <li><b>{number(plan.storage_bytes / 1e6)} MB</b><span>{t(`penyimpanan · retensi ${plan.retention_days} hari`, `storage · ${plan.retention_days}-day retention`)}</span></li>
          </ul>
          <button type="button" className={plan.price_rupiah ? 'customer-solid-button' : 'customer-outline-button'} onClick={() => onBuy?.(plan.price_rupiah ? 'plan' : 'create')}>{plan.price_rupiah ? t(`Beli ${plan.name}`, `Buy ${plan.name}`) : t('Mulai Gratis', 'Start Free')}</button>
        </li>)}
        {perCredit ? <li className="landing-plan-card landing-plan-topup">
          <h3>{t('Tambah AI Credit', 'Add AI Credit')}</h3>
          <p className="landing-plan-price"><strong>{formatRupiah(perCredit)}</strong><span>{t('/kredit', '/credit')}</span></p>
          <p className="landing-plan-desc">{t('Isi ulang kapan saja di luar paket bulanan. Kredit tambahan tidak kedaluwarsa dan tidak ikut reset.', 'Top up any time on top of a monthly plan. Extra credit does not expire and is not reset.')}</p>
          <ul className="landing-plan-features">
            <li><b>1.000 AI Credit = {formatRupiah(perCredit * 1000)}</b><span>{t('20 hasil Standard atau 10 hasil Fast', '20 Standard or 10 Fast results')}</span></li>
            <li><b>{t('Jumlah bebas', 'Any amount')}</b><span>{t('1 sampai 100.000 kredit per pesanan', '1 to 100,000 credits per order')}</span></li>
          </ul>
          <button type="button" className="customer-solid-button" onClick={() => onBuy?.('plan')}>{t('Beli Kredit', 'Buy Credit')}</button>
        </li> : null}
      </ul>
      <p className="landing-pricing-foot">{t('Checkout dibuka setelah Anda masuk: pilih paket atau jumlah kredit, lalu selesaikan pembayaran di halaman Duitku.', 'Checkout opens after you sign in: pick a plan or credit amount, then complete payment on the Duitku page.')}</p>
    </> : <p className="landing-catalog-state" role="status">{t('Memuat daftar harga…', 'Loading prices…')}</p>}
  </section>
}
