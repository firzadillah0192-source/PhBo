import React, { useEffect, useRef, useState } from 'react'
const GROUPS = [
 ['Workspace', ['overview','users','credits','generations','provider-ops']],
 ['Studio catalog', ['classic-layouts','templates','experiences','advanced-presets']],
 ['Administration', ['subscriptions','admin-users','audit','settings']],
]
export default function AdminShell({ sections, section, onSection, onLock, onRefresh, children }) {
 const [open,setOpen]=useState(false)
 const toggle=useRef(null),sidebar=useRef(null),heading=useRef(null)
 const label=sections.find(([id])=>id===section)?.[1] || 'Overview'
 const close=()=>{setOpen(false);toggle.current?.focus()}
 useEffect(()=>{
  if(!open)return
  const overflow=document.body.style.overflow
  document.body.style.overflow='hidden'
  sidebar.current?.querySelector('button')?.focus()
  const key=event=>{
   if(event.key==='Escape'){event.preventDefault();close()}
   if(event.key==='Tab'){
    const focusable=[...sidebar.current.querySelectorAll('button,a[href]')].filter(el=>!el.disabled)
    const first=focusable[0],last=focusable.at(-1)
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
   }
  }
  const resize=()=>{if(innerWidth>900)setOpen(false)}
  window.addEventListener('keydown',key);window.addEventListener('resize',resize)
  return()=>{document.body.style.overflow=overflow;window.removeEventListener('keydown',key);window.removeEventListener('resize',resize)}
 },[open])
 const choose=id=>{onSection(id);setOpen(false);requestAnimationFrame(()=>heading.current?.focus())}
 return <div className="app admin-app admin-retro">
  <a className="admin-skip" href="#admin-content">Skip to admin content</a>
  <header className="admin-mobile-bar"><a href="/" aria-label="Back to NXBooth">NXBooth<span> / ADMIN</span></a><button ref={toggle} type="button" aria-label="Open admin navigation" aria-controls="admin-navigation" aria-expanded={open} onClick={()=>setOpen(true)}>Menu <span aria-hidden="true">☰</span></button></header>
  {open&&<button className="admin-menu-overlay" tabIndex={-1} aria-label="Close admin navigation" onClick={close}/>}
  <aside ref={sidebar} className={'admin-sidebar'+(open?' is-open':'')} role={open?'dialog':undefined} aria-modal={open?'true':undefined} aria-label="Admin workspace">
   <div className="admin-brand-row"><a href="/" className="admin-brand" aria-label="Back to NXBooth">NXBooth<span>Operations</span></a><button className="admin-menu-close" aria-label="Close navigation" type="button" onClick={close}>×</button></div>
   <div className="admin-console-stamp"><span>CONTROL ROOM</span><span>01 / STUDIO</span></div>
   <nav id="admin-navigation" aria-label="Admin sections">{GROUPS.filter(([,ids])=>ids.some(id=>sections.some(([key])=>key===id))).map(([group,ids])=><div className="admin-nav-group" key={group}><p>{group}</p>{ids.filter(id=>sections.some(([key])=>key===id)).map(id=>{const label=sections.find(([key])=>key===id)?.[1];return <button key={id} type="button" aria-label={label} aria-current={section===id?'page':undefined} className={section===id?'active':''} onClick={()=>choose(id)}>{label}</button>})}</div>)}</nav>
   <div className="admin-sidebar-bottom"><a href="/">← Back to NXBooth</a><button type="button" onClick={onLock}>Sign out <span aria-hidden="true">↗</span></button><small>PRIVATE WORKSPACE / NXBOOTH</small></div>
  </aside>
  <main id="admin-content" className="admin-shell" tabIndex={-1} inert={open?'':undefined}>
   <div className="admin-workspace-line"><span>NXBOOTH / OPERATIONS CONSOLE</span><span className="admin-session-status">Authenticated session</span></div>
   <header className="admin-topbar"><div><span className="admin-kicker">WORKSPACE / {label.toUpperCase()}</span><h1 ref={heading} tabIndex={-1}>{section==='overview'?'Your studio, at a glance.':label}</h1><p className="admin-topbar-copy">{section==='overview'?'Follow your people, creations, and studio activity.':'Manage this part of your studio from one place.'}</p></div><button type="button" onClick={onRefresh} className="admin-refresh">Refresh data <span aria-hidden="true">↻</span></button></header>
   <div className="admin-section-content">{children}</div>
   <footer className="admin-workspace-footer"><span>NXBOOTH / CONTROL ROOM</span><a href="/">Back to the studio ↗</a></footer>
  </main>
 </div>
}

