export const DEFAULT_USD_TO_IDR = 18000 // Editable planning assumption, not a live exchange rate.

export function rupiahFromUsd(value, rate) {
  if (value == null || !Number.isFinite(value) || !Number.isFinite(rate) || rate <= 0) return 'Tidak tersedia'
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 2 }).format(value * rate)
}
