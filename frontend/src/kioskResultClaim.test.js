import test from 'node:test'
import assert from 'node:assert/strict'
import {prepareKioskResultClaim,validateResultClaim} from './kioskResultClaim.js'
const token='a'.repeat(43),url=`https://nxbooth.gennexbyte.com/r/${token}`,claim={claim_url:url,qr_payload:url,expires_at:new Date(Date.now()+86400000).toISOString()}
test('claim uses existing token and concurrent mounts create a single QR link',async()=>{
 let calls=0,saved
 const session={getItem:()=>token,setItem:(key,value)=>{saved={key,value}}},request=async(id,reuse,refresh)=>{calls++;assert.equal(id,'result-one');assert.equal(reuse,token);assert.equal(refresh,false);return claim}
 const [a,b]=await Promise.all([prepareKioskResultClaim('result-one',{request,session}),prepareKioskResultClaim('result-one',{request,session})])
 assert.equal(calls,1);assert.equal(a,b);assert.equal(saved.value,token);assert.equal(saved.key,'photobooth:result-claim:result-one')
})
test('explicit refresh replaces old link, including when browser storage is unavailable',async()=>{
 let supplied
 const session={getItem(){throw new Error('blocked')},setItem(){throw new Error('blocked')}}
 await prepareKioskResultClaim('result-two',{session,refresh:true,request:async(...args)=>{supplied=args;return claim}})
 assert.deepEqual(supplied,['result-two',null,true])
})
test('failed claim request is retryable and cannot yield a placeholder QR',async()=>{
 let attempts=0
 const request=async()=>{if(++attempts===1)throw new Error('offline');return claim}
 await assert.rejects(prepareKioskResultClaim('result-three',{request,session:null}),/offline/)
 assert.deepEqual(await prepareKioskResultClaim('result-three',{request,session:null}),claim)
})
test('QR accepts only valid public result links with matching payload and expiry',()=>{
 assert.equal(validateResultClaim(claim),token)
 for(const bad of [{...claim,claim_url:'javascript:alert(1)'},{...claim,claim_url:'https://nxbooth.gennexbyte.com/api/kiosk/web/results/123/image'},{...claim,qr_payload:'different'},{...claim,expires_at:'invalid'}])assert.throws(()=>validateResultClaim(bad))
})
