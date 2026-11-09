export function parseCustomerRoute(pathname = '/', search = '') {
  const path = pathname.replace(/\/$/, '') || '/'
  const generation = path.match(/^\/generate\/([^/]+)$/)
  if (generation) return { name: 'generate', id: decodeURIComponent(generation[1]), mode: null }
  const result = path.match(/^\/result\/([^/]+)$/)
  if (result) return { name: 'result', id: decodeURIComponent(result[1]), mode: null }
  if (path === '/create') {
    const requestedMode = new URLSearchParams(search).get('mode')
    return {
      name: 'create',
      id: null,
      mode: requestedMode === 'basic' ? 'BASIC' : requestedMode === 'advanced' ? 'ADVANCED' : null,
    }
  }
  return { name: 'home', id: null, mode: null }
}

export function modeRoute(mode) {
  return `/create?mode=${String(mode).toLowerCase()}`
}

export function stageForRoute(route) {
  if (route.name === 'home') return 'home'
  if (route.name === 'create' && route.mode) return 'gallery'
  if (route.name === 'generate') return 'processing'
  if (route.name === 'result') return 'result'
  return 'home'
}
