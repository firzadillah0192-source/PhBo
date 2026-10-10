import React from 'react'
import {PostHogProvider,PostHogErrorBoundary} from '@posthog/react'
import {initializeAnalytics} from './analytics.js'
const client=initializeAnalytics()
export default function AnalyticsProvider({children}){
 if(!client)return children
 return <PostHogProvider client={client}><PostHogErrorBoundary fallback={<main role="alert">Aplikasi mengalami masalah. Muat ulang halaman untuk mencoba lagi.</main>}>{children}</PostHogErrorBoundary></PostHogProvider>
}
