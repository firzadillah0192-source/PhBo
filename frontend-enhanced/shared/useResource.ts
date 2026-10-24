import { useCallback, useEffect, useRef, useState } from 'react'
import { message } from './api'

export function useResource<T = any>(load: () => Promise<T>, deps: any[] = [], poll = 0) {
  const loader = useRef(load); loader.current = load
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<{data: T | null; error: string; loading: boolean}>({ data: null, error: '', loading: true })
  const refresh = useCallback(() => setRevision(v => v + 1), [])
  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    setState({ data: null, error: '', loading: true })
    async function read() {
      try {
        const data = await loader.current()
        if (!stopped) setState({ data, error: '', loading: false })
      } catch (error) {
        if (!stopped) setState(s => ({ ...s, error: message(error), loading: false }))
      }
      if (!stopped && poll) timer = setTimeout(read, poll)
    }
    read()
    return () => { stopped = true; clearTimeout(timer) }
  }, [...deps, revision, poll])
  return { ...state, refresh }
}
