// Matches backend-express/src/nxduet/compositor.ts; verified by contract tests.
export function companionRect(width,height,imageWidth,imageHeight,placement) {
  const ratio=Math.min(width*0.5/imageWidth,height/imageHeight)*placement.scale
  const w=Math.max(1,Math.round(imageWidth*ratio)),h=Math.max(1,Math.round(imageHeight*ratio))
  return {width:w,height:h,left:0,top:height-h}
}
// Capture canvas follows the Classic frame slot so the live preview matches the strip.
export function captureSize(frame,width=1200) {
  const ratio=frame?.slot_width&&frame?.slot_height?frame.slot_height/frame.slot_width:0.85
  return {width,height:Math.round(width*ratio)}
}
export function cameraCrop(width,height,targetWidth=1200,targetHeight=900) {
  const ratio=Math.max(targetWidth/width,targetHeight/height)
  const cropWidth=targetWidth/ratio,cropHeight=targetHeight/ratio
  return {x:(width-cropWidth)/2,y:(height-cropHeight)/2,width:cropWidth,height:cropHeight}
}
export function drawCamera(canvas,video) {
  if(!video.videoWidth||!video.videoHeight)throw new Error('Kamera belum siap.')
  const ctx=canvas.getContext('2d'),crop=cameraCrop(video.videoWidth,video.videoHeight,canvas.width,canvas.height)
  ctx.save();ctx.translate(canvas.width,0);ctx.scale(-1,1)
  ctx.drawImage(video,crop.x,crop.y,crop.width,crop.height,0,0,canvas.width,canvas.height);ctx.restore()
}
export function drawCompanion(canvas,image,placement) {
  const rect=companionRect(canvas.width,canvas.height,image.naturalWidth,image.naturalHeight,placement)
  canvas.getContext('2d').drawImage(image,rect.left,rect.top,rect.width,rect.height)
}
