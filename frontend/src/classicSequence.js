export const CLASSIC_RETAKE_LIMIT = 3
export const CLASSIC_REVIEW_SECONDS = 10

export async function runClassicCaptureSequence(shotCount, { tick, capture, upload, pause, progress, active = () => true, review = async () => 'next', retakesRemaining = CLASSIC_RETAKE_LIMIT, onRetake = () => {}, initialUploads = [] }) {
  if (!Number.isInteger(shotCount) || shotCount < 1) throw new Error('Invalid Classic shot count')
  if (!Number.isInteger(retakesRemaining) || retakesRemaining < 0 || retakesRemaining > CLASSIC_RETAKE_LIMIT) throw new Error('Invalid Classic retake allowance')
  if (!Array.isArray(initialUploads) || initialUploads.length > shotCount) throw new Error('Invalid Classic saved captures')
  const uploads = [...initialUploads]
  for (let shot = uploads.length; shot < shotCount; shot += 1) {
    let photo
    while (true) {
      for (let count = 3; count >= 1; count -= 1) {
        if (!active()) return null
        await tick(count, shot)
      }
      if (!active()) return null
      photo = await capture(shot)
      if (!active()) return null
      const decision = await review(photo, shot, retakesRemaining)
      if (!active()) return null
      if (decision === 'next') break
      if (decision !== 'retake') throw new Error('Invalid Classic review decision')
      if (retakesRemaining === 0) throw new Error('Classic retake allowance exhausted')
      retakesRemaining -= 1
      onRetake(retakesRemaining)
    }
    if (!active()) return null
    const uploaded = await upload(photo)
    if (!active()) return null
    uploads.push(uploaded)
    progress(uploads.length, shotCount, uploads)
    if (shot + 1 < shotCount) await pause()
  }
  return uploads
}
