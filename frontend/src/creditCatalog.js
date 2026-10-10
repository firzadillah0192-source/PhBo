export const CREDIT_RUPIAH = 100
export const TOP_UP_OPTIONS = [
  { credits: 100, name: 'Bekal Saku' },
  { credits: 200, name: 'Bekal Santai' },
  { credits: 300, name: 'Bekal Eksplorasi' },
  { credits: 500, name: 'Bekal Petualangan' },
  { credits: 1000, name: 'Bekal Ekspedisi' },
]
export const MODE_NAMES = { CLASSIC: 'Photo Booth', BASIC: 'Scene Remix', ADVANCED: 'Creative Studio' }
export function topUpPrice(value) {
  if (!/^\d+$/.test(String(value))) return null
  const credits = Number(value)
  const price = credits * CREDIT_RUPIAH
  return credits > 0 && Number.isSafeInteger(credits) && Number.isSafeInteger(price) ? price : null
}
export function formatRupiah(value) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value)
}
