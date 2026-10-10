import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

// Keep only the foremost dialog interactive, including payment over top-up.
const layers = []
let originalStates = new Map()
let originalOverflow = ''
function syncLayers() {
  const active = layers.at(-1)
  for (const node of document.body.children) {
    if (!originalStates.has(node)) originalStates.set(node, node.inert)
    node.inert = node !== active
  }
}

export default function StudioModal({ title, onBack, onClose, children, wide = false, returnFocus }) {
  const dialog = useRef(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const previous = returnFocus?.current || document.activeElement
    const layer = dialog.current?.closest('.studio-popup-layer')
    if (!layers.length) originalOverflow = document.body.style.overflow
    layers.push(layer)
    syncLayers()
    document.body.style.overflow = 'hidden'
    const focusable = () => [...dialog.current.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(node => node.getClientRects().length)
    const target = dialog.current.querySelector('input[type="search"]') || focusable()[0]
    target?.focus()
    const keyboard = event => {
      if (layers.at(-1) !== layer) return
      if (event.key === 'Escape') { event.preventDefault(); close.current(); return }
      if (event.key !== 'Tab') return
      const nodes = focusable(), first = nodes[0], last = nodes.at(-1)
      if (!nodes.length) { event.preventDefault(); dialog.current.focus(); return }
      if (event.shiftKey && (document.activeElement === first || !dialog.current.contains(document.activeElement))) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.current.contains(document.activeElement))) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keyboard)
    return () => {
      document.removeEventListener('keydown', keyboard)
      layers.splice(layers.indexOf(layer), 1)
      if (layers.length) syncLayers()
      else {
        originalStates.forEach((inert, node) => { node.inert = inert })
        originalStates = new Map()
        document.body.style.overflow = originalOverflow
      }
      if (previous?.isConnected && !previous.closest('[inert]')) previous.focus({ preventScroll: true })
    }
  }, [])
  if (typeof document === 'undefined') return null
  return createPortal(<div className="studio-popup-layer" onClick={event => { if (event.target === event.currentTarget) onClose() }}><section ref={dialog} role="dialog" aria-modal="true" aria-label={title} tabIndex="-1" className={`studio-popup retro-app ${wide ? 'is-wide' : ''}`}><header className="studio-popup-nav"><button type="button" className="studio-popup-back" onClick={onBack || onClose}><span aria-hidden="true">←</span> Back</button><strong>{title}</strong><button type="button" className="studio-popup-close" onClick={onClose} aria-label="Tutup popup"><span aria-hidden="true">×</span></button></header><div className="studio-popup-body">{children}</div></section></div>, document.body)
}
