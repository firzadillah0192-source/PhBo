import { QRCodeSVG } from 'qrcode.react'
export function QRCode({ value, size = 192 }: { value: string; size?: number }) { return <QRCodeSVG value={value} size={size} marginSize={4} aria-label="Scan to open your photo" className="rounded-md bg-white" /> }
