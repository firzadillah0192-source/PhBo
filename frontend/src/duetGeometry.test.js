import test from 'node:test'
import assert from 'node:assert/strict'
import { cameraCrop,captureSize,companionRect } from './duetGeometry.js'
import { parseCustomerRoute } from './customerRoute.js'
test('NXDuet is a separate route with no Classic mode',()=>{const route=parseCustomerRoute('/nxduet/');assert.equal(route.name,'nxduet');assert.equal(route.mode,null);assert.equal(route.kiosk,false)})
test('capture canvas follows the Classic slot aspect',()=>{assert.deepEqual(captureSize({slot_width:548,slot_height:466}),{width:1200,height:1020});assert.deepEqual(captureSize(null),{width:1200,height:1020})})
test('camera crop fills 4:3 consistently from landscape and portrait sensors',()=>{assert.deepEqual(cameraCrop(1920,1080),{x:240,y:0,width:1440,height:1080});assert.deepEqual(cameraCrop(900,1200),{x:0,y:262.5,width:900,height:675})})
test('companion stays inside half the slot, always on the left and standing on the bottom edge',()=>{assert.deepEqual(companionRect(1200,900,512,512,{side:'left',scale:.9}),{width:540,height:540,left:0,top:360});assert.deepEqual(companionRect(1200,900,512,1024,{side:'left',scale:.8}),{width:360,height:720,left:0,top:180});assert.deepEqual(companionRect(548,466,400,700,{side:'left',scale:1}),{width:266,height:466,left:0,top:0});const sizes=[.4,.6,.8,.9,1].map(scale=>companionRect(1200,900,512,512,{side:'left',scale}).width);assert.ok(sizes.every((size,i)=>i===0||size>sizes[i-1]))})
