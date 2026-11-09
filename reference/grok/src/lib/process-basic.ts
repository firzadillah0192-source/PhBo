import type { Grade } from "./catalog";
import { loadImage } from "./photo";

export async function processBasic(
  photoDataUrl: string,
  grade: Grade,
): Promise<string> {
  const img = await loadImage(photoDataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("We couldn't finish that photograph.");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  applyGrade(ctx, canvas.width, canvas.height, grade);
  addGrain(ctx, canvas.width, canvas.height, grainAmount(grade));
  addVignette(ctx, canvas.width, canvas.height, vignetteAmount(grade));

  if (grade === "polaroid") {
    return mattePolaroid(canvas);
  }
  return canvas.toDataURL("image/jpeg", 0.92);
}

function grainAmount(grade: Grade) {
  if (grade === "film" || grade === "noir") return 18;
  if (grade === "polaroid") return 14;
  if (grade === "painterly") return 10;
  return 6;
}

function vignetteAmount(grade: Grade) {
  if (grade === "noir") return 0.42;
  if (grade === "golden" || grade === "film") return 0.28;
  if (grade === "porcelain") return 0.08;
  return 0.18;
}

function applyGrade(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  grade: Grade,
) {
  ctx.save();
  if (grade === "noir") {
    ctx.globalCompositeOperation = "saturation";
    ctx.fillStyle = "#000000";
    ctx.globalAlpha = 1;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "overlay";
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, w, h);
  } else if (grade === "golden") {
    ctx.globalCompositeOperation = "soft-light";
    ctx.fillStyle = "#F3B587";
    ctx.globalAlpha = 0.45;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "overlay";
    ctx.fillStyle = "#f6d7a8";
    ctx.globalAlpha = 0.2;
    ctx.fillRect(0, 0, w, h);
  } else if (grade === "porcelain") {
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = "#fff8f2";
    ctx.globalAlpha = 0.22;
    ctx.fillRect(0, 0, w, h);
  } else if (grade === "soft") {
    ctx.globalCompositeOperation = "soft-light";
    ctx.fillStyle = "#EEF2F5";
    ctx.globalAlpha = 0.5;
    ctx.fillRect(0, 0, w, h);
  } else if (grade === "polaroid") {
    ctx.globalCompositeOperation = "soft-light";
    ctx.fillStyle = "#f3d9b0";
    ctx.globalAlpha = 0.35;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "saturation";
    ctx.fillStyle = "#808080";
    ctx.globalAlpha = 0.18;
    ctx.fillRect(0, 0, w, h);
  } else if (grade === "painterly") {
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = "#e8d5b5";
    ctx.globalAlpha = 0.16;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "overlay";
    ctx.fillStyle = "#7FA685";
    ctx.globalAlpha = 0.08;
    ctx.fillRect(0, 0, w, h);
  } else if (grade === "film") {
    ctx.globalCompositeOperation = "soft-light";
    ctx.fillStyle = "#e7c9a4";
    ctx.globalAlpha = 0.28;
    ctx.fillRect(0, 0, w, h);
  } else {
    ctx.globalCompositeOperation = "soft-light";
    ctx.fillStyle = "#f2efe8";
    ctx.globalAlpha = 0.22;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
}

function addVignette(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  amount: number,
) {
  const g = ctx.createRadialGradient(
    w / 2,
    h / 2,
    Math.min(w, h) * 0.32,
    w / 2,
    h / 2,
    Math.max(w, h) * 0.72,
  );
  g.addColorStop(0, "rgba(17,18,22,0)");
  g.addColorStop(1, `rgba(17,18,22,${amount})`);
  ctx.save();
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function addGrain(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  amount: number,
) {
  const image = ctx.getImageData(0, 0, w, h);
  const data = image.data;
  for (let i = 0; i < data.length; i += 16) {
    const n = (Math.random() - 0.5) * amount;
    data[i] = clamp(data[i] + n);
    data[i + 1] = clamp(data[i + 1] + n);
    data[i + 2] = clamp(data[i + 2] + n);
  }
  ctx.putImageData(image, 0, 0);
}

function clamp(v: number) {
  return Math.max(0, Math.min(255, v));
}

function mattePolaroid(photo: HTMLCanvasElement): string {
  const padX = Math.round(photo.width * 0.07);
  const padTop = Math.round(photo.width * 0.07);
  const padBottom = Math.round(photo.width * 0.2);
  const out = document.createElement("canvas");
  out.width = photo.width + padX * 2;
  out.height = photo.height + padTop + padBottom;
  const ctx = out.getContext("2d");
  if (!ctx) return photo.toDataURL("image/jpeg", 0.92);
  ctx.fillStyle = "#F7F4EE";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(photo, padX, padTop);
  return out.toDataURL("image/jpeg", 0.92);
}
