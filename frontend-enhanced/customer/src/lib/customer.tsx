import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { CustomerHeader } from '../components/customer'
import { customer as api, message, rows, type Row } from '../../../shared/api'
import type { Mode } from '../data/customer'
// @ts-ignore The small storage contract is tested directly in Node.
import { readDraft, saveDraft } from '../../../shared/draft.mjs'

const Ctx = createContext<any>(null)
export function CustomerProvider({ children }: { children: ReactNode }) {
  const [draft] = useState(() => readDraft())
  const [account, setAccount] = useState<Row | null>(null)
  const [usage, setUsage] = useState<Row | null>(null)
  const [catalog, setCatalog] = useState<Record<string, Row[]>>({ templates: [], artStyles: [], classicLayouts: [], frameStyles: [], ornaments: [] })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<Mode>(draft?.mode || 'basic')
  const [uploads, setUploads] = useState<Row[]>(draft?.uploads || [])
  const [templateId, setTemplateId] = useState(draft?.templateId || '')
  const [styleId, setStyleId] = useState(draft?.styleId || '')
  const [frameId, setFrameId] = useState(draft?.frameId || '')
  const [ornaments, setOrnaments] = useState<string[]>(draft?.ornaments || [])
  const [layoutId, setLayoutId] = useState(draft?.layoutId || '')
  const [eventName, setEventName] = useState(draft?.eventName || '')
  useEffect(() => { saveDraft({ mode, uploads, templateId, styleId, frameId, ornaments, layoutId, eventName }) }, [mode, uploads, templateId, styleId, frameId, ornaments, layoutId, eventName])
  const refreshAccount = useCallback(async () => {
    const me = await api.getAccountMe(); setAccount(me)
    setUsage(await api.getUsage())
  }, [])
  useEffect(() => {
    let stopped = false
    async function load() {
      try {
        await refreshAccount()
        const [t, e, l, f, o] = await Promise.all([api.getTemplates(), api.getExperiences(), api.getClassicLayouts(), api.getFrameStyles(), api.getOrnaments()])
        if (!stopped) setCatalog({ templates: rows(t, 'templates').filter(r => r.basic_available && r.enabled), artStyles: rows(e, 'experiences'), classicLayouts: rows(l), frameStyles: rows(f).filter(r => r.enabled), ornaments: rows(o).filter(r => r.enabled) })
      } catch (e) { if (!stopped) setError(message(e)) }
      finally { if (!stopped) setLoading(false) }
    }
    load(); return () => { stopped = true }
  }, [])
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') void refreshAccount().catch(() => {}) }
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh)
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [refreshAccount])
  const value = { account, usage, setUsage, credits: usage?.ai_remaining ?? 0, signedIn: !!account?.authenticated, refreshAccount, catalog, error, loading,
    mode, setMode: (next: Mode) => { setMode(next); setUploads([]) }, uploads, setUploads, templateId, setTemplateId, styleId, setStyleId, frameId, setFrameId,
    ornaments, setOrnaments, layoutId, setLayoutId: (id: string) => { setLayoutId(id); setUploads([]) }, eventName, setEventName }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
export function useCustomer() { const value = useContext(Ctx); if (!value) throw new Error('CustomerProvider is required'); return value }
export function CustomerLayout() {
  const { credits, signedIn } = useCustomer()
  return <div className="min-h-screen bg-bg"><CustomerHeader credits={credits} signedIn={signedIn} /><Outlet /></div>
}
export function MinimalLayout() { return <div className="min-h-screen bg-bg"><CustomerHeader centered /><Outlet /></div> }
export function CustomerRoot() { return <Outlet /> }
