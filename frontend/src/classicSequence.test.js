import test from 'node:test'
import assert from 'node:assert/strict'
import { CLASSIC_RETAKE_LIMIT, CLASSIC_REVIEW_SECONDS, runClassicCaptureSequence } from './classicSequence.js'
import { readCustomerFlow, updateCustomerFlow } from './customerSession.js'

function harness(extra = {}) {
  return { tick: async () => {}, capture: async (shot) => ({ shot }), upload: async (file) => file, pause: async () => {}, progress: () => {}, ...extra }
}

test('three retakes are shared across the entire Classic session, including the last photo', async () => {
  const actions = ['retake', 'next', 'retake', 'next', 'retake', 'next']
  const allowances = [], changes = [], uploaded = [], ticks = []
  const results = await runClassicCaptureSequence(3, harness({
    tick: async (count, shot) => ticks.push([shot, count]),
    review: async (file, shot, left) => { allowances.push(left); return actions.shift() },
    onRetake: (left) => changes.push(left),
    upload: async (file) => { uploaded.push(file.shot); return file },
  }))
  assert.deepEqual(allowances, [3, 2, 2, 1, 1, 0])
  assert.deepEqual(changes, [2, 1, 0])
  assert.deepEqual(uploaded, [0, 1, 2])
  assert.equal(results.length, 3)
  assert.equal(ticks.length, 18)
  assert.equal(CLASSIC_RETAKE_LIMIT, 3)
  assert.equal(CLASSIC_REVIEW_SECONDS, 10)
})

test('three retakes can be used on one shot; a fourth is rejected before upload', async () => {
  let captures = 0, uploads = 0
  await assert.rejects(runClassicCaptureSequence(4, harness({
    capture: async () => ++captures,
    review: async () => 'retake',
    upload: async () => ++uploads,
  })), /allowance exhausted/)
  assert.equal(captures, 4)
  assert.equal(uploads, 0)
})

test('only accepted photographs are uploaded in the required order for four-shot layouts', async () => {
  let captures = 0
  const decisions = ['retake', 'retake', 'next', 'next', 'next', 'next']
  const results = await runClassicCaptureSequence(4, harness({ capture: async () => ++captures, review: async () => decisions.shift() }))
  assert.deepEqual(results, [3, 4, 5, 6])
})

test('canceling during review does not upload or continue', async () => {
  let active = true, uploads = 0
  const result = await runClassicCaptureSequence(3, harness({
    active: () => active,
    review: async () => { active = false; return 'cancel' },
    upload: async () => ++uploads,
  }))
  assert.equal(result, null)
  assert.equal(uploads, 0)
})

test('saved accepted captures resume without resetting the retake allowance', async () => {
  const shots = [], allowances = []
  const result = await runClassicCaptureSequence(3, harness({
    initialUploads: [{ shot: 0 }], retakesRemaining: 0,
    capture: async (shot) => { shots.push(shot); return { shot } },
    review: async (file, shot, left) => { allowances.push(left); return 'next' },
  }))
  assert.deepEqual(shots, [1, 2])
  assert.deepEqual(allowances, [0, 0])
  assert.equal(result.length, 3)
})

test('Classic session stores only accepted upload IDs and a validated retake allowance', () => {
  const values = new Map()
  const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }
  updateCustomerFlow({ mode: 'CLASSIC', classicCaptureLayoutId: 'layout-3', classicRetakesRemaining: 1, captureUploadIds: ['accepted-1'], stage: 'photo' }, storage)
  assert.equal(readCustomerFlow(storage).classicRetakesRemaining, 1)
  assert.deepEqual(readCustomerFlow(storage).captureUploadIds, ['accepted-1'])
  for (const invalid of [-1, 4, '3', 1.5]) {
    updateCustomerFlow({ classicRetakesRemaining: invalid }, storage)
    assert.equal(readCustomerFlow(storage).classicRetakesRemaining, undefined)
  }
})
