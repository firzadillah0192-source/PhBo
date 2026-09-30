export const ACCOUNT_TABS = ['overview', 'plan', 'billing', 'creations', 'personalization', 'security', 'privacy']

export function accountTabRoute(tab = 'overview') {
  const safeTab = ACCOUNT_TABS.includes(tab) ? tab : 'overview'
  return safeTab === 'overview' ? '/account' : `/account?tab=${safeTab}`
}

function routeWithPrefix(path, kiosk) {
  return kiosk ? `/kiosk${path === '/' ? '' : path}` : path
}

export function kioskModeRoute(mode) {
  return routeWithPrefix(`/create?mode=${String(mode).toLowerCase()}`, true)
}

export function kioskGenerationRoute(jobId) {
  return routeWithPrefix(`/generate/${encodeURIComponent(jobId)}`, true)
}

export function kioskResultRoute(resultId) {
  return routeWithPrefix(`/result/${encodeURIComponent(resultId)}`, true)
}

export function parseCustomerRoute(pathname = '/', search = '') {
  const path = pathname.replace(/\/$/, '') || '/'
  if (path === '/r' || path.startsWith('/r/')) {
    const token = path.slice(3)
    return { name: 'claim', id: token ? decodeURIComponent(token) : null, mode: null, tab: null, kiosk: false }
  }

  const kiosk = path === '/kiosk' || path.startsWith('/kiosk/')
  const localPath = kiosk ? (path.slice('/kiosk'.length) || '/') : path
  const generation = localPath.match(/^\/generate\/([^/]+)$/)
  if (generation) return { name: 'generate', id: decodeURIComponent(generation[1]), mode: null, tab: null, kiosk }
  const result = localPath.match(/^\/result\/([^/]+)$/)
  if (result) return { name: 'result', id: decodeURIComponent(result[1]), mode: null, tab: null, kiosk }
  if (localPath === '/account' && !kiosk) {
    const requestedTab = new URLSearchParams(search).get('tab')
    return {
      name: 'account',
      id: null,
      mode: null,
      kiosk: false,
      tab: ACCOUNT_TABS.includes(requestedTab) ? requestedTab : 'overview',
    }
  }
  if (localPath === '/create') {
    const requestedMode = new URLSearchParams(search).get('mode')
    return {
      name: 'create',
      id: null,
      mode: requestedMode === 'classic' ? 'CLASSIC' : requestedMode === 'basic' ? 'BASIC' : requestedMode === 'advanced' ? 'ADVANCED' : null,
      tab: null,
      kiosk,
    }
  }
  return { name: 'home', id: null, mode: null, tab: null, kiosk }
}

export function modeRoute(mode) {
  return `/create?mode=${String(mode).toLowerCase()}`
}

export function stageForRoute(route) {
  if (route.name === 'home') return 'home'
  if (route.name === 'account') return 'account'
  if (route.name === 'claim') return 'claim'
  if (route.name === 'create' && route.mode) return 'gallery'
  if (route.name === 'generate') return 'processing'
  if (route.name === 'result') return 'result'
  return 'home'
}
