// Browser cameras only. Canon USB control through EDSDK belongs to the desktop adapter.
export function stopCamera(stream) { stream?.getTracks().forEach(track => track.stop()) }
const canon = device => /canon|eos webcam/i.test(device.label || '')
const denied = error => ['NotAllowedError', 'SecurityError'].includes(error?.name)
export async function openKioskCamera(media = globalThis.navigator?.mediaDevices) {
 if (!media?.getUserMedia) throw new Error('Kamera membutuhkan browser yang mendukung kamera dan koneksi HTTPS.')
 let stream, originalError
 try { stream = await media.getUserMedia({video: {facingMode: {ideal: 'user'}}, audio: false}) }
 catch (error) { if (denied(error)) throw error; originalError = error }
 let devices = []
 try { devices = (await media.enumerateDevices()).filter(d => d.kind === 'videoinput' && d.deviceId) } catch {}
 const current = stream?.getVideoTracks()[0]?.getSettings().deviceId
 const preferred = devices.find(canon)
 if (preferred && preferred.deviceId !== current) {
  // Release the default stream before opening another camera: some Windows drivers lock capture globally.
  stopCamera(stream); stream = null
  try { stream = await media.getUserMedia({video: {deviceId: {exact: preferred.deviceId}}, audio: false}) }
  catch (error) { if (denied(error)) throw error; originalError = error }
 }
 if (!stream) {
  for (const device of devices.filter(d => !canon(d))) {
   try { stream = await media.getUserMedia({video: {deviceId: {exact: device.deviceId}}, audio: false}); break }
   catch (error) { if (denied(error)) throw error; originalError = error }
  }
 }
 if (!stream) throw originalError || new Error('Kamera tidak ditemukan. Hubungkan kamera perangkat, lalu coba lagi.')
 const track = stream.getVideoTracks()[0]
 const selected = devices.find(d => d.deviceId === track?.getSettings().deviceId)
 return {stream, source: canon(selected || {label:track?.label}) ? 'Canon' : 'Kamera perangkat'}
}
export function cameraError(error) {
 if (denied(error)) return 'Izinkan akses kamera di pengaturan browser, lalu coba lagi.'
 if (error?.name === 'NotReadableError') return 'Kamera sedang digunakan aplikasi lain. Tutup aplikasi tersebut, lalu coba lagi.'
 if (error?.name === 'NotFoundError') return 'Kamera tidak ditemukan. Hubungkan kamera, lalu coba lagi.'
 return error?.message || 'Kamera belum tersedia. Coba lagi.'
}
export async function captureCameraPhoto(video) {
 if (!video?.videoWidth || !video.videoHeight || video.readyState < 2) throw new Error('Tunggu sampai gambar kamera siap.')
 const canvas = document.createElement('canvas')
 canvas.width = video.videoWidth; canvas.height = video.videoHeight
 canvas.getContext('2d').drawImage(video, 0, 0)
 const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92))
 if (!blob) throw new Error('Foto belum dapat diambil. Coba lagi.')
 return new File([blob], `pose-${Date.now()}.jpg`, {type:'image/jpeg'})
}
