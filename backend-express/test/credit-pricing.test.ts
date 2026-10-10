import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateTokenCharge, normalizedImageUsage } from '../src/services/credit-pricing.service.js';
import { priceProviderRun, priceCompletedGeneration } from '../src/services/generation-credit-charge.service.js';
import type { NxProviderRun, Prisma } from '@prisma/client';
import { responseOperationalMeta } from '../src/services/native-provider.service.js';
import { providerRunMetadata } from '../src/models/provider-run.model.js';

test('token matrix uses 18000, 20% service and rounds only after summing; cache counted once', () => {
  const charge = calculateTokenCharge({ input_text_tokens: 3000, cached_text_tokens: 2000, input_image_tokens: 3000, cached_image_tokens: 1000, output_image_tokens: 400 })!;
  assert.equal(charge.token_rupiah, 675); assert.equal(charge.service_rupiah, 135); assert.equal(charge.sale_rupiah, 810); assert.equal(charge.credits, 9);
});

const run = (usage: object, columns: object = {}) => ({ id: 'fixture-run', requested_model: 'cx/gpt-image-2.5', provider_reported_model: null,
  input_tokens: null, output_tokens: null, input_text_tokens: null, input_image_tokens: null, output_image_tokens: null,
  provider_usage_raw_json: JSON.stringify(usage), ...columns } as NxProviderRun);
test('aggregate input/output supports the upper admin estimate and ignores total_tokens for pricing', () => {
  const price = priceProviderRun(run({ input_tokens:2421, output_tokens:87, total_tokens:999999 }))!;
  assert.equal(price.estimated,true);assert.equal(price.basis,'estimated_aggregate_tokens_upper');assert.equal(price.token_usd,.021978);
  assert.equal(priceProviderRun(run({}, { input_tokens:2421, output_tokens:87 }))?.token_usd,price.token_usd);
});
test('cache is discounted once in aggregate estimates; invalid counters are rejected', () => {
  assert.equal(priceProviderRun(run({ input_tokens:3000, output_tokens:400, cached_tokens:1000 }))?.token_usd,.03);
  assert.equal(normalizedImageUsage({input_tokens:3000,output_tokens:400,input_tokens_details:{cached_tokens:1000}})?.cached_tokens,1000);
  assert.equal(normalizedImageUsage({input_tokens:3000,output_tokens:400,cached_input_tokens:1000})?.cached_image_tokens,undefined);
  for(const usage of [{input_tokens:100,output_tokens:-1},{input_tokens:100,output_tokens:100,cached_tokens:101},{input_tokens:'100',output_tokens:100},{}])assert.equal(priceProviderRun(run(usage)),null);
});
test('aggregate cache survives provider headers and persisted usage metadata',()=>{
  const meta=responseOperationalMeta(new Headers({'x-9router-input-tokens':'3000','x-9router-output-tokens':'400','x-9router-cached-tokens':'1000'}));
  const data=providerRunMetadata(meta);const usage=JSON.parse(String(data.provider_usage_raw_json));
  assert.equal(usage.cached_tokens,1000);assert.equal('cached_tokens' in data,false);
  assert.equal(priceProviderRun(run(usage))?.token_usd,.03);
});
test('complete reported categories retain precise cache pricing; unsupported models cannot be billed', () => {
  const price=priceProviderRun(run({ input_text_tokens:3000,cached_text_tokens:2000,input_image_tokens:3000,cached_image_tokens:1000,output_image_tokens:400 }))!;
  assert.equal(price.estimated,false);assert.equal(price.token_usd,.0375);
  assert.equal(priceProviderRun(run({input_tokens:100,output_tokens:100},{requested_model:'unsupported'})),null);
});
test('successful run estimates are summed, service added once and credits rounded once',async()=>{
  const tx={nxProviderRun:{findMany:async(args:{where:{upstream_status:string}})=>{assert.equal(args.where.upstream_status,'SUCCEEDED');return Array.from({length:4},()=>run({input_tokens:250,output_tokens:0}));}}} as unknown as Prisma.TransactionClient;
  const charge=await priceCompletedGeneration(tx,'fixture','BASIC');assert.equal(charge?.credits,2);assert.equal(charge?.calculation.estimated,true);
});
test('unknown breakdown never becomes guessed billing; invalid cache and negative usage rejected', () => {
  assert.equal(calculateTokenCharge({}), null);
  const base = { input_text_tokens: 1000, input_image_tokens: 0, output_image_tokens: 100, cached_text_tokens: 0, cached_image_tokens: 0 };
  assert.equal(calculateTokenCharge({ ...base, cached_text_tokens: 1001 }), null);
  assert.equal(calculateTokenCharge({ ...base, output_image_tokens: -1 }), null);
  assert.equal(calculateTokenCharge({ ...base, cached_image_tokens: NaN }), null);
});
test('reported body usage preserves cache details and image output; bare totals do not fabricate input split', () => {
  assert.deepEqual(normalizedImageUsage({ input_tokens: 300, output_tokens: 400, input_tokens_details: { text_tokens: 100, image_tokens: 200, cached_tokens_details: { text_tokens: 10, image_tokens: 20 } } }), { input_tokens: 300, output_tokens: 400, input_text_tokens: 100, input_image_tokens: 200, output_image_tokens: 400, cached_text_tokens: 10, cached_image_tokens: 20 });
  assert.equal(normalizedImageUsage({ input_tokens: 100, output_tokens: 200 })?.input_text_tokens, undefined);
  assert.equal(normalizedImageUsage({ input_tokens: 100, output_tokens: 200 })?.cached_text_tokens, undefined);
  assert.equal(normalizedImageUsage({ input_tokens_details: { text_tokens: 100, image_tokens: 200, cached_tokens: 20 } })?.cached_text_tokens, undefined);
});
