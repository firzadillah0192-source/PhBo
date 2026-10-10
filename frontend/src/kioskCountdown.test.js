import test from 'node:test'
import assert from 'node:assert/strict'
import {CAPTURE_SECONDS,REVIEW_SECONDS,RETAKES_PER_POSE,startKioskCountdown} from './kioskCountdown.js'
function clock(){let time=0,next=0;const tasks=new Map();return{now:()=>time,schedule:f=>{tasks.set(++next,f);return next},cancel:id=>tasks.delete(id),advance(ms){time+=ms;const callbacks=[...tasks.values()];tasks.clear();callbacks.forEach(f=>f())}}}
test('capture waits five seconds and runs exactly once even after timer delay',()=>{const c=clock(),ticks=[];let done=0;startKioskCountdown(CAPTURE_SECONDS,{...c,onTick:n=>ticks.push(n),onDone:()=>done++});assert.deepEqual(ticks,[5]);c.advance(4000);assert.equal(done,0);assert.equal(ticks.at(-1),1);c.advance(1000);c.advance(10000);assert.equal(done,1);assert.equal(ticks.at(-1),0)})
test('review waits ten seconds and cancellation prevents next or stale shutter',()=>{const c=clock();let done=0;const stop=startKioskCountdown(REVIEW_SECONDS,{...c,onTick:()=>{},onDone:()=>done++});c.advance(9000);assert.equal(done,0);stop();c.advance(5000);assert.equal(done,0);assert.equal(RETAKES_PER_POSE,3)})
test('delayed timer expires using elapsed time rather than counting callbacks',()=>{const c=clock();let done=0;startKioskCountdown(REVIEW_SECONDS,{...c,onTick:()=>{},onDone:()=>done++});c.advance(15000);assert.equal(done,1)})
