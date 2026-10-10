import test from 'node:test'
import assert from 'node:assert/strict'
test('Admin login uses account credentials or a verified cookie, and me always checks the server',async()=>{
 const original=globalThis.fetch,calls=[]
 globalThis.fetch=async(url,options)=>{calls.push({url,options});return{ok:true,text:async()=>JSON.stringify({authenticated:true,role:'superadmin'})}}
 try{
  const api=await import('./api.js?admin-signin-test')
  await api.loginAdmin('fixture@example.invalid','synthetic-password')
  assert.deepEqual(JSON.parse(calls[0].options.body),{email:'fixture@example.invalid',password:'synthetic-password'})
  assert.equal(calls[0].options.credentials,'include')
  await api.loginAdmin();assert.deepEqual(JSON.parse(calls[1].options.body),{})
  await api.getAdminMe();await api.getAdminMe();assert.equal(calls.length,4)
  assert.notEqual(calls[2].url,calls[3].url);assert.match(calls[2].url,/^\/api\/admin\/me\?/)
 }finally{globalThis.fetch=original}
})
