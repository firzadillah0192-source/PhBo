// Checkout URLs must come from a server-created checkout for the chosen amount.
export function checkoutDestination(response, origin) {
  if (typeof response?.checkout_url !== 'string' || !response.checkout_url.trim()) return null
  try {
    const url = new URL(response.checkout_url, origin)
    if (url.protocol !== 'https:' && !(url.origin === origin && url.protocol === 'http:')) return null
    if (url.username || url.password) return null
    return url.href
  } catch { return null }
}

export function checkoutUnavailable(error) {
  return error instanceof TypeError || [404, 502, 503, 504].includes(error?.status)
    || error?.errorCode === 'PAYMENT_GATEWAY_UNAVAILABLE'
}
