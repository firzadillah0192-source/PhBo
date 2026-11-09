import { AIExperience, StudioTemplate } from '../types';

/**
 * Loads an image from URL or dataURL into an HTMLImageElement
 */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = src;
  });
}

/**
 * Generates transformed photograph based on the chosen Experience or Studio Template
 */
export async function processPhotoboothImage(
  userPhotoUrl: string,
  options: {
    mode: 'basic' | 'advanced';
    template?: StudioTemplate;
    experience?: AIExperience;
  }
): Promise<string> {
  const userImg = await loadImage(userPhotoUrl);
  
  const width = 1200;
  const height = options.template?.aspectRatio === '1:1' ? 1200 : 1600;
  
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  
  if (!ctx) {
    throw new Error('Canvas context initialization failed');
  }

  // Clear background
  ctx.fillStyle = '#111216';
  ctx.fillRect(0, 0, width, height);

  if (options.mode === 'basic' && options.template) {
    applyStudioTemplate(ctx, userImg, width, height, options.template);
  } else if (options.mode === 'advanced' && options.experience) {
    await applyAIExperienceTransform(ctx, userImg, width, height, options.experience);
  } else {
    // Default fallback draw
    drawCoverImage(ctx, userImg, 0, 0, width, height);
  }

  return canvas.toDataURL('image/jpeg', 0.95);
}

/**
 * Basic Mode: Applies curated studio photobooth grading, borders, and typography
 */
function applyStudioTemplate(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  w: number,
  h: number,
  template: StudioTemplate
) {
  const filter = template.filterStyle;

  if (template.frameStyle === 'gallery-white') {
    ctx.fillStyle = '#FAF9F6';
    ctx.fillRect(0, 0, w, h);
    const borderX = 80;
    const borderY = 80;
    const innerW = w - borderX * 2;
    const innerH = h - borderY * 2 - 80;

    ctx.save();
    ctx.filter = `brightness(${filter.brightness}) contrast(${filter.contrast}) saturate(${filter.saturation}) sepia(${filter.sepia})`;
    drawCoverImage(ctx, img, borderX, borderY, innerW, innerH);
    ctx.restore();

    // Subtle film grain
    addFilmGrain(ctx, borderX, borderY, innerW, innerH, 0.08);

    // Caption
    ctx.fillStyle = '#252830';
    ctx.font = '600 24px "Cormorant Garamond", Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText(template.title.toUpperCase(), w / 2, h - 55);
    ctx.font = '400 14px "Plus Jakarta Sans", sans-serif';
    ctx.fillStyle = '#787B86';
    ctx.fillText('CELESTIAL DIGITAL STUDIO · ' + new Date().getFullYear(), w / 2, h - 30);

  } else if (template.frameStyle === 'polaroid') {
    ctx.fillStyle = '#FDFCF9';
    ctx.fillRect(0, 0, w, h);
    
    // Polaroid inset
    const pad = 70;
    const photoH = w - pad * 2; // square photo
    
    ctx.save();
    ctx.filter = `brightness(${filter.brightness}) contrast(${filter.contrast}) saturate(${filter.saturation}) sepia(${filter.sepia})`;
    drawCoverImage(ctx, img, pad, pad, w - pad * 2, photoH);
    ctx.restore();

    // Soft warm tint
    ctx.fillStyle = 'rgba(243, 181, 135, 0.08)';
    ctx.fillRect(pad, pad, w - pad * 2, photoH);

    addFilmGrain(ctx, pad, pad, w - pad * 2, photoH, 0.1);

    // Subtle handwritten feel label
    ctx.fillStyle = '#323438';
    ctx.font = 'italic 500 28px "Cormorant Garamond", serif';
    ctx.textAlign = 'center';
    ctx.fillText(template.title, w / 2, h - 90);
    ctx.font = '500 13px "Plus Jakarta Sans", sans-serif';
    ctx.fillStyle = '#8E919A';
    ctx.fillText('ARCHIVAL INSTANT PRINT · NO. ' + Math.floor(Math.random() * 899 + 100), w / 2, h - 55);

  } else if (template.frameStyle === 'filmstrip') {
    // Black filmstrip border with sprockets
    ctx.fillStyle = '#0F0F12';
    ctx.fillRect(0, 0, w, h);

    const marginX = 90;
    const marginY = 80;
    const innerW = w - marginX * 2;
    const innerH = h - marginY * 2;

    // Sprocket holes on left and right
    ctx.fillStyle = '#FFFFFF';
    const holeW = 28;
    const holeH = 44;
    const spacing = 75;
    for (let y = 40; y < h - 40; y += spacing) {
      drawRoundedRect(ctx, 30, y, holeW, holeH, 6);
      drawRoundedRect(ctx, w - 30 - holeW, y, holeW, holeH, 6);
    }

    ctx.save();
    ctx.filter = `brightness(${filter.brightness}) contrast(${filter.contrast}) saturate(${filter.saturation}) sepia(${filter.sepia})`;
    drawCoverImage(ctx, img, marginX, marginY, innerW, innerH);
    ctx.restore();

    if (filter.tint) {
      ctx.fillStyle = filter.tint;
      ctx.fillRect(marginX, marginY, innerW, innerH);
    }

    addFilmGrain(ctx, marginX, marginY, innerW, innerH, 0.14);

    // Film edge numbering
    ctx.fillStyle = '#D97706';
    ctx.font = '600 14px monospace';
    ctx.fillText('KODAK 400TMY', marginX + 10, h - 35);
    ctx.fillText('• 24A •', w / 2 - 30, h - 35);
    ctx.fillText('ISO 400', w - marginX - 80, h - 35);

  } else {
    // Minimal borderless studio
    ctx.save();
    ctx.filter = `brightness(${filter.brightness}) contrast(${filter.contrast}) saturate(${filter.saturation}) sepia(${filter.sepia})`;
    drawCoverImage(ctx, img, 0, 0, w, h);
    ctx.restore();

    if (filter.tint) {
      ctx.fillStyle = filter.tint;
      ctx.fillRect(0, 0, w, h);
    }

    // Gentle vignette
    addVignette(ctx, w, h, 0.35);

    // Watermark tag in bottom corner
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.font = '500 14px "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('PHOTOBOOTH AI · ' + template.title.toUpperCase(), w - 40, h - 40);
  }
}

/**
 * Advanced Mode: Transforms photo with specialized styling for each creative world
 */
async function applyAIExperienceTransform(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  w: number,
  h: number,
  experience: AIExperience
) {
  switch (experience.transformationType) {
    case 'cinematic-hero': {
      // 2.39:1 Anamorphic cinema grade with teal-orange tone, letterbox bars and lens flare
      ctx.save();
      ctx.filter = 'contrast(1.3) saturate(1.2) brightness(0.95)';
      drawCoverImage(ctx, img, 0, 0, w, h);
      ctx.restore();

      // Cinematic dual split tone (orange highlights, teal shadows)
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, 'rgba(243, 181, 135, 0.18)');
      grad.addColorStop(1, 'rgba(101, 88, 255, 0.22)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Horizontal anamorphic lens flare streak
      const flareGrad = ctx.createLinearGradient(0, h * 0.42, w, h * 0.42);
      flareGrad.addColorStop(0, 'rgba(156, 200, 255, 0)');
      flareGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.45)');
      flareGrad.addColorStop(1, 'rgba(156, 200, 255, 0)');
      ctx.fillStyle = flareGrad;
      ctx.fillRect(0, h * 0.42 - 8, w, 16);

      // Editorial Cinema letterbox
      ctx.fillStyle = '#0B0C0E';
      ctx.fillRect(0, 0, w, 90);
      ctx.fillRect(0, h - 90, w, 90);

      // Film title typography
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '600 18px "Plus Jakarta Sans", sans-serif';
      ctx.letterSpacing = '6px';
      ctx.textAlign = 'center';
      ctx.fillText('CINEMATIC HERO · 35MM ANAMORPHIC', w / 2, 55);
      break;
    }

    case 'mini-me': {
      // Tilt-shift miniature diorama: sharp center horizontal band, blurred top and bottom, high saturation
      ctx.save();
      ctx.filter = 'saturate(1.5) contrast(1.25) brightness(1.08)';
      drawCoverImage(ctx, img, 0, 0, w, h);
      ctx.restore();

      // Miniature depth-of-field simulation
      const dGrad = ctx.createLinearGradient(0, 0, 0, h);
      dGrad.addColorStop(0, 'rgba(255, 255, 255, 0.25)');
      dGrad.addColorStop(0.35, 'rgba(255, 255, 255, 0)');
      dGrad.addColorStop(0.65, 'rgba(255, 255, 255, 0)');
      dGrad.addColorStop(1, 'rgba(0, 0, 0, 0.35)');
      ctx.fillStyle = dGrad;
      ctx.fillRect(0, 0, w, h);

      addVignette(ctx, w, h, 0.4);

      // Mini-me collector seal
      ctx.strokeStyle = '#9CC8FF';
      ctx.lineWidth = 4;
      ctx.strokeRect(40, 40, w - 80, h - 80);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '700 16px "Plus Jakarta Sans", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('MINI ME · SCALE 1:12 DIORAMA EDITION', 65, 80);
      break;
    }

    case 'action-figure': {
      // Blister pack collector packaging with neon-accented card backing
      ctx.fillStyle = '#171923';
      ctx.fillRect(0, 0, w, h);

      // Action card header
      const headerGrad = ctx.createLinearGradient(0, 0, w, 180);
      headerGrad.addColorStop(0, '#6558FF');
      headerGrad.addColorStop(1, '#9CC8FF');
      ctx.fillStyle = headerGrad;
      ctx.fillRect(30, 30, w - 60, 160);

      ctx.fillStyle = '#FFFFFF';
      ctx.font = '900 48px "Plus Jakarta Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('LEGENDS OF THE REALM', w / 2, 110);
      ctx.font = '600 20px "Plus Jakarta Sans", sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillText('COLLECTOR SERIES NO. 01 · DIE-CAST ACCENTS', w / 2, 150);

      // Plastic bubble viewport
      const bubbleX = 60;
      const bubbleY = 220;
      const bubbleW = w - 120;
      const bubbleH = h - 300;

      ctx.save();
      ctx.filter = 'contrast(1.2) saturate(1.3) brightness(1.05)';
      drawCoverImage(ctx, img, bubbleX, bubbleY, bubbleW, bubbleH);
      ctx.restore();

      // Specular highlight gloss on packaging
      const glossGrad = ctx.createLinearGradient(bubbleX, bubbleY, bubbleX + bubbleW, bubbleY + bubbleH);
      glossGrad.addColorStop(0, 'rgba(255, 255, 255, 0.35)');
      glossGrad.addColorStop(0.2, 'rgba(255, 255, 255, 0.05)');
      glossGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = glossGrad;
      ctx.fillRect(bubbleX, bubbleY, bubbleW, bubbleH);

      // Bubble frame
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.lineWidth = 6;
      ctx.strokeRect(bubbleX, bubbleY, bubbleW, bubbleH);

      ctx.fillStyle = '#F3B587';
      ctx.font = '700 18px monospace';
      ctx.textAlign = 'right';
      ctx.fillText('AGES 6+ · MINT IN BOX', w - 60, h - 40);
      break;
    }

    case 'magazine-cover': {
      // High fashion editorial masthead
      ctx.save();
      ctx.filter = 'contrast(1.15) brightness(1.05) saturate(1.1)';
      drawCoverImage(ctx, img, 0, 0, w, h);
      ctx.restore();

      // Vignette
      addVignette(ctx, w, h, 0.3);

      // Editorial Masthead: "CELESTIAL"
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '700 140px "Cormorant Garamond", Georgia, serif';
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 20;
      ctx.fillText('CELESTIAL', w / 2, 210);
      ctx.shadowBlur = 0;

      // Sub-masthead
      ctx.font = '600 16px "Plus Jakarta Sans", sans-serif';
      ctx.letterSpacing = '8px';
      ctx.fillText('THE DIGITAL PORTRAIT ISSUE · VOL. IX', w / 2, 250);

      // Side editorial headlines
      ctx.textAlign = 'left';
      ctx.font = '700 32px "Cormorant Garamond", serif';
      ctx.fillText('STEP INTO', 60, h - 280);
      ctx.fillText('ANOTHER YOU', 60, h - 245);
      ctx.font = '400 16px "Plus Jakarta Sans", sans-serif';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.fillText('How identity reimagines itself', 60, h - 215);
      ctx.fillText('in the era of celestial aesthetics.', 60, h - 190);

      // Barcode bottom right
      drawFakeBarcode(ctx, w - 240, h - 120, 180, 60);
      break;
    }

    case 'retro-80s': {
      // Synthwave chromatic & scanlines
      ctx.save();
      ctx.filter = 'contrast(1.3) saturate(1.4) hue-rotate(-15deg)';
      drawCoverImage(ctx, img, 0, 0, w, h);
      ctx.restore();

      // Magenta / Cyan split wash
      const synthGrad = ctx.createLinearGradient(0, 0, 0, h);
      synthGrad.addColorStop(0, 'rgba(255, 0, 128, 0.18)');
      synthGrad.addColorStop(1, 'rgba(0, 220, 255, 0.22)');
      ctx.fillStyle = synthGrad;
      ctx.fillRect(0, 0, w, h);

      // CRT Scanlines
      ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
      for (let y = 0; y < h; y += 6) {
        ctx.fillRect(0, y, w, 2);
      }

      // Neon chrome title
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'italic 900 52px "Plus Jakarta Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.shadowColor = '#FF0080';
      ctx.shadowBlur = 15;
      ctx.fillText('RETRO WAVE \'85', w / 2, h - 90);
      ctx.shadowBlur = 0;
      break;
    }

    case 'fantasy-portrait': {
      // Luminous celestial glow with soft dream aura
      ctx.save();
      ctx.filter = 'brightness(1.1) contrast(1.1) saturate(1.2)';
      drawCoverImage(ctx, img, 0, 0, w, h);
      ctx.restore();

      // Celestial radial aura
      const aura = ctx.createRadialGradient(w / 2, h * 0.4, 80, w / 2, h * 0.4, w * 0.7);
      aura.addColorStop(0, 'rgba(255, 240, 210, 0.25)');
      aura.addColorStop(0.5, 'rgba(156, 200, 255, 0.15)');
      aura.addColorStop(1, 'rgba(101, 88, 255, 0.2)');
      ctx.fillStyle = aura;
      ctx.fillRect(0, 0, w, h);

      // Golden particles / celestial dust
      drawStardust(ctx, w, h, 80);

      // Subtle editorial gold border
      ctx.strokeStyle = 'rgba(243, 181, 135, 0.5)';
      ctx.lineWidth = 2;
      ctx.strokeRect(50, 50, w - 100, h - 100);

      ctx.fillStyle = '#FAF9F6';
      ctx.font = 'italic 500 24px "Cormorant Garamond", serif';
      ctx.textAlign = 'center';
      ctx.fillText('FANTASY REALM · CELESTIAL PORTRAIT', w / 2, h - 80);
      break;
    }

    case 'pixel-world': {
      // 8-bit / 16-bit retro arcade pixelation filter
      const pixelSize = 8;
      const offCanvas = document.createElement('canvas');
      const offW = Math.floor(w / pixelSize);
      const offH = Math.floor(h / pixelSize);
      offCanvas.width = offW;
      offCanvas.height = offH;
      const offCtx = offCanvas.getContext('2d')!;
      
      offCtx.drawImage(img, 0, 0, offW, offH);

      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(offCanvas, 0, 0, offW, offH, 0, 0, w, h);
      ctx.imageSmoothingEnabled = true;

      // Color boost
      ctx.fillStyle = 'rgba(127, 166, 133, 0.12)';
      ctx.fillRect(0, 0, w, h);

      // Retro game HUD overlay
      ctx.fillStyle = '#00FF66';
      ctx.font = '700 20px monospace';
      ctx.textAlign = 'left';
      ctx.fillText('PLAYER 1 : READY', 50, 70);
      ctx.textAlign = 'right';
      ctx.fillText('LEVEL 99 · 16-BIT', w - 50, 70);
      break;
    }

    case 'sci-fi': {
      // Sci-fi holographic prism
      ctx.save();
      ctx.filter = 'contrast(1.35) saturate(1.25) brightness(0.95)';
      drawCoverImage(ctx, img, 0, 0, w, h);
      ctx.restore();

      const holoGrad = ctx.createLinearGradient(0, 0, w, h);
      holoGrad.addColorStop(0, 'rgba(101, 88, 255, 0.25)');
      holoGrad.addColorStop(0.5, 'rgba(156, 200, 255, 0.15)');
      holoGrad.addColorStop(1, 'rgba(0, 255, 200, 0.2)');
      ctx.fillStyle = holoGrad;
      ctx.fillRect(0, 0, w, h);

      // Sci-fi HUD brackets
      drawSciFiHud(ctx, w, h);
      break;
    }

    case 'avatar-3d':
    case 'nature-fantasy':
    default: {
      // Ethereal beauty treatment
      ctx.save();
      ctx.filter = 'brightness(1.08) contrast(1.15) saturate(1.2)';
      drawCoverImage(ctx, img, 0, 0, w, h);
      ctx.restore();

      const natureGrad = ctx.createLinearGradient(0, 0, w, h);
      natureGrad.addColorStop(0, 'rgba(127, 166, 133, 0.15)');
      natureGrad.addColorStop(1, 'rgba(191, 221, 244, 0.2)');
      ctx.fillStyle = natureGrad;
      ctx.fillRect(0, 0, w, h);

      addVignette(ctx, w, h, 0.35);

      ctx.fillStyle = '#FFFFFF';
      ctx.font = '500 22px "Cormorant Garamond", serif';
      ctx.textAlign = 'center';
      ctx.fillText(experience.title.toUpperCase(), w / 2, h - 60);
      break;
    }
  }
}

/**
 * Draws image respecting object-fit: cover
 */
function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number
) {
  const imgRatio = img.width / img.height;
  const targetRatio = w / h;

  let sW = img.width;
  let sH = img.height;
  let sX = 0;
  let sY = 0;

  if (imgRatio > targetRatio) {
    sW = img.height * targetRatio;
    sX = (img.width - sW) / 2;
  } else {
    sH = img.width / targetRatio;
    sY = (img.height - sH) / 2;
  }

  ctx.drawImage(img, sX, sY, sW, sH, x, y, w, h);
}

function addFilmGrain(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  intensity: number
) {
  const grainCanvas = document.createElement('canvas');
  grainCanvas.width = 160;
  grainCanvas.height = 160;
  const gCtx = grainCanvas.getContext('2d')!;
  const imgData = gCtx.createImageData(160, 160);
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    const val = Math.random() * 255;
    data[i] = val;
    data[i + 1] = val;
    data[i + 2] = val;
    data[i + 3] = Math.random() * (intensity * 255);
  }
  gCtx.putImageData(imgData, 0, 0);

  const pattern = ctx.createPattern(grainCanvas, 'repeat');
  if (pattern) {
    ctx.fillStyle = pattern;
    ctx.fillRect(x, y, w, h);
  }
}

function addVignette(ctx: CanvasRenderingContext2D, w: number, h: number, strength: number) {
  const rad = Math.max(w, h) * 0.75;
  const grad = ctx.createRadialGradient(w / 2, h / 2, rad * 0.45, w / 2, h / 2, rad);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

function drawStardust(ctx: CanvasRenderingContext2D, w: number, h: number, count: number) {
  ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
  for (let i = 0; i < count; i++) {
    const px = Math.random() * w;
    const py = Math.random() * h;
    const size = Math.random() * 2.5 + 0.5;
    ctx.beginPath();
    ctx.arc(px, py, size, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();
}

function drawFakeBarcode(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#000000';
  let curX = x + 10;
  while (curX < x + w - 10) {
    const barW = Math.random() > 0.5 ? 2 : 5;
    ctx.fillRect(curX, y + 6, barW, h - 22);
    curX += barW + (Math.random() > 0.4 ? 3 : 5);
  }
  ctx.font = '9px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('9 780201 37962', x + w / 2, y + h - 6);
}

function drawSciFiHud(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.strokeStyle = 'rgba(156, 200, 255, 0.6)';
  ctx.lineWidth = 2;
  const pad = 60;
  const corner = 40;

  // 4 corners
  // Top-left
  ctx.beginPath();
  ctx.moveTo(pad, pad + corner);
  ctx.lineTo(pad, pad);
  ctx.lineTo(pad + corner, pad);
  ctx.stroke();

  // Top-right
  ctx.beginPath();
  ctx.moveTo(w - pad - corner, pad);
  ctx.lineTo(w - pad, pad);
  ctx.lineTo(w - pad, pad + corner);
  ctx.stroke();

  // Bottom-left
  ctx.beginPath();
  ctx.moveTo(pad, h - pad - corner);
  ctx.lineTo(pad, h - pad);
  ctx.lineTo(pad + corner, h - pad);
  ctx.stroke();

  // Bottom-right
  ctx.beginPath();
  ctx.moveTo(w - pad - corner, h - pad);
  ctx.lineTo(w - pad, h - pad);
  ctx.lineTo(w - pad, h - pad - corner);
  ctx.stroke();

  // Target reticle in center
  ctx.strokeStyle = 'rgba(243, 181, 135, 0.4)';
  ctx.beginPath();
  ctx.arc(w / 2, h * 0.4, 50, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = '#9CC8FF';
  ctx.font = '600 13px monospace';
  ctx.fillText('SYS.ID // BIOMETRIC LOCK 0.998', pad + 10, pad + 30);
  ctx.fillText('NEXUS MATRIX VERIFIED', pad + 10, h - pad - 15);
}
