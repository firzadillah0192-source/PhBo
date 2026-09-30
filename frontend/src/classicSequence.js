export async function runClassicCaptureSequence(shotCount, { tick, capture, upload, pause, progress, active = () => true }) {
  if (!Number.isInteger(shotCount) || shotCount < 1) throw new Error('Invalid Classic shot count')
  const uploads = []
  for (let shot = 0; shot < shotCount; shot += 1) {
    for (let count = 3; count >= 1; count -= 1) {
      if (!active()) return null
      await tick(count, shot)
    }
    if (!active()) return null
    uploads.push(await upload(await capture(shot)))
    progress(uploads.length, shotCount)
    if (shot + 1 < shotCount) await pause()
  }
  return uploads
}
