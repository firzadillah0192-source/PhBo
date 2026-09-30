import { experiencePreview, templatePreview } from '../customer/experienceCatalog.js'

function publicItem(item) {
  return item?.id && item.enabled !== false && (!item.status || item.status.toLowerCase() === 'published')
}

// Membership and image URLs come from the public APIs, never the prototype art set.
export function featuredPreviews(experiences = [], templates = [], limit = 6) {
  const worlds = experiences.filter((item) => publicItem(item) && experiencePreview(item)).map((item) => ({
    id: item.id, name: item.name, mode: 'ADVANCED', preview: experiencePreview(item), caption: item.category || 'Creative world',
  }))
  const studios = templates.filter((item) => publicItem(item) && item.basic_available !== false && templatePreview(item)).map((item) => ({
    id: item.id, name: item.name, mode: 'BASIC', preview: templatePreview(item), caption: 'Curated transformation',
  }))
  const ordered = [...worlds.slice(0, 2), ...studios.slice(0, 1), ...worlds.slice(2), ...studios.slice(1)]
  const seen = new Set()
  return ordered.filter((item) => {
    const key = `${item.mode}:${item.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, Math.min(6, Math.max(0, limit)))
}

export function modePreviews({ layouts = [], experiences = [], templates = [] }) {
  return {
    CLASSIC: layouts.find((item) => item.enabled !== false && item.preview_url)?.preview_url,
    BASIC: templates.find((item) => publicItem(item) && item.basic_available !== false && templatePreview(item))?.preview_url,
    ADVANCED: experiences.find((item) => publicItem(item) && experiencePreview(item))?.thumbnail,
  }
}
