import {createResultClaim} from './kioskWebApi.js'
const pending=new Map()
function storage(){try{return globalThis.window?.sessionStorage}catch{return null}}
export function validateResultClaim(claim){
 const url=new URL(claim.claim_url)
 const token=url.pathname.match(/^\/r\/([A-Za-z0-9_-]{32,256})$/)?.[1]
 if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||!token||claim.qr_payload!==claim.claim_url||!Number.isFinite(Date.parse(claim.expires_at)))throw new Error('Link QR dari backend tidak valid.')
 return token
}
export function prepareKioskResultClaim(id,{refresh=false,request=createResultClaim,session=storage()}={}){
 const pendingKey=`${id}:${refresh}`,key=`photobooth:result-claim:${id}`
 if(pending.has(pendingKey))return pending.get(pendingKey)
 let token=null
 try{token=session?.getItem(key)}catch{}
 const operation=Promise.resolve().then(()=>request(id,refresh?null:token,refresh)).then(claim=>{
  const nextToken=validateResultClaim(claim)
  try{session?.setItem(key,nextToken)}catch{}
  return claim
 }).finally(()=>pending.delete(pendingKey))
 pending.set(pendingKey,operation)
 return operation
}
