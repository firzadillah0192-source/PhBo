import test from 'node:test'
import assert from 'node:assert/strict'
import { cameraFailureMessage, requestPortraitCamera, waitForCameraPreview } from './cameraAccess.js'

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

test('camera prefers the user-facing lens without forcing a portrait crop or requesting audio', async () => {
  const stream = {}
  let constraints
  assert.equal(await requestPortraitCamera({ getUserMedia: async (value) => { constraints = value; return stream } }, true), stream)
  assert.deepEqual(constraints, { video: { facingMode: { ideal: 'user' } }, audio: false })
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

function previewVideo(play) {
  return Object.assign(new EventTarget(), { play, videoWidth: 0, videoHeight: 0, readyState: 0 })
}

test('preview waits for actual image data after playback starts', async () => {
  const video = previewVideo(async () => {})
  const pending = waitForCameraPreview(video, () => true, 1000)
  await Promise.resolve()
  Object.assign(video, { videoWidth: 1280, videoHeight: 720, readyState: 2 })
  video.dispatchEvent(new Event('loadeddata'))
  await pending
})

test('preview deadline also covers a playback promise that never settles', async () => {
  const video = previewVideo(() => new Promise(() => {}))
  await assert.rejects(waitForCameraPreview(video, () => true, 25), { name: 'CameraFrameTimeout' })
})

test('playback rejection and navigation cancel preview waits', async () => {
  const error = Object.assign(new Error('Playback blocked'), { name: 'NotAllowedError' })
  await assert.rejects(waitForCameraPreview(previewVideo(async () => { throw error }), () => true, 1000), { name: 'NotAllowedError' })
  await assert.rejects(waitForCameraPreview(previewVideo(async () => {}), () => false, 1000), { name: 'CameraPreviewCancelled' })
})
