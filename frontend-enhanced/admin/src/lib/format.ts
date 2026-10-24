export const num = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('en'))

export const seconds = (ms: number | null | undefined) => (ms == null ? '—' : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`)

export const usd = (n: number | null) => (n == null ? '—' : `$${n.toFixed(4)}`)

export const bytes = (n: number) => `${(n / 1024 / 1024).toFixed(0)} MB`

export const money = (amount: number, currency: string) => (amount === 0 ? 'Free' : `${currency} ${amount.toLocaleString('en')}`)
