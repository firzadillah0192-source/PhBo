export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("We couldn't read that photograph."));
    img.src = src;
  });
}

export async function fileToDataUrl(
  file: File,
  maxEdge = 1280,
): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    return cropToDataUrl(img, 3 / 4, maxEdge);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function captureFromVideo(
  video: HTMLVideoElement,
  maxEdge = 1280,
): string {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth || 720;
  canvas.height = video.videoHeight || 960;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("We couldn't capture that frame.");
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0);
  return cropCanvas(canvas, 3 / 4, maxEdge);
}

function cropCanvas(
  source: HTMLCanvasElement,
  aspect: number,
  maxEdge: number,
): string {
  const sw = source.width;
  const sh = source.height;
  const sourceAspect = sw / sh;
  let sx = 0;
  let sy = 0;
  let cw = sw;
  let ch = sh;
  if (sourceAspect > aspect) {
    cw = sh * aspect;
    sx = (sw - cw) / 2;
  } else {
    ch = sw / aspect;
    sy = (sh - ch) / 2;
  }
  const scale = Math.min(1, maxEdge / Math.max(cw, ch));
  const dw = Math.round(cw * scale);
  const dh = Math.round(ch * scale);
  const out = document.createElement("canvas");
  out.width = dw;
  out.height = dh;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("We couldn't finish that photograph.");
  ctx.drawImage(source, sx, sy, cw, ch, 0, 0, dw, dh);
  return out.toDataURL("image/jpeg", 0.88);
}

export function cropToDataUrl(
  img: HTMLImageElement,
  aspect: number,
  maxEdge: number,
): string {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("We couldn't finish that photograph.");
  ctx.drawImage(img, 0, 0);
  return cropCanvas(canvas, aspect, maxEdge);
}

export async function downloadDataUrl(dataUrl: string, filename: string) {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1500);
}
