import test from 'node:test'
import assert from 'node:assert/strict'
import {selectionOptions,readKioskWebJob,saveKioskWebJob,clearKioskWebJob} from './kioskWebFlow.js'
test('Personalized kiosk frames require a valid event name and capture time',()=>{
 const selected={id:'classic-wedding-jawa-001',shot_count:3,requires_event_name:true},ids=['a','b','c']
 const date='2026-10-10T07:00:00.000Z'
 const options=selectionOptions('CLASSIC',selected,null,ids,{eventName:'  Pernikahan Sarah & Arif  ',capturedAt:date})
 assert.equal(options.eventName,'Pernikahan Sarah & Arif');assert.equal(options.capturedAt,date)
 for(const eventName of ['', 'A\nB', 'x'.repeat(81)])assert.throws(()=>selectionOptions('CLASSIC',selected,null,ids,{eventName,capturedAt:date}))
 assert.throws(()=>selectionOptions('CLASSIC',selected,null,ids,{eventName:'Event'}))
 assert.equal(selectionOptions('ADVANCED',{id:'world'},'natural',['a'],{eventName:'Private'}).eventName,undefined)
})
test('Classic follows actual shot count and distinct uploads; restore persists only identifiers',()=>{
 assert.deepEqual(selectionOptions('CLASSIC',{id:'frame',shot_count:2},null,['a','b']),{layoutId:'frame',captureUploadIds:['a','b'],frameStyleId:undefined,ornamentIds:[]})
 assert.throws(()=>selectionOptions('CLASSIC',{id:'frame',shot_count:2},null,['a','a']))
 assert.throws(()=>selectionOptions('CLASSIC',{id:'frame',shot_count:3},null,['a','b']))
 const map=new Map(),storage={getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)}
 saveKioskWebJob({jobId:'job1',mode:'CLASSIC',secret:'never',photo:'blob:never'},storage)
 assert.deepEqual(readKioskWebJob(storage),{jobId:'job1',mode:'CLASSIC'});assert.ok(![...map.values()][0].includes('never'));clearKioskWebJob(storage);assert.equal(readKioskWebJob(storage),null)
})
