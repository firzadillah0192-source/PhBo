export function selectionOptions(mode, selection, styleId, uploads, personalization = {}) {
  if (!selection?.id || !['CLASSIC', 'BASIC', 'ADVANCED'].includes(mode)) throw new Error('Choose a design first.')
  const count = mode === 'CLASSIC' ? selection.shot_count : 1
  const ids = uploads.map(item => item?.upload_id)
  if (!Number.isInteger(count) || count < 1 || count > 4 || ids.length !== count || ids.some(id => !id) || new Set(ids).size !== count) throw new Error('Add all the photos required by this design.')
  if (mode === 'ADVANCED' && !styleId) throw new Error('Choose a frame style.')
  const options = { layoutId: selection.id, captureUploadIds: ids, frameStyleId: styleId, ornamentIds: personalization.ornamentIds || [] }
  if (mode === 'CLASSIC' && selection.requires_event_name) {
    const name = personalization.eventName?.trim()
    if (!name || name.length > 80 || /[\p{Cc}\p{Cf}]/u.test(name)) throw new Error('Enter an event name of 1–80 characters.')
    if (!Number.isFinite(Date.parse(personalization.capturedAt))) throw new Error('Capture time is missing. Add your photos again.')
    options.eventName = name.normalize('NFC'); options.capturedAt = personalization.capturedAt
  }
  return options
}
export function jobDestination(job) {
  if (job.state !== 'COMPLETED' || !job.result_id) return null
  if (job.credit_charge && job.credit_charge.status !== 'PAID') return null
  return '/app/result/' + encodeURIComponent(job.result_id)
}
