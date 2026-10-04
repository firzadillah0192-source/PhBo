import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('Kiosk batch proxy preserves ordinary upload limit and forwards only trusted upload routes',() => {
  const config = readFileSync(new URL('../nginx.conf',import.meta.url),'utf8')
  assert.match(config,/client_max_body_size 16m;/)
  const block = config.match(/location ~ \^\/api\/v1\/\(photo-sessions\|upload-image\)\/\?\$ \{([\s\S]*?)\n    \}/)?.[1]
  assert.ok(block); assert.match(block,/client_max_body_size 50m;/)
  assert.match(block,/http:\/\/photobooth-express:8081/)
  assert.match(block,/proxy_set_header Host\s+\$http_host/)
})
