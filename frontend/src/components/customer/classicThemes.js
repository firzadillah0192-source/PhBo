export function classicThemes(layouts) {
  const themes = new Map()
  for (const layout of layouts) {
    const slug = layout.theme_slug || 'classic-originals'
    if (!themes.has(slug)) themes.set(slug, { slug, name: layout.theme_name || 'Classic Originals', count: 0 })
    themes.get(slug).count += 1
  }
  return [...themes.values()]
}

export function layoutsForTheme(layouts, theme) {
  return theme === 'all' ? layouts : layouts.filter((item) => (item.theme_slug || 'classic-originals') === theme)
}
