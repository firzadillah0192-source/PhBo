import { tr } from './i18n.js'

const PHOTO_RETRY_ERRORS = new Set([
  'BASIC_FACE_NOT_FOUND',
  'BASIC_MULTIPLE_FACES',
  'BASIC_LANDMARKS_UNAVAILABLE',
])

export function generationFailureAction(job) {
  if (job?.error_code === 'UPLOAD_NOT_FOUND' || job?.error_code === 'UPLOAD_EXPIRED') {
    return 'upload-again'
  }
  if (PHOTO_RETRY_ERRORS.has(job?.error_code)) return 'choose-photo'
  return 'retry'
}

export function generationFailureMessage(job, language = 'en') {
  const errorCode = job?.error_code
  const t = (id, en) => tr(id, en, language)
  if (errorCode === 'UPLOAD_NOT_FOUND') return t('Foto yang diunggah sudah tidak tersedia. Silakan unggah lagi.', 'The uploaded photo is no longer available. Please upload it again.')
  if (errorCode === 'UPLOAD_EXPIRED') return t('Foto yang diunggah sudah kedaluwarsa. Silakan unggah lagi.', 'The uploaded photo has expired. Please upload it again.')
  if (errorCode === 'BASIC_FACE_NOT_FOUND') {
    return t('Kami tidak menemukan satu wajah yang jelas. Pilih foto menghadap depan dengan cahaya baik dan wajah terlihat penuh.', 'We could not detect one clear face. Choose a well-lit, front-facing photo with the full face visible.')
  }
  if (errorCode === 'BASIC_MULTIPLE_FACES') {
    return t('Studio Basic hanya bisa memproses satu wajah. Pilih foto yang hanya berisi satu orang.', 'The Basic studio works with one visible face at a time. Choose a photo with only one person in it.')
  }
  if (errorCode === 'BASIC_LANDMARKS_UNAVAILABLE') {
    return t('Kami tidak bisa membaca wajah dengan jelas. Pilih potret tajam menghadap depan dengan wajah terlihat penuh.', 'We could not read the face clearly. Choose a sharp, front-facing portrait with the full face visible.')
  }
  if (errorCode === 'BASIC_TEMPLATE_METADATA_MISSING') {
    return t('Studio Basic ini sedang tidak tersedia. Silakan coba lagi nanti.', 'This Basic studio is temporarily unavailable. Please try again later.')
  }
  if (errorCode === 'BASIC_ENGINE_NOT_CONNECTED' || errorCode === 'BASIC_IDENTITY_PROVIDER_NOT_CONFIGURED') {
    return t('Studio Basic sedang tidak tersedia. Silakan coba lagi nanti.', 'The Basic studio is temporarily unavailable. Please try again later.')
  }
  if (job?.mode === 'BASIC') return t('Studio Basic belum bisa menyelesaikan potret ini. Kredit AI tidak terpakai.', 'The Basic studio could not finish this portrait. No AI credit was used.')
  return t('Kami belum bisa menyelesaikan gambar itu. Kredit AI yang ditahan sudah dikembalikan.', 'We could not finish that image. Your reserved AI credit was returned.')
}

export function generationFailureActionLabel(job, language = 'en') {
  const action = generationFailureAction(job)
  if (action === 'upload-again') return tr('Unggah lagi', 'Upload again', language)
  if (action === 'choose-photo') return tr('Pilih foto lain', 'Choose another photo', language)
  return tr('Coba lagi', 'Try again', language)
}
