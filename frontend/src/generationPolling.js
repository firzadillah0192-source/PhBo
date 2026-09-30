/** Serial polling with cancellation: old sessions must never change a new flow. */
export function startGenerationPolling({ fetchStatus, onStatus, onError, interval = 1500, schedule = setTimeout, cancel = clearTimeout }) {
  let stopped = false
  let timer
  const poll = async () => {
    try {
      const status = await fetchStatus()
      if (stopped) return
      onStatus(status)
      if (status.state === 'COMPLETED' || status.state === 'FAILED') return
    } catch (error) {
      if (stopped) return
      onError(error)
      if ([401, 403, 404, 410].includes(error.status)) return
    }
    if (!stopped) timer = schedule(poll, interval)
  }
  poll()
  return () => { stopped = true; cancel(timer) }
}
