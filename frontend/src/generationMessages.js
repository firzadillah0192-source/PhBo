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

export function generationFailureMessage(job) {
  const errorCode = job?.error_code
  if (errorCode === 'UPLOAD_NOT_FOUND') return 'The uploaded photo is no longer available. Please upload it again.'
  if (errorCode === 'UPLOAD_EXPIRED') return 'The uploaded photo has expired. Please upload it again.'
  if (errorCode === 'BASIC_FACE_NOT_FOUND') {
    return 'We could not detect one clear face. Choose a well-lit, front-facing photo with the full face visible.'
  }
  if (errorCode === 'BASIC_MULTIPLE_FACES') {
    return 'The Basic studio works with one visible face at a time. Choose a photo with only one person in it.'
  }
  if (errorCode === 'BASIC_LANDMARKS_UNAVAILABLE') {
    return 'We could not read the face clearly. Choose a sharp, front-facing portrait with the full face visible.'
  }
  if (errorCode === 'BASIC_TEMPLATE_METADATA_MISSING') {
    return 'This Basic studio is temporarily unavailable. Please try again later.'
  }
  if (errorCode === 'BASIC_ENGINE_NOT_CONNECTED' || errorCode === 'BASIC_IDENTITY_PROVIDER_NOT_CONFIGURED') {
    return 'The Basic studio is temporarily unavailable. Please try again later.'
  }
  if (job?.mode === 'BASIC') return 'The Basic studio could not finish this portrait. No AI credit was used.'
  return 'We could not finish that image. Your reserved AI credit was returned.'
}

export function generationFailureActionLabel(job) {
  const action = generationFailureAction(job)
  if (action === 'upload-again') return 'Upload again'
  if (action === 'choose-photo') return 'Choose another photo'
  return 'Try again'
}
