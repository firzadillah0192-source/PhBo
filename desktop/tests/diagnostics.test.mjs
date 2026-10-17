import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildReport, scrub } from '../shared/diagnostics.mjs';
import { DiagnosticsClient, origins } from '../shared/clients.mjs';
import { Bridge } from '../shared/bridge.mjs';

const probe = { ok: false, total_ms: 1800, cameras: [{ name: 'Canon EOS 2000D' }], model: 'Canon EOS 2000D', serial_tail: null,
  steps: [{ name: 'enumerate', ok: true, ms: 40, code: null, detail: null, size_bytes: null }, { name: 'liveview', ok: false, ms: 900, code: 'LIVEVIEW_EMPTY', detail: '0/3 frames', size_bytes: 0 }] };
const base = { version: '1.0.1', platform: 'win32', osVersion: '10.0.26100', deviceName: 'KIOSK-1', deviceStatus: { camera: 'BROWSER_WEBCAM', printer: 'READY' }, probe, now: new Date('2026-10-20T10:00:00Z') };

test('report keeps only allowed fields, drops nulls and hides the Windows profile path', () => {
  const report = buildReport({ ...base, home: 'C:\\Users\\Alice', startupLog: 'ENOENT C:\\Users\\Alice\\AppData\\x\u0000 failed' });
  assert.equal(report.camera_probe.serial_tail, undefined);
  assert.equal(report.camera_probe.steps[0].code, undefined);
  assert.equal(report.camera_probe.steps[1].code, 'LIVEVIEW_EMPTY');
  assert.ok(!JSON.stringify(report).includes('Alice'));
  assert.ok(report.startup_log.includes('~'));
  assert.deepEqual(Object.keys(report).sort(), ['app_version', 'camera_probe', 'captured_at', 'device_name', 'device_status', 'os_version', 'platform', 'startup_log']);
});

test('report refuses a malformed probe and caps free text', () => {
  assert.throws(() => buildReport({ ...base, probe: { ...probe, token: 'x' } }));
  assert.throws(() => buildReport({ ...base, version: 'latest' }));
  assert.equal(scrub('a'.repeat(5000), 2000, '').length, 2000);
});

test('DiagnosticsClient posts JSON with the kiosk credential and rejects without one', async () => {
  let seen;
  const srv = createServer((req, res) => { let body = ''; req.on('data', c => body += c); req.on('end', () => { seen = { method: req.method, url: req.url, auth: req.headers.authorization, type: req.headers['content-type'], body: JSON.parse(body) };
    res.writeHead(201, { 'Content-Type': 'application/json' }).end(JSON.stringify({ data: { id: 'abc', stored: true } })); }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  try {
    const url = `http://127.0.0.1:${srv.address().port}`, config = origins({ control: url, media: url, storage: url, web: url }, true);
    await assert.rejects(new DiagnosticsClient(config, '').send(buildReport(base)), /BACKEND_NOT_CONFIGURED/);
    const out = await new DiagnosticsClient(config, { token: 't'.repeat(43) }).send(buildReport(base));
    assert.deepEqual(out, { id: 'abc', stored: true });
    assert.equal(seen.url, '/api/v1/desktop/diagnostics');
    assert.equal(seen.method, 'POST');
    assert.equal(seen.auth, 'Bearer ' + 't'.repeat(43));
    assert.equal(seen.type, 'application/json');
    await assert.rejects(new DiagnosticsClient(config, 'k'.repeat(32)).send({ image: 'AAAA' }), /CONTROL_JSON_ONLY/);
  } finally { srv.closeAllConnections(); srv.close(); }
});

test('camera.probe fails explicitly off Windows and in simulated mode (no fake camera result)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nxbooth-probe-'));
  const dll = resolve('native/KioskBridge/bin/Release/net10.0/KioskBridge.dll');
  try {
    await mkdir(join(root, 'a'));
    for (const args of [[], ['--simulated']]) {
      const b = new Bridge(process.env.PHBO_DOTNET || 'dotnet', [dll, '--root', join(root, 'a'), ...args]);
      try { await assert.rejects(b.call('camera.probe'), /CAMERA_WINDOWS_ONLY/); } finally { b.close(); }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
