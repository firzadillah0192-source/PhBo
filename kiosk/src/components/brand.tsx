import { useMemo } from 'react'
import { Camera } from 'lucide-react'
import { cn } from './ui'

export function Logo({ dark }: { dark?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={cn('flex h-7 w-7 items-center justify-center rounded-sm text-white', dark ? 'bg-stage-primary' : 'bg-primary')}>
        <Camera size={16} aria-hidden />
      </span>
      <span className={cn('font-display text-lg font-bold', dark ? 'text-stage-text' : 'text-text')}>NXBooth</span>
    </span>
  )
}

/** Deterministic QR-looking grid (visual stand-in until the real QR component is wired). */
export function QrPlaceholder({ size = 192, dark }: { size?: number; dark?: boolean }) {
  const cells = useMemo(() => {
    const n = 25
    const out: boolean[] = []
    let x = 1234567
    for (let i = 0; i < n * n; i++) {
      x = (x * 1103515245 + 12345) & 0x7fffffff
      out.push(x % 3 === 0)
    }
    const finder = (r: number, c: number) => (r < 7 && c < 7) || (r < 7 && c > n - 8) || (r > n - 8 && c < 7)
    return out.map((v, i) => (finder(Math.floor(i / n), i % n) ? true : v))
  }, [])
  return (
    <div role="img" aria-label="QR code" className={cn('rounded-md p-3', dark ? 'bg-white' : 'border border-border bg-white')} style={{ width: size, height: size }}>
      <div className="grid h-full w-full" style={{ gridTemplateColumns: 'repeat(25, 1fr)' }}>
        {cells.map((on, i) => (
          <span key={i} className={on ? 'bg-text' : 'bg-white'} />
        ))}
      </div>
    </div>
  )
}
