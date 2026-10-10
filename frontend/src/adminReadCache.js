/** Per-tab memory cache. No credentials or admin data are persisted to storage. */
export function createReadCache(ttl = 30000, now = Date.now) {
  const entries = new Map()
  let version = 0
  return {
    clear() { version += 1; entries.clear() },
    read(key, fetcher) {
      const existing = entries.get(key)
      if (existing && (existing.pending || now() < existing.expires)) return existing.promise
      const generation = version
      const entry = { pending: true, expires: 0 }
      entry.promise = Promise.resolve().then(fetcher).then(value => {
        if (version === generation && entries.get(key) === entry) {
          entry.pending = false
          entry.expires = now() + ttl
        }
        return value
      }, error => {
        if (entries.get(key) === entry) entries.delete(key)
        throw error
      })
      entries.set(key, entry)
      return entry.promise
    },
  }
}
