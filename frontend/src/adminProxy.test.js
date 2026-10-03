import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('API proxies preserve the browser authority including a LAN port', () => {
  const config = readFileSync(new URL('../nginx.conf', import.meta.url), 'utf8')
  for (const marker of ['location /api/ {', 'location ^~ /api/public/results/ {']) {
    const block = config.slice(config.indexOf(marker)).split('\n    }')[0]
    assert.match(block, /proxy_set_header Host\s+\$http_host;/)
    assert.match(block, /proxy_set_header X-Forwarded-Host\s+\$http_host;/)
    assert.doesNotMatch(block, /proxy_set_header Host\s+\$host;/)
    assert.doesNotMatch(block, /proxy_set_header X-Forwarded-Host\s+\$http_x_forwarded_host;/)
  }
})
