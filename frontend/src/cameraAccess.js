export function cameraFailureMessage(error) {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera permission is blocked. Allow camera access in your browser’s site settings, then try again. You can also upload a photo.'
    case 'NotFoundError':
      return 'No camera was found. Connect a camera or upload a photo.'
    case 'NotReadableError':
    case 'TrackStartError':
      return 'The camera could not start. Close other apps using the camera, then try again or upload a photo.'
    case 'OverconstrainedError':
      return 'This camera cannot use the requested settings. Try again or upload a photo.'
    case 'CameraUnsupported':
      return 'Live camera preview is unavailable in this browser. Open NXBooth in Safari or Chrome, or take or choose a photo below.'
    case 'CameraInsecure':
      return 'Camera access requires HTTPS. Open NXBooth using its secure address, or upload a photo.'
    default:
      return 'The camera could not start. Try again or upload a photo.'
  }
}

export async function requestPortraitCamera(mediaDevices = globalThis.navigator?.mediaDevices, secure = globalThis.isSecureContext) {
  if (secure === false) throw Object.assign(new Error('Secure context required'), { name: 'CameraInsecure' })
  if (!mediaDevices?.getUserMedia) throw Object.assign(new Error('Camera API unavailable'), { name: 'CameraUnsupported' })
  try {
    return await mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'user' } }, audio: false })
  } catch (error) {
    if (error?.name !== 'OverconstrainedError') throw error
    return mediaDevices.getUserMedia({ video: true, audio: false })
  }
}

export function waitForCameraPreview(video, isCurrent, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let settled = false
    let playbackStarted = false
    let pollTimer
    let timeoutTimer
    let frameRequest
    const events = ['loadeddata', 'canplay', 'playing', 'resize']
    const cleanup = () => {
      events.forEach((event) => video.removeEventListener(event, check))
      globalThis.clearInterval(pollTimer)
      globalThis.clearTimeout(timeoutTimer)
      if (frameRequest !== undefined && video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(frameRequest)
    }
    const finish = (error) => {
      if (settled) return
      settled = true
      cleanup()
      if (error) reject(error)
      else resolve()
    }
    const check = () => {
      if (!isCurrent()) {
        finish(Object.assign(new Error('Camera preview was cancelled'), { name: 'CameraPreviewCancelled' }))
      } else if (playbackStarted && video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= 2) {
        finish()
      }
    }
    events.forEach((event) => video.addEventListener(event, check))
    pollTimer = globalThis.setInterval(check, 100)
    timeoutTimer = globalThis.setTimeout(() => {
      finish(Object.assign(new Error('No camera frame arrived'), { name: 'CameraFrameTimeout' }))
    }, timeoutMs)
    if (video.requestVideoFrameCallback) {
      const onFrame = () => {
        check()
        if (!settled) frameRequest = video.requestVideoFrameCallback(onFrame)
      }
      frameRequest = video.requestVideoFrameCallback(onFrame)
    }
    try {
      Promise.resolve(video.play()).then(() => { playbackStarted = true; check() }, finish)
    } catch (error) {
      finish(error)
    }
    check()
  })
}
