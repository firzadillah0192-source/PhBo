// Read only public production contract checks. No account, upload or generation writes.
import assert from 'node:assert/strict'
const base = process.env.PHBO_V2_READ_ORIGIN || 'http://127.0.0.1:3000'
const checks = [
  ['/api/health', body => { assert.equal(body.status, 'ok'); return 'healthy' }],
  ['/api/templates', body => { assert.ok(Array.isArray(body.templates)); for (const row of body.templates) assert.ok(row.id && row.name && 'basic_available' in row); return body.templates.length }],
  ['/api/experiences', body => { assert.ok(Array.isArray(body.experiences)); for (const row of body.experiences) assert.ok(row.id && row.name && 'max_ornaments' in row); return body.experiences.length }],
  ['/api/classic/layouts', body => { assert.ok(Array.isArray(body)); for (const row of body) assert.ok(row.id && Number.isInteger(row.shot_count) && row.shot_count >= 1 && row.shot_count <= 4 && 'requires_event_name' in row); return body.length }],
  ['/api/advanced/frame-styles', body => { assert.ok(Array.isArray(body)); return body.length }],
  ['/api/advanced/ornaments', body => { assert.ok(Array.isArray(body)); return body.length }],
]
const result = []
for (const [path, check] of checks) {
  const response = await fetch(base + path, { cache: 'no-store' }); assert.equal(response.status, 200)
  result.push({ path, result: check(await response.json()) })
}
console.log(JSON.stringify({ status: 'PASS', production_writes: 0, checks: result }))
