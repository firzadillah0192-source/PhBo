import test from 'node:test'
import assert from 'node:assert/strict'
import {openKioskCamera,stopCamera} from './kioskCamera.js'
const device=(id,label)=>({kind:'videoinput',deviceId:id,label})
function stream(id,label){const track={label,stopped:false,stop(){this.stopped=true},getSettings:()=>({deviceId:id})};return {track,getTracks:()=>[track],getVideoTracks:()=>[track]}}
test('Canon browser camera is preferred and initial camera is released',async()=>{
 const defaultStream=stream('webcam','Integrated'),canonStream=stream('canon','Canon EOS Webcam'),requests=[]
 const active=await openKioskCamera({enumerateDevices:async()=>[device('webcam','Integrated'),device('canon','Canon EOS Webcam')],getUserMedia:async constraints=>{requests.push(constraints);return constraints.video.deviceId?canonStream:defaultStream}})
 assert.equal(active.stream,canonStream);assert.equal(active.source,'Canon');assert.equal(defaultStream.track.stopped,true);assert.equal(requests[1].video.deviceId.exact,'canon');stopCamera(active.stream);assert.equal(canonStream.track.stopped,true)
})
test('missing Canon uses device camera without another prompt',async()=>{
 const webcam=stream('webcam','Integrated');let calls=0
 const active=await openKioskCamera({enumerateDevices:async()=>[device('webcam','Integrated')],getUserMedia:async()=>{calls++;return webcam}})
 assert.equal(active.source,'Kamera perangkat');assert.equal(calls,1)
})
test('unavailable Canon falls back to webcam after releasing initial stream',async()=>{
 const first=stream('webcam','Integrated'),fallback=stream('webcam','Integrated')
 const active=await openKioskCamera({enumerateDevices:async()=>[device('canon','Canon'),device('webcam','Integrated')],getUserMedia:async c=>{if(!c.video.deviceId)return first;if(c.video.deviceId.exact==='canon')throw Object.assign(new Error('busy'),{name:'NotReadableError'});return fallback}})
 assert.equal(active.stream,fallback);assert.equal(active.source,'Kamera perangkat');assert.equal(first.track.stopped,true)
})
test('permission denial is returned without retrying camera access',async()=>{
 let calls=0;const error=Object.assign(new Error('denied'),{name:'NotAllowedError'})
 await assert.rejects(openKioskCamera({getUserMedia:async()=>{calls++;throw error}}),e=>e===error);assert.equal(calls,1)
})
test('failed default camera tries an enumerated device',async()=>{
 const webcam=stream('device','USB webcam')
 const active=await openKioskCamera({enumerateDevices:async()=>[device('device','USB webcam')],getUserMedia:async c=>{if(!c.video.deviceId)throw Object.assign(new Error('busy'),{name:'NotReadableError'});return webcam}})
 assert.equal(active.stream,webcam)
})
test('selected webcam disables browser crop and resets supported zoom to minimum',async()=>{
 const webcam=stream('webcam','Integrated'),applied=[]
 webcam.track.getCapabilities=()=>({resizeMode:['none','crop-and-scale'],zoom:{min:1,max:4}})
 webcam.track.applyConstraints=async c=>applied.push(c)
 const active=await openKioskCamera({enumerateDevices:async()=>[device('webcam','Integrated')],getUserMedia:async c=>{assert.deepEqual(c.video.resizeMode,{ideal:'none'});return webcam}})
 assert.equal(active.stream,webcam);assert.deepEqual(applied,[{resizeMode:{exact:'none'},advanced:[{zoom:1}]}])
})
test('unsupported or rejected camera normalization does not discard usable stream',async()=>{
 const webcam=stream('webcam','Integrated')
 webcam.track.getCapabilities=()=>({resizeMode:['none'],zoom:{min:1,max:4}})
 webcam.track.applyConstraints=async()=>{throw new Error('driver rejected zoom')}
 const active=await openKioskCamera({enumerateDevices:async()=>[],getUserMedia:async()=>webcam})
 assert.equal(active.stream,webcam);assert.equal(webcam.track.stopped,false)
})
