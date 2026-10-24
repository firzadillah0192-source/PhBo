import { tr } from './i18n.js'

export function cameraFailureMessage(error, language = 'en') {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return tr('Izin kamera diblokir. Izinkan akses kamera di pengaturan situs browser Anda, lalu coba lagi. Anda juga bisa mengunggah foto.', 'Camera permission is blocked. Allow camera access in your browser’s site settings, then try again. You can also upload a photo.', language)
    case 'NotFoundError':
      return tr('Kamera tidak ditemukan. Sambungkan kamera atau unggah foto.', 'No camera was found. Connect a camera or upload a photo.', language)
    case 'NotReadableError':
    case 'TrackStartError':
      return tr('Kamera tidak bisa dimulai. Tutup aplikasi lain yang memakai kamera, lalu coba lagi atau unggah foto.', 'The camera could not start. Close other apps using the camera, then try again or upload a photo.', language)
    case 'OverconstrainedError':
      return tr('Kamera ini tidak mendukung pengaturan yang diminta. Coba lagi atau unggah foto.', 'This camera cannot use the requested settings. Try again or upload a photo.', language)
    case 'CameraUnsupported':
      return tr('Pratinjau kamera langsung tidak tersedia di browser ini. Buka NXBooth di Safari atau Chrome, atau ambil/pilih foto di bawah.', 'Live camera preview is unavailable in this browser. Open NXBooth in Safari or Chrome, or take or choose a photo below.', language)
    case 'CameraInsecure':
      return tr('Akses kamera memerlukan HTTPS. Buka NXBooth lewat alamat amannya, atau unggah foto.', 'Camera access requires HTTPS. Open NXBooth using its secure address, or upload a photo.', language)
    default:
      return tr('Kamera tidak bisa dimulai. Coba lagi atau unggah foto.', 'The camera could not start. Try again or upload a photo.', language)
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
