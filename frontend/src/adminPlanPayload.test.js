import test from 'node:test'
import assert from 'node:assert/strict'
import {adminPlanPayload} from './adminPlanPayload.js'
test('Plan create and update payloads match Express strict writable fields',()=>{
 const form={id:'plan-id',code:'plan_code',name:'Plan',description:'',monthly_ai_credits:'20',billing_period:'month',price_amount:'',currency:'',is_active:true,created_at:'server timestamp',updated_at:'server timestamp'}
 const create=adminPlanPayload(form),edit=adminPlanPayload(form,true)
 assert.equal(create.id,'plan-id');assert.equal(create.code,'plan_code')
 assert.equal(create.monthly_ai_credits,20);assert.equal(create.price_amount,null);assert.equal(create.currency,null)
 assert.deepEqual(Object.keys(edit).sort(),['name','description','monthly_ai_credits','billing_period','price_amount','currency','is_active'].sort())
 assert.equal(create.created_at,undefined);assert.equal(create.updated_at,undefined)
 assert.equal(adminPlanPayload({...form,monthly_ai_credits:'0',price_amount:'0',currency:'IDR'}).price_amount,0)
})
