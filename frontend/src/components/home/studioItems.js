import { experiencePreview, templatePreview } from '../customer/experienceCatalog.js'

export function createStudioItems(templates = [], experiences = []) {
  const basic = templates.map((item) => ({
    id: `basic-${item.id}`,
    sourceId: item.id,
    mode: 'BASIC',
    name: item.name,
    image: templatePreview(item),
  }))
  const advanced = experiences.map((item) => ({
    id: `advanced-${item.id}`,
    sourceId: item.id,
    mode: 'ADVANCED',
    name: item.name,
    image: experiencePreview(item),
  }))
  return [...advanced, ...basic].map((item, index) => ({ ...item, panelId: `${item.id}-${index}` }))
}
