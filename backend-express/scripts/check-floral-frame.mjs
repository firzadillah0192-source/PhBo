// Private compositor check only: does not create a job/result, call AI, or charge a wallet.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { migrationConfigSchema } from './dist/config/migration-env.js';
import { ClassicImageEngineService } from './dist/services/classic-image-engine.service.js';
const config = migrationConfigSchema.parse(process.env);
const directory = process.env.FLORAL_RELEASE_DIR;
assert.ok(directory?.startsWith('/srv/photobooth/releases/floral-frame-'));
const metadata = JSON.parse(await readFile(directory + '/assets/layout.json', 'utf8'));
const frame = await readFile(directory + '/assets/blank.png');
const layout = { ...metadata, layout_config_json: JSON.stringify({ slots: metadata.slots }) };
const colors = ['red', 'green', 'blue'];
const photos = await Promise.all(colors.map(background => sharp({ create: { width: 600, height: 900, channels: 3, background } }).jpeg().toBuffer()));
const engine = new ClassicImageEngineService(config.IMAGE_ENGINE_BASE_URL.replace(/\/$/, '') + '/compose-classic', config.AI_ENGINE_API_KEY);
const generated = await engine.generate(layout, photos, frame, { event_name: 'Uji Template Floral', captured_at: '2026-10-10T07:00:00+00:00', claim_token: 'a'.repeat(43) });
const info = await sharp(generated.bytes).metadata();
assert.equal(info.width, 1200); assert.equal(info.height, 3600); assert.equal(info.channels, 3);
const header = { left: 360, top: 15, width: 480, height: 65 };
await writeFile(directory + '/helper-fixture.png', generated.bytes);
const inputHeader = await sharp(frame).extract(header).flatten({ background: '#073957' }).raw().toBuffer();
const outputHeader = await sharp(generated.bytes).extract(header).raw().toBuffer();
assert.equal(outputHeader.length, inputHeader.length);
let maximumDifference = 0;
for (let i = 0; i < inputHeader.length; i++) maximumDifference = Math.max(maximumDifference, Math.abs(inputHeader[i] - outputHeader[i]));
assert.ok(maximumDifference <= 2, `NXBooth header compositing changed by ${maximumDifference} levels`);
for (const [index, slot] of metadata.slots.entries()) {
  const pixel = await sharp(generated.bytes).extract({ left: slot.x + Math.floor(slot.width / 2), top: slot.y + Math.floor(slot.height / 2), width: 1, height: 1 }).raw().toBuffer();
  const target = [[255, 0, 0], [0, 128, 0], [0, 0, 255]][index];
  assert.ok(target.every((value, channel) => Math.abs(value - pixel[channel]) <= 2));
}
await writeFile(directory + '/helper-fixture.png', generated.bytes);
console.log(JSON.stringify({ status: 'PASS', actualDeployedPythonHelper: true, brandPreserved: true, shots: 3, dimensions: [1200, 3600], channels: 3, productionJobsCreated: 0 }));
