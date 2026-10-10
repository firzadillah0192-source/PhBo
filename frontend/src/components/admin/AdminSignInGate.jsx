import React, { useEffect, useState } from 'react'
import { getAccountMe, loginAdmin, signInWithGoogle } from '../../api.js'
import GoogleSignInButton from '../customer/GoogleSignInButton.jsx'

export default function AdminSignInGate({ onSignedIn }) {
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[show,setShow]=useState(false)
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[account,setAccount]=useState(null)
 useEffect(()=>{let active=true;getAccountMe().then(value=>{if(active&&value.authenticated)setAccount(value)}).catch(()=>{});return()=>{active=false}},[])
 const signIn=async(action)=>{setBusy(true);setError('');try{await action();setPassword('');await onSignedIn()}catch(e){setError(e.errorCode==='ADMIN_FORBIDDEN'?'This account does not have admin access. Ask a superadmin to add your account.':e.message||'Could not sign in. Please try again.')}finally{setBusy(false)}}
 return <div className="app admin-app admin-retro admin-locked"><main className="admin-gate admin-card">
  <p className="admin-eyebrow">NXBooth / Operations</p><a className="admin-back-link" href="/">← Back to NXBooth</a>
  <h1>Your studio.<br/>Behind the scenes.</h1><p className="admin-muted">Sign in with your NXBooth account. Only accounts with admin access can enter.</p>
  {error&&<div className="admin-error" role="alert">{error}</div>}
  {account&&<div className="admin-account-continue"><p>Signed in as <strong>{account.email}</strong></p><button disabled={busy} type="button" onClick={()=>signIn(()=>loginAdmin())}>Continue to admin</button></div>}
  <GoogleSignInButton text="signin_with" disabled={busy} onCredential={credential=>signIn(async()=>{await signInWithGoogle(credential);await loginAdmin()})}/>
  <div className="admin-signin-divider"><span>or use email</span></div>
  <form onSubmit={event=>{event.preventDefault();signIn(()=>loginAdmin(email,password))}} aria-busy={busy}>
   <label className="admin-field"><span>Email</span><input type="email" autoComplete="username" required maxLength={320} value={email} onChange={event=>setEmail(event.target.value)} disabled={busy}/></label>
   <label className="admin-field"><span>Password</span><div className="admin-password-field"><input aria-label="Password" type={show?'text':'password'} autoComplete="current-password" required maxLength={512} value={password} onChange={event=>setPassword(event.target.value)} disabled={busy}/><button type="button" aria-label={show?'Hide password':'Show password'} aria-pressed={show} disabled={busy} onClick={()=>setShow(!show)}>{show?'Hide':'Show'}</button></div></label>
   <button className="primary" disabled={busy} type="submit">{busy?'Signing in…':'Sign in to admin'}</button>
  </form>
 </main></div>
}
