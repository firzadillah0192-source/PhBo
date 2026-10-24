import React, { useEffect, useRef, useState } from 'react'
import { useT } from '../../i18n.js'
import { estimateProgress, processingPhrases } from '../../processingProgress.js'

export default function ProcessingStage({ job }) {
  const t = useT()
  const state = job?.state || 'QUEUED'
  // No source preview here: a moving estimate and rotating phrases show that work is under way.
  const since = useRef({ state, at: Date.now() })
  if (since.current.state !== state) since.current = { state, at: Date.now() }
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 400); return () => clearInterval(timer) }, [])
  const phrases = processingPhrases(job?.mode, t)
  const percent = estimateProgress(state, now - since.current.at, job?.mode)
  const phrase = percent >= 85 ? phrases.at(-1) : phrases[Math.floor((now - since.current.at) / 2800) % (phrases.length - 1)]
  const copy = state === 'QUEUED'
    ? [t('Menyiapkan potret Anda', 'Preparing your portrait'), t('Studio sedang mengatur cahaya dan membuka antrean untuk Anda.', 'The studio is setting the light and opening your place in the queue.')]
    : [t('Membangun dunia Anda', 'Building your world'), t('Suasana, karakter, dan detail fotografis sedang disatukan.', 'Atmosphere, character, and photographic detail are coming together.')]
  const classicCopy = state === 'QUEUED'
    ? [t('Menyiapkan strip foto Anda', 'Preparing your photo strip'), t('Foto-foto Anda siap disusun.', 'Your photographs are ready for composition.')]
    : [t('Menyusun strip foto Anda', 'Composing your photo strip'), t('Bingkai pilihan sedang dipasang di atas foto-foto Anda.', 'The selected frame is being placed over your photographs.')]
  const waiting = state === 'QUEUED'

  return (
    <section className="processing-stage customer-stage-enter" aria-live="polite">
      <div className="processing-portal">
        <span className="processing-orbit orbit-one" aria-hidden="true" />
        <span className="processing-orbit orbit-two" aria-hidden="true" />
        <figure className="processing-meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={t('Perkiraan kemajuan', 'Estimated progress')}>
          <svg viewBox="0 0 120 120" aria-hidden="true">
            <circle className="processing-meter-track" cx="60" cy="60" r="52" />
            <circle className="processing-meter-fill" cx="60" cy="60" r="52" pathLength="100" strokeDasharray="100" strokeDashoffset={100 - percent} />
          </svg>
          <strong>{percent}<small>%</small></strong>
          <span key={phrase} className="processing-meter-phrase">{phrase}</span>
          <i className="processing-light" />
        </figure>
      </div>
      <div className="processing-copy">
        <p className="customer-kicker">{job?.mode === 'CLASSIC' ? 'Photo Booth' : t('Foto Anda ada di studio', 'Your photo is in the studio')}</p>
        <h1>{(job?.mode === 'CLASSIC' ? classicCopy : copy)[0]}</h1>
        <p>{(job?.mode === 'CLASSIC' ? classicCopy : copy)[1]}</p>
        <span className="processing-pulse"><i />{waiting ? t('Menunggu studio', 'Waiting for the studio') : t('Sedang membuat gambar Anda', 'Creating your image')}</span>
        <ol className="processing-steps" aria-label={t('Tahap pembuatan', 'Generation steps')}>
          <li className="is-done">{t('Foto diterima', 'Photo received')}</li>
          <li className={waiting ? 'is-active' : 'is-done'}>{t('Antre di studio', 'Queued in the studio')}</li>
          <li className={waiting ? '' : 'is-active'}>{t('Membuat gambar', 'Creating the image')}</li>
          <li>{t('Hasil siap diunduh', 'Result ready to download')}</li>
        </ol>
        <small>{t('Tidak perlu membiarkan halaman ini terbuka. Alamat studio Anda sudah tersimpan.', 'No need to keep this page open. Your studio route is saved.')}</small>
      </div>
    </section>
  )
}
