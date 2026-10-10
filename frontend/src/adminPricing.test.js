import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

test('Admin pricing renders rupiah, rate changes, assumptions and unavailable usage', async () => {
  const vite = await createServer({ configFile: false, plugins: [react()], server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
  try {
    const { ImagePrice, PriceRateContext } = await vite.ssrLoadModule('/src/AdminPage.jsx')
    const estimate = { status: 'simulation', low_usd: 0.028195, high_usd: 0.037876, text_input_per_million: 5, image_input_per_million: 8, image_output_per_million: 30, rates_checked_on: '2026-10-02', source_url: 'https://developers.openai.com/api/docs/guides/image-generation' }
    const render = (rate, price = estimate) => renderToStaticMarkup(React.createElement(PriceRateContext.Provider, { value: rate }, React.createElement(ImagePrice, { estimate: price, detailed: true })))
    const initial = render(16000)
    assert.match(initial, /451,12/)
    assert.match(initial, /606,02/)
    assert.match(initial, /Simulasi/)
    assert.match(initial, /bukan batas tagihan aktual/)
    assert.match(initial, /80.000/)
    assert.doesNotMatch(initial, /\$[\d]/)
    assert.match(render(20000), /563,9/)
    assert.match(render(0), /Tidak tersedia/)
    assert.match(render(16000, { ...estimate, status: 'unavailable', low_usd: null, high_usd: null }), /Unavailable/)
  } finally {
    await vite.close()
  }
})
