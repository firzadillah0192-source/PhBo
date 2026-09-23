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

export const EXPERIENCE_GROUPS = ['Portraits', 'Fantasy', 'Playful', 'Retro', 'Design', 'Utility']

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
  if (item?.visual?.subtitle && item?.visual?.group) {
    return [item.visual.subtitle, item.visual.group]
  }
  const group = experienceGroup(item)
  const line = COPY[item.id] || (group === 'Fantasy' ? 'Beyond the ordinary'
    : group === 'Playful' ? 'A playful new form'
      : group === 'Portraits' ? 'Editorial portrait'
        : group === 'Retro' ? 'A different era'
          : 'Art-directed transformation')
  return [line, group]
}

function enrichExperience(item) {
  const [subtitle, group] = experienceCopy(item)
  return {
    ...item,
    visual: {
      ...(item.visual || {}),
      group,
      subtitle,
    },
  }
}

// The public API owns the catalog set. This function only enriches records it
// receives; it must never append local/prototype experiences to the result.
export function enrichPublicExperiences(apiExperiences = []) {
  return Array.isArray(apiExperiences) ? apiExperiences.map(enrichExperience) : []
}

export function experienceSections(apiExperiences = []) {
  const experiences = enrichPublicExperiences(apiExperiences)
  const byGroup = new Map()

  experiences.forEach((item) => {
    const [, group] = experienceCopy(item)
    if (!byGroup.has(group)) byGroup.set(group, [])
    byGroup.get(group).push(item)
  })

  const groups = [...EXPERIENCE_GROUPS.filter((group) => byGroup.has(group)), ...[...byGroup.keys()].filter((group) => !EXPERIENCE_GROUPS.includes(group))]
  return groups.map((group) => ({ group, items: byGroup.get(group) }))
}

export function reconcileSelectedExperienceId(currentId, apiExperiences = []) {
  const experiences = Array.isArray(apiExperiences) ? apiExperiences : []
  if (currentId && experiences.some((item) => item.id === currentId)) return currentId
  return experiences.length === 1 ? experiences[0].id : null
}

export function experiencePreview(item) {
  // A public thumbnail is the only marketing preview. Do not borrow another
  // experience's art when an Admin-managed preview is missing.
  return item?.thumbnail || null
}

export function templatePreview(item) {
  return item?.preview_url || null
}
