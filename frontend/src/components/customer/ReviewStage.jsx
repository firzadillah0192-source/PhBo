import React from 'react'
import { uploadPreviewUrl } from '../../api.js'
import { experiencePreview, templatePreview } from './experienceCatalog.js'
import { useT } from '../../i18n.js'

export default function ReviewStage({ subscription, apiRoutes, aiLane = 'standard', onAiLane, mode, upload, selection, frameStyle, ornaments = [], aiRemaining, authenticated = false, quotaExhausted, busy, eventName = '', onEventNameChange, onReplace, onBack, onCreate, onOpenAccount, onPreviewError }) {
  const t = useT()
  const destination = mode === 'ADVANCED' ? experiencePreview(selection) : templatePreview(selection)
  const cost = subscription ? (aiLane === 'fast' ? 100 : 50) : 10
  return (
    <section className={`review-stage customer-stage-enter ${busy ? 'is-creating' : ''}`}>
      <nav className="capture-navigation" aria-label={t('Navigasi tinjauan', 'Review navigation')}>
        <button className="customer-inline-button" onClick={onBack} disabled={busy}>← {mode === 'ADVANCED' ? t('Kembali ke gaya bingkai', 'Back to frame style') : t('Coba tampilan lain', 'Try another look')}</button>
        <button className="customer-inline-button" onClick={onReplace} disabled={busy}>{t('Ganti foto', 'Replace photo')}</button>
      </nav>
      <header className="stage-heading">
        <p className="customer-kicker">{t('Tinjauan terakhir', 'One last look')}</p>
        <h1>{t('Foto Anda, dunia ini.', 'Your photograph, this world.')}</h1>
        <p>{t('Satu potret sumber. Satu tujuan yang dipilih dengan cermat.', 'One source portrait. One carefully chosen destination.')}</p>
      </header>

      <div className="review-layout">
        <div className="review-composition">
          <figure className="review-source">
            <img src={upload.preview_url || uploadPreviewUrl(upload.upload_id)} alt={t('Potret yang Anda unggah', 'Your uploaded portrait')} onError={onPreviewError} />
            <figcaption><small>01</small><span>{t('Foto Anda', 'Your photograph')}</span></figcaption>
          </figure>
          <span className="review-bridge" aria-hidden="true"><i />→</span>
          <figure className="review-destination">
            {destination ? <img src={destination} alt={t(`Tujuan visual ${selection.name}`, `${selection.name} visual destination`)} /> : <div className="review-destination-placeholder"><small>{t('Pratinjau pemasaran', 'Marketing preview')}</small><strong>{t('Pratinjau segera hadir', 'Preview coming soon')}</strong><span>{t('Pilihan studio tersimpan', 'Studio selection saved')}</span></div>}
            <figcaption><small>02</small><span>{selection.name}</span></figcaption>
          </figure>
          <div className="review-convergence-light" aria-hidden="true" />
        </div>

        <aside className="review-panel">
          {mode !== 'CLASSIC' && onEventNameChange && <div className="classic-event-details review-event-details">
            <label htmlFor="review-event-name">{t('Nama event (opsional)', 'Event name (optional)')}<input id="review-event-name" value={eventName} maxLength={80} placeholder={t('Misalnya: Ulang Tahun Budi', 'For example: Budi’s Birthday')} onChange={event => onEventNameChange(event.target.value)} disabled={busy} autoComplete="off" aria-describedby="review-event-help" /></label>
            <p id="review-event-help">{t('Muncul di footer foto bersama tanggal otomatis (WIB). QR untuk unduh selalu ada di footer.', 'Shown in the photo footer with an automatic date (WIB). The download QR is always in the footer.')}</p>
          </div>}

          {mode === 'ADVANCED' && <div className="advanced-review-summary" aria-label={t('Opsi generate yang dipilih', 'Selected generation options')}><span><small>{t('Pengalaman', 'Experience')}</small><strong>{selection.name}</strong></span><span><small>{t('Gaya bingkai', 'Frame style')}</small><strong>{frameStyle?.name || t('Natural', 'Natural')}</strong></span><span><small>{t('Ornamen', 'Ornaments')}</small><strong>{ornaments.length ? ornaments.map((item) => item.name).join(', ') : t('Tidak ada', 'None')}</strong></span><span><small>{t('Foto', 'Photo')}</small><strong>{t('Siap', 'Ready')}</strong></span></div>}


          {subscription && <fieldset className="review-lane" disabled={busy}><legend>{t('Jalur generate', 'Generation lane')}</legend>
            <label><input type="radio" name="ai-lane" checked={aiLane === 'standard'} onChange={() => onAiLane('standard')} />Standard · 50 AI Credit</label>
            <label><input type="radio" name="ai-lane" checked={aiLane === 'fast'} disabled={!subscription.plan.premium || !apiRoutes?.fast} onChange={() => onAiLane('fast')} />Fast · 100 AI Credit{!subscription.plan.premium ? t(' · perlu langganan', ' · subscription required') : !apiRoutes?.fast ? t(' · belum terhubung', ' · not connected') : ''}</label>
            {!apiRoutes?.[aiLane] && <p role="status">{t('Jalur yang dipilih belum terhubung. Tidak ada kredit yang dipotong.', 'The selected lane is not connected. No credits are deducted.')}</p>}
          </fieldset>}

          <div className="review-create">
            {mode !== 'CLASSIC' && <dl className="review-cost">
              <div><dt>{t('Biaya', 'Cost')}</dt><dd>{subscription ? `${cost} AI Credit` : t(`Min. ${cost} kredit`, `Min. ${cost} credits`)}</dd></div>
              <div><dt>{t('Saldo', 'Balance')}</dt><dd>{aiRemaining == null ? t('Dikonfirmasi sebelum generate', 'Confirmed before generating') : `${aiRemaining} ${subscription ? 'AI Credit' : t('kredit', aiRemaining === 1 ? 'credit' : 'credits')}`}</dd></div>
            </dl>}
            {subscription && <p className="review-note">{t(`${cost} AI Credit per hasil berhasil · kualitas Low. Gagal tidak memotong kredit.`, `${cost} AI Credit per successful result · Low quality. Failed results are not charged.`)}</p>}
            {!subscription && mode !== 'CLASSIC' && <p className="review-note">{t('Minimal 10 kredit untuk mulai. Biaya memakai estimasi token dan dipotong setelah hasil berhasil; rincian lengkap dipakai bila tersedia.', 'At least 10 credits to start. The cost uses a token estimate and is deducted after a successful result; full details are used when available.')}</p>}
            {quotaExhausted && <>
              <p className="review-note is-warning" role="status">{authenticated ? t('Kredit belum cukup. Isi kredit untuk melanjutkan berkarya.', 'Not enough credits. Add credits to keep creating.') : subscription ? t('Masuk untuk membeli AI Credit atau memilih paket.', 'Sign in to buy AI Credit or choose a plan.') : t('Masuk untuk mendapat 50 kredit gratis setiap 14 hari.', 'Sign in to get 50 free credits every 14 days.')}</p>
              <button className="customer-outline-button" disabled={busy} onClick={onOpenAccount}>{authenticated ? t('Isi kredit', 'Add credits') : t('Masuk / Buat akun', 'Sign in / Create account')} <b aria-hidden="true">→</b></button>
            </>}
            <button className="customer-solid-button review-generate" disabled={busy || quotaExhausted || Boolean(subscription && !apiRoutes?.[aiLane])} onClick={onCreate}>
              {busy ? t('Memasuki dunia Anda…', 'Entering your world…') : mode !== 'CLASSIC' ? t('Buat dengan AI', 'Generate AI') : t('Buat foto', 'Create photo')} <b>→</b>
            </button>
          </div>
        </aside>
      </div>
    </section>
  )
}
