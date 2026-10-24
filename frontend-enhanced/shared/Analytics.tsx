import { useEffect } from 'react'
// @ts-ignore Use the production allowlist and token redaction policy.
import { initializeAnalytics, analyticsPageview } from '../../frontend/src/analytics.js'
export function Analytics({ pathname }: { pathname: string }) {
  useEffect(() => { initializeAnalytics() }, [])
  useEffect(() => { analyticsPageview() }, [pathname])
  return null
}
