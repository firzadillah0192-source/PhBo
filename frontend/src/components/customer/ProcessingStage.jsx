import React from 'react'
import { uploadPreviewUrl } from '../../api.js'
import { useT } from '../../i18n.js'

export default function ProcessingStage({ job, upload, previewUrl }) {
  const t = useT()
  const state = job?.state || 'QUEUED'
  const copy = state === 'QUEUED'
    ? [t('Menyiapkan potret Anda', 'Preparing your portrait'), t('Studio sedang mengatur cahaya dan membuka antrean untuk Anda.', 'The studio is setting the light and opening your place in the queue.')]
    : [t('Membangun dunia Anda', 'Building your world'), t('Suasana, karakter, dan detail fotografis sedang disatukan.', 'Atmosphere, character, and photographic detail are coming together.')]
  const classicCopy = state === 'QUEUED'
    ? [t('Menyiapkan strip foto Anda', 'Preparing your photo strip'), t('Foto-foto Anda siap disusun.', 'Your photographs are ready for composition.')]
    : [t('Menyusun strip foto Anda', 'Composing your photo strip'), t('Bingkai pilihan sedang dipasang di atas foto-foto Anda.', 'The selected frame is being placed over your photographs.')]
  const uploadId = upload?.upload_id || job?.upload_id
  const waiting = state === 'QUEUED'

  return (
    <section className="processing-stage customer-stage-enter" aria-live="polite">
      <div className="processing-portal">
        <span className="processing-orbit orbit-one" aria-hidden="true" />
        <span className="processing-orbit orbit-two" aria-hidden="true" />
        <figure>
          {(uploadId || previewUrl) && <img src={previewUrl || uploadPreviewUrl(uploadId)} alt={t('Potret Anda sedang disiapkan', 'Your portrait being prepared')} />}
          <i className="processing-light" />
          <span className="processing-depth" />
          <span className="processing-mist" />
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
