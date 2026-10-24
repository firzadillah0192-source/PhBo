// Visual progress for the processing screen. The backend reports only QUEUED/PROCESSING, not a
// percentage, so this is an estimate that eases toward a ceiling below 100: it never shows a
// finished image before the real job state says COMPLETED.
const QUEUED_CEILING = 12
const RUNNING_CEILING = 95

export function estimateProgress(state, elapsedMs, mode) {
  const seconds = Math.max(0, elapsedMs) / 1000
  if (state === 'QUEUED') return Math.round(QUEUED_CEILING * (1 - Math.exp(-seconds / 6)))
  const pace = mode === 'CLASSIC' ? 4 : 28
  return Math.round(QUEUED_CEILING + (RUNNING_CEILING - QUEUED_CEILING) * (1 - Math.exp(-seconds / pace)))
}

export function processingPhrases(mode, t) {
  return mode === 'CLASSIC'
    ? [t('Menyusun foto Anda…', 'Arranging your photos…'), t('Memasang bingkai…', 'Placing the frame…'), t('Merapikan detail…', 'Polishing the details…'), t('Satu langkah lagi…', 'One step to go…')]
    : [t('Membaca wajah Anda…', 'Reading your face…'), t('Mengatur cahaya studio…', 'Setting the studio light…'), t('Membentuk ulang wajah…', 'Reshaping the face…'), t('Menata rambut…', 'Styling the hair…'), t('Menyatukan detail…', 'Bringing the details together…'), t('Satu langkah lagi…', 'One step to go…')]
}
