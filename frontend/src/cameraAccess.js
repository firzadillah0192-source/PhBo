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
      return 'This camera cannot use the requested settings. Try your device camera or upload a photo.'
    case 'CameraUnsupported':
      return 'Live camera preview is unavailable in this browser. Open NXBooth in Safari or Chrome, or take or choose a photo below.'
    case 'CameraInsecure':
      return 'Camera access requires HTTPS. Open NXBooth using its secure address, or upload a photo.'
    default:
      return 'The camera could not start. Try again, take a photo with your device camera, or upload a photo.'
  }
}

export async function requestPortraitCamera(mediaDevices = globalThis.navigator?.mediaDevices, secure = globalThis.isSecureContext) {
  if (secure === false) throw Object.assign(new Error('Secure context required'), { name: 'CameraInsecure' })
  if (!mediaDevices?.getUserMedia) throw Object.assign(new Error('Camera API unavailable'), { name: 'CameraUnsupported' })
  try {
    return await mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
  } catch (error) {
    if (error?.name !== 'OverconstrainedError') throw error
    return mediaDevices.getUserMedia({ video: true, audio: false })
  }
}
