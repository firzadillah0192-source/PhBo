import test from 'node:test'
import assert from 'node:assert/strict'
import { cameraCrop,companionRect } from './duetGeometry.js'
import { parseCustomerRoute } from './customerRoute.js'
test('NXDuet is a separate route with no Classic mode',()=>{const route=parseCustomerRoute('/nxduet/');assert.equal(route.name,'nxduet');assert.equal(route.mode,null);assert.equal(route.kiosk,false)})
test('camera crop fills 4:3 consistently from landscape and portrait sensors',()=>{assert.deepEqual(cameraCrop(1920,1080),{x:240,y:0,width:1440,height:1080});assert.deepEqual(cameraCrop(900,1200),{x:0,y:262.5,width:900,height:675})})
test('companion stays inside half the image and anchors to the selected edge',()=>{assert.deepEqual(companionRect(1200,900,512,512,{side:'right',scale:.9}),{width:540,height:540,left:660,top:360});assert.deepEqual(companionRect(1200,900,512,1024,{side:'left',scale:.8}),{width:360,height:720,left:0,top:180});const sizes=[.4,.6,.8,.9,1].map(scale=>companionRect(1200,900,512,512,{side:'right',scale}).width);assert.ok(sizes.every((size,i)=>i===0||size>sizes[i-1]))})
