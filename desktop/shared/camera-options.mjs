// Canon EDSDK codes the staff menu may send to the camera, and the output-size presets. No Node imports: the renderer uses this too.
// ISO codes were confirmed on a EOS 2000D (probe 1.1.5). Aperture and shutter use the EDSDK tables; only whole-stop values plus a few
// common ones are offered, and the camera reads every value back so a wrong code shows up as a mismatch instead of a silent change.
export const ISO_OPTIONS = Object.freeze([
  { code: 0x00, label: 'Auto' }, { code: 0x48, label: '100' }, { code: 0x50, label: '200' }, { code: 0x58, label: '400' },
  { code: 0x60, label: '800' }, { code: 0x68, label: '1600' }, { code: 0x70, label: '3200' }, { code: 0x78, label: '6400' }
]);
export const AV_OPTIONS = Object.freeze([
  [0x08, '1.0'], [0x10, '1.4'], [0x14, '1.8'], [0x18, '2.0'], [0x20, '2.8'], [0x24, '3.5'], [0x28, '4.0'], [0x30, '5.6'], [0x33, '6.3'],
  [0x38, '8'], [0x40, '11'], [0x48, '16'], [0x50, '22'], [0x58, '32']
].map(([code, label]) => ({ code, label: 'f/' + label })));
export const TV_OPTIONS = Object.freeze([
  [0x40, '1/2 dtk'], [0x48, '1/4'], [0x50, '1/8'], [0x58, '1/15'], [0x60, '1/30'], [0x63, '1/40'], [0x65, '1/50'], [0x68, '1/60'], [0x6B, '1/80'],
  [0x6D, '1/100'], [0x70, '1/125'], [0x73, '1/160'], [0x75, '1/200'], [0x78, '1/250'], [0x80, '1/500'], [0x88, '1/1000']
].map(([code, label]) => ({ code, label })));
/** Output photo: longest edge in pixels (0 = keep the camera original) and JPEG quality. The rest of the flow only needs about 1300 px on the short side. */
export const OUTPUT_PRESETS = Object.freeze({
  hemat: { label: 'Hemat (1280 px, file paling kecil)', maxEdge: 1280, quality: 80 },
  kecil: { label: 'Kecil (1600 px)', maxEdge: 1600, quality: 82 },
  jelas: { label: 'Jelas (2000 px, disarankan)', maxEdge: 2000, quality: 85 },
  besar: { label: 'Besar (3000 px)', maxEdge: 3000, quality: 90 },
  asli: { label: 'Asli kamera (file paling besar)', maxEdge: 0, quality: 90 }
});
export const DEFAULT_OUTPUT = 'jelas';
