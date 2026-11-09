const COPY = {
  '3d-avatar': 'Studio character',
  '8-bit-game': 'Pixel world',
  '80s-flashback': 'Retro portrait',
  'animal-infographic': 'Wildlife story',
  anime: 'Illustrated portrait',
  'studio-headshot': 'Modern portrait',
  'nighttime-flash': 'After dark',
  underwater: 'Submerged dream',
  wanderlust: 'Faraway portrait',
  'mini-me': 'A smaller universe',
}

export function experienceGroup(item) {
  if (item.category) {
    const category = item.category.trim().toLowerCase()
    if (category === 'portrait') return 'Portraits'
    if (category === 'fantasy') return 'Fantasy'
    if (category === 'playful') return 'Playful'
    if (category === 'retro') return 'Retro'
    if (category === 'design') return 'Design'
    if (category === 'utility') return 'Utility'
    return item.category
  }
  const id = item.id || ''
  if (['3d-avatar', '80s-flashback', 'studio-headshot', 'nighttime-flash', 'anime'].includes(id)) return 'Featured'
  if (/portrait|headshot|lighting|makeup|hair|enhance|color/.test(id)) return 'Portraits'
  if (/underwater|wanderlust|landscape|interior|fantasy|tarot|statue|wallpaper/.test(id)) return 'Fantasy'
  if (/game|comic|chibi|sticker|caricature|bobble|figurine|disco|mini-me/.test(id)) return 'Playful'
  if (/80s|film|flash|polaroid|retro|drawing|sketch|scribble/.test(id)) return 'Retro'
  return 'Design'
}

export function experienceCopy(item) {
  const group = experienceGroup(item)
  const line = COPY[item.id] || (group === 'Fantasy' ? 'Beyond the ordinary'
    : group === 'Playful' ? 'A playful new form'
      : group === 'Portraits' ? 'Editorial portrait'
        : group === 'Retro' ? 'A different era'
          : 'Art-directed transformation')
  return [line, group]
}

export function experiencePreview(item) {
  // A public thumbnail is the only marketing preview. Do not borrow another
  // experience's art when an Admin-managed preview is missing.
  return item?.thumbnail || null
}

export function templatePreview(item) {
  return item?.preview_url || null
}

export const EXPERIENCE_GROUPS = ['Portraits', 'Fantasy', 'Playful', 'Retro', 'Design', 'Utility']
