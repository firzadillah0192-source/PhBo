// Signed URLs stay in memory and refresh before expiry. Ownership is always
// checked by the application API; the ordinary private image URL is the fallback.
export function startPrivateImageDelivery({ id,src,resolve,onURL,schedule = setTimeout,cancel = clearTimeout,now = Date.now }) {
  if (!resolve) return () => {}
  let stopped = false,timer
  const load = async () => {
    try {
      const delivery = await resolve(id)
      if (stopped) return
      onURL(delivery?.url || src)
      const remaining = new Date(delivery?.expires_at).getTime()-now()
      if (delivery?.delivery === 'minio' && remaining>0) timer = schedule(load,Math.max(1000,remaining-Math.min(15000,remaining/2)))
    } catch { if (!stopped) onURL(src) }
  }
  load()
  return () => { stopped = true; cancel(timer) }
}
