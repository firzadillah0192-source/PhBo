import { createContext, type ReactNode, useContext, useMemo, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { CustomerHeader } from '../components/customer'
import type { Mode } from '../data/customer'

type CustomerState = {
  credits: number
  setCredits: (n: number) => void
  signedIn: boolean
  setSignedIn: (v: boolean) => void
  mode: Mode
  setMode: (m: Mode) => void
  hasPhoto: boolean
  setHasPhoto: (v: boolean) => void
  classicPhotos: number
  setClassicPhotos: (n: number) => void
  templateId: string
  setTemplateId: (id: string) => void
  styleId: string
  setStyleId: (id: string) => void
  frameId: string
  setFrameId: (id: string) => void
  ornaments: string[]
  setOrnaments: (o: string[]) => void
  layoutId: string
  setLayoutId: (id: string) => void
}

const Ctx = createContext<CustomerState | null>(null)

export function CustomerProvider({ children }: { children: ReactNode }) {
  const [credits, setCredits] = useState(2)
  const [signedIn, setSignedIn] = useState(false)
  const [mode, setMode] = useState<Mode>('basic')
  const [hasPhoto, setHasPhoto] = useState(false)
  const [classicPhotos, setClassicPhotos] = useState(2)
  const [templateId, setTemplateId] = useState('garden-party')
  const [styleId, setStyleId] = useState('space-commander')
  const [frameId, setFrameId] = useState('natural')
  const [ornaments, setOrnaments] = useState<string[]>(['Confetti'])
  const [layoutId, setLayoutId] = useState('retro-film')
  const value = useMemo(
    () => ({
      credits, setCredits, signedIn, setSignedIn, mode, setMode, hasPhoto, setHasPhoto, classicPhotos, setClassicPhotos,
      templateId, setTemplateId, styleId, setStyleId, frameId, setFrameId, ornaments, setOrnaments, layoutId, setLayoutId,
    }),
    [credits, signedIn, mode, hasPhoto, classicPhotos, templateId, styleId, frameId, ornaments, layoutId],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useCustomer() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useCustomer must be used inside <CustomerProvider>')
  return v
}

/** Shared shell for every /app/* screen: header + routed page. */
export function CustomerLayout() {
  const { credits, signedIn } = useCustomer()
  return (
    <div className="min-h-screen bg-bg">
      <CustomerHeader credits={credits} signedIn={signedIn} />
      <Outlet />
    </div>
  )
}

/** Bare layout (no credits, minimal header) for auth screens. */
export function MinimalLayout() {
  return (
    <div className="min-h-screen bg-bg">
      <CustomerHeader centered />
      <Outlet />
    </div>
  )
}

/** Mounts the customer state once for every /app/* route. */
export function CustomerRoot() {
  return (
    <CustomerProvider>
      <Outlet />
    </CustomerProvider>
  )
}
