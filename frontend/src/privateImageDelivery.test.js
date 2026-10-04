import test from 'node:test'
import assert from 'node:assert/strict'
import { startPrivateImageDelivery } from './privateImageDelivery.js'

const flush = () => new Promise(resolve => setImmediate(resolve))

test('private delivery refreshes signed URLs before expiry and cancels on unmount',async () => {
  const urls = [],timers = [],cancelled = []
  let calls = 0
  const stop = startPrivateImageDelivery({ id: 'photo',src: '/api/photo',now: () => 100000,
    resolve: async id => { assert.equal(id,'photo'); calls++; return { url: `https://fixture/${calls}`,delivery: 'minio',expires_at: new Date(160000).toISOString() } },
    onURL: url => urls.push(url),schedule: (fn,ms) => { timers.push({ fn,ms }); return timers.length },cancel: id => cancelled.push(id) })
  await flush()
  assert.deepEqual(urls,['https://fixture/1']); assert.equal(timers[0].ms,45000)
  await timers[0].fn(); assert.equal(calls,2)
  stop(); assert.deepEqual(cancelled,[2])
})

test('private delivery falls back to API on resolver failure without retry loops',async () => {
  const urls = []
  const stop = startPrivateImageDelivery({ id: 'photo',src: '/api/photo',resolve: async () => { throw new Error('offline') },onURL: url => urls.push(url),schedule: () => assert.fail('must not schedule') })
  await flush(); assert.deepEqual(urls,['/api/photo']); stop()
})

test('private delivery ignores a late response after unmount',async () => {
  let complete
  const stop = startPrivateImageDelivery({ id: 'photo',src: '/api/photo',resolve: () => new Promise(resolve => { complete = resolve }),onURL: () => assert.fail('unmounted') })
  stop(); complete({ url: 'https://fixture/photo' }); await flush()
})

test('ordinary API images require no signed URL request',() => {
  startPrivateImageDelivery({ id: 'photo',src: '/api/photo',onURL: () => assert.fail('unnecessary update') })()
})
