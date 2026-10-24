import { readFile, writeFile, rename } from 'node:fs/promises';
import { z } from 'zod';
import { ISO_OPTIONS, AV_OPTIONS, TV_OPTIONS, OUTPUT_PRESETS, DEFAULT_OUTPUT } from './camera-options.mjs';
// Camera settings kept on this PC. null = leave that value to the camera (needed because Av/Tv only work in the Av/Tv/M dial modes).
const pick = options => z.number().int().refine(value => options.some(o => o.code === value)).nullable();
export const cameraSettingsSchema = z.object({
  iso: pick(ISO_OPTIONS), av: pick(AV_OPTIONS), tv: pick(TV_OPTIONS),
  output: z.enum(Object.keys(OUTPUT_PRESETS))
}).strict();
export const DEFAULT_CAMERA_SETTINGS = Object.freeze({ iso: null, av: null, tv: null, output: DEFAULT_OUTPUT });
/** The shape the native bridge accepts: codes plus the resolved output size. */
export const bridgeSettings = settings => ({ iso: settings.iso, av: settings.av, tv: settings.tv, ...pickOutput(settings.output) });
const pickOutput = output => { const { maxEdge, quality } = OUTPUT_PRESETS[output]; return { maxEdge, quality }; };
export class CameraSettingsStore {
  constructor(file) { this.file = file; this.value = { ...DEFAULT_CAMERA_SETTINGS }; }
  async load() {
    try { this.value = cameraSettingsSchema.parse(JSON.parse(await readFile(this.file, 'utf8'))); } catch { this.value = { ...DEFAULT_CAMERA_SETTINGS }; }
    return this.value;
  }
  get() { return this.value; }
  async save(input) {
    const parsed = cameraSettingsSchema.parse(input);
    const temp = this.file + '.tmp';
    await writeFile(temp, JSON.stringify(parsed, null, 2), { mode: 0o600 });
    await rename(temp, this.file);
    this.value = parsed;
    return parsed;
  }
}
