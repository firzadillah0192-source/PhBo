import test from 'node:test'
import assert from 'node:assert/strict'
import { createReadCache } from './adminReadCache.js'

test('Admin cache deduplicates, separates filters and refreshes after expiry', async () => {
  let clock = 0
  let calls = 0
  const cache = createReadCache(30, () => clock)
  const fetcher = async () => ++calls
  assert.deepEqual(await Promise.all([cache.read('/jobs?a=1', fetcher), cache.read('/jobs?a=1', fetcher)]), [1, 1])
  assert.equal(await cache.read('/jobs?a=2', fetcher), 2)
  assert.equal(await cache.read('/jobs?a=1', fetcher), 1)
  clock = 31
  assert.equal(await cache.read('/jobs?a=1', fetcher), 3)
})

test('Invalidation prevents an old pending response from repopulating cache', async () => {
  const cache = createReadCache()
  let complete
  const old = cache.read('jobs', () => new Promise(resolve => { complete = resolve }))
  await Promise.resolve()
  cache.clear()
  assert.equal(await cache.read('jobs', async () => 'new'), 'new')
  complete('old')
  assert.equal(await old, 'old')
  assert.equal(await cache.read('jobs', async () => 'unexpected'), 'new')
})

test('Failures are not cached', async () => {
  const cache = createReadCache()
  await assert.rejects(cache.read('jobs', async () => { throw Error('offline') }))
  assert.equal(await cache.read('jobs', async () => 'online'), 'online')
})

test('API caches admin reads, invalidates mutations, and keeps auth and generation polling live', async () => {
  const original = globalThis.fetch
  const api = await import('./api.js?admin-cache-test')
  let calls = 0
  globalThis.fetch = async () => ({ ok: true, text: async () => JSON.stringify({ sequence: ++calls }) })
  try {
    assert.equal((await api.getAdminUsageGenerations()).sequence, 1)
    assert.equal((await api.getAdminUsageGenerations()).sequence, 1)
    await api.logoutAdmin()
    assert.equal((await api.getAdminUsageGenerations()).sequence, 3)
    await api.getAdminOverview(); await api.getAdminOverview()
    assert.equal(calls, 5)
    await api.getGeneration('job'); await api.getGeneration('job')
    assert.equal(calls, 7)
    api.clearAdminReadCache()
    assert.equal((await api.getAdminUsageGenerations()).sequence, 8)
  } finally { globalThis.fetch = original; api.clearAdminReadCache() }
})
