/** Mock data for the customer web + kiosk claim screens. Copy mirrors the Figma frames. */

export type Mode = 'classic' | 'basic' | 'advanced'

export const modes: Record<Mode, { name: string; blurb: string; price: string; free?: boolean }> = {
  classic: { name: 'Classic', blurb: 'Photo strip · 1–4 shots', price: 'Free', free: true },
  basic: { name: 'Basic', blurb: 'AI themed portrait', price: '1 credit' },
  advanced: { name: 'Advanced', blurb: 'AI art styles', price: '1 credit' },
}

export const howItWorks = [
  { title: 'Add photo', body: 'Take one now or upload from your gallery.' },
  { title: 'Pick a style', body: 'Choose a strip layout, template or AI art style.' },
  { title: 'Download & share', body: 'Save it, print it, or share with a QR code.' },
]

export type Template = { id: string; name: string; blurb: string; seed: number; available: boolean }
export const templates: Template[] = [
  { id: 'garden-party', name: 'Garden Party', blurb: 'Soft florals, golden hour', seed: 0, available: true },
  { id: 'neon-arcade', name: 'Neon Arcade', blurb: 'Glowing 80s city lights', seed: 7, available: true },
  { id: 'vintage-studio', name: 'Vintage Studio', blurb: 'Warm film portrait', seed: 3, available: true },
  { id: 'winter-gala', name: 'Winter Gala', blurb: 'Snow and silver bokeh', seed: 5, available: true },
  { id: 'beach-sunset', name: 'Beach Sunset', blurb: 'Tropical evening glow', seed: 8, available: true },
  { id: 'royal-portrait', name: 'Royal Portrait', blurb: 'Unavailable', seed: 2, available: false },
]

export const styleCategories = ['All', 'Sci-Fi', 'Fantasy', 'Art', 'Vintage', 'Festive'] as const

export type ArtStyle = { id: string; name: string; blurb: string; category: string; seed: number; available: boolean }
export const artStyles: ArtStyle[] = [
  { id: 'space-commander', name: 'Space Commander', blurb: 'Cinematic sci-fi hero', category: 'Sci-Fi', seed: 9, available: true },
  { id: 'watercolor', name: 'Watercolor Portrait', blurb: 'Loose painted washes', category: 'Art', seed: 6, available: true },
  { id: 'enchanted-forest', name: 'Enchanted Forest', blurb: 'Glowing storybook light', category: 'Fantasy', seed: 1, available: true },
  { id: 'noir-detective', name: 'Noir Detective', blurb: 'Moody black and white', category: 'Vintage', seed: 4, available: true },
  { id: 'neon-samurai', name: 'Neon Samurai', blurb: 'Rain-soaked cyber alley', category: 'Sci-Fi', seed: 7, available: true },
  { id: 'pop-art', name: 'Pop Art Icon', blurb: 'Bold halftone colour', category: 'Art', seed: 3, available: true },
  { id: 'royal-court', name: 'Royal Court', blurb: 'Baroque oil portrait', category: 'Vintage', seed: 0, available: true },
  { id: 'ice-kingdom', name: 'Ice Kingdom', blurb: 'Unavailable', category: 'Fantasy', seed: 5, available: false },
]

export const frameStyles = [
  { id: 'natural', name: 'Natural', blurb: 'No frame, full-bleed photo', available: true },
  { id: 'polaroid', name: 'Polaroid', blurb: 'White border with caption space', available: true },
  { id: 'neon', name: 'Neon glow', blurb: 'Not available with this style', available: false },
]

export const ornaments = ['Confetti', 'Stars', 'Balloons', 'Sparkle', 'Hearts']

export type ClassicLayout = { id: string; name: string; shots: number; tag: string; seed: number }
export const classicLayouts: ClassicLayout[] = [
  { id: 'retro-film', name: 'Retro Film Strip', shots: 4, tag: 'Retro', seed: 4 },
  { id: 'sepia', name: 'Sepia Booth', shots: 3, tag: 'Classic', seed: 3 },
  { id: 'confetti-pop', name: 'Confetti Pop', shots: 2, tag: 'Party', seed: 1 },
  { id: 'midnight-disco', name: 'Midnight Disco', shots: 3, tag: 'Classic', seed: 8 },
]

export type CreationStatus = 'completed' | 'processing' | 'failed' | 'expired'
export type Creation = { id: string; name: string; mode: Mode; status: CreationStatus; when: string; note?: string; seed: number }
export const creations: Creation[] = [
  { id: 'c1', name: 'Garden Party', mode: 'basic', status: 'completed', when: 'Today, 17:42', seed: 0 },
  { id: 'c2', name: 'Space Commander', mode: 'advanced', status: 'processing', when: 'Today, 17:40', seed: 9 },
  { id: 'c3', name: 'Retro Film Strip', mode: 'classic', status: 'completed', when: 'Today, 16:05', seed: 4 },
  { id: 'c4', name: 'Noir Detective', mode: 'advanced', status: 'failed', when: 'Yesterday', note: 'Image expired', seed: 4 },
  { id: 'c5', name: 'Winter Gala', mode: 'basic', status: 'expired', when: '8 Oct', seed: 5 },
  { id: 'c6', name: 'Watercolor Portrait', mode: 'advanced', status: 'completed', when: '8 Oct', seed: 6 },
  { id: 'c7', name: 'Beach Sunset', mode: 'basic', status: 'completed', when: '7 Oct', seed: 8 },
  { id: 'c8', name: 'Confetti Pop', mode: 'classic', status: 'completed', when: '7 Oct', seed: 1 },
]

export const user = { name: 'Ayu Rahma', initials: 'AR', email: 'ayu.rahma@example.com', provider: 'Google' }

export const sessions = [
  { started: '10 Oct 2026', seen: 'Last seen just now', expires: 'Expires 9 Nov 2026', current: true },
  { started: '6 Oct 2026', seen: 'Last seen 2 days ago', expires: 'Expires 5 Nov 2026', current: false },
  { started: '28 Sep 2026', seen: 'Last seen 12 days ago', expires: 'Expires 28 Oct 2026', current: false },
]

export const plans = [
  { name: 'Free', body: '5 AI credits on sign-up · Classic unlimited', current: true },
  { name: 'Plus', body: '30 AI credits each month', current: false },
  { name: 'Pro', body: '100 AI credits each month', current: false },
]

/** Kiosk QR claim — creations left shown in the session banner. */
export const kioskSession = { endsIn: '23:41', creationsLeft: 3, allowed: ['classic', 'advanced'] as Mode[] }
