import test from 'node:test'
import assert from 'node:assert/strict'
import { cameraFailureMessage, requestPortraitCamera } from './cameraAccess.js'

test('camera errors provide actionable permission, device and browser guidance', () => {
  assert.match(cameraFailureMessage({ name: 'NotAllowedError' }), /site settings/)
  assert.match(cameraFailureMessage({ name: 'SecurityError' }), /permission/)
  assert.match(cameraFailureMessage({ name: 'NotFoundError' }), /No camera/)
  assert.match(cameraFailureMessage({ name: 'NotReadableError' }), /Close other apps/)
  assert.match(cameraFailureMessage({ name: 'TrackStartError' }), /Close other apps/)
  assert.match(cameraFailureMessage({ name: 'OverconstrainedError' }), /settings/)
  assert.match(cameraFailureMessage({ name: 'CameraUnsupported' }), /Safari or Chrome/)
  assert.match(cameraFailureMessage({ name: 'CameraInsecure' }), /HTTPS/)
  assert.match(cameraFailureMessage(new Error()), /upload a photo/)
})

test('camera uses its available dimensions without forcing a portrait crop or requesting audio', async () => {
  const stream = {}
  let constraints
  assert.equal(await requestPortraitCamera({ getUserMedia: async (value) => { constraints = value; return stream } }, true), stream)
  assert.deepEqual(constraints, { video: { facingMode: 'user' }, audio: false })
})

test('unsupported constraints retry once with the available camera', async () => {
  const calls = []
  const stream = {}
  const devices = { getUserMedia: async (value) => {
    calls.push(value)
    if (calls.length === 1) throw Object.assign(new Error(), { name: 'OverconstrainedError' })
    return stream
  } }
  assert.equal(await requestPortraitCamera(devices, true), stream)
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[1], { video: true, audio: false })
})

test('permission denial and hardware errors are not repeatedly requested', async () => {
  for (const name of ['NotAllowedError', 'SecurityError', 'NotReadableError', 'NotFoundError']) {
    let calls = 0
    await assert.rejects(requestPortraitCamera({ getUserMedia: async () => { calls++; throw Object.assign(new Error(), { name }) } }, true), { name })
    assert.equal(calls, 1)
  }
})

test('unsupported browser and insecure origins fail before requesting camera', async () => {
  await assert.rejects(requestPortraitCamera({}, true), { name: 'CameraUnsupported' })
  let calls = 0
  await assert.rejects(requestPortraitCamera({ getUserMedia: async () => { calls++ } }, false), { name: 'CameraInsecure' })
  assert.equal(calls, 0)
})
