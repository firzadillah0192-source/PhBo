import { experiencePreview, templatePreview } from '../customer/experienceCatalog.js'

const HERO_IDS = ['3d-avatar', '80s-flashback', 'anime', '8-bit-game', 'animal-infographic']

export function createStudioItems(templates = [], experiences = []) {
  const basic = templates[0] ? {
    id: `basic-${templates[0].id}`,
    sourceId: templates[0].id,
    mode: 'BASIC',
    name: templates[0].name,
    image: templatePreview(templates[0]),
  } : null
  const advanced = HERO_IDS.map((id) => experiences.find((item) => item.id === id)).filter(Boolean).map((item) => ({
    id: `advanced-${item.id}`, sourceId: item.id, mode: 'ADVANCED', name: item.name, image: experiencePreview(item),
  }))
  const fallback = advanced[0] || { id: 'campaign', sourceId: 'campaign', mode: 'ADVANCED', name: 'AI portrait', image: '/previews/3d-avatar.webp' }
  const template = basic || fallback
  return [advanced[0] || fallback, template, advanced[1] || fallback, advanced[2] || fallback, template, advanced[3] || fallback, advanced[4] || fallback, template]
    .map((item, index) => ({ ...item, panelId: `${item.id}-${index}` }))
}
