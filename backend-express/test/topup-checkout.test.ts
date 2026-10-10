import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createMigrationApp } from '../src/migration-app.js';
import type { CustomerCatalogService } from '../src/services/customer-catalog.service.js';
import type { CustomerAccountService } from '../src/services/customer-account.service.js';
import { AppError } from '../src/lib/errors.js';

function app(authenticated = true) {
  // No database, payment, or wallet mutation methods are provided to this stub.
  const service = {
    config: { cookieSecure: false },
    resolve: async () => ({ account: authenticated ? { id: 'fixture-account' } : null }),
    requireAccount: (identity: { account: unknown }) => {
      if (!identity.account) throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Sign in.');
      return identity.account;
    },
  } as unknown as CustomerAccountService;
  return createMigrationApp({} as CustomerCatalogService, { corsOrigins: [] }, service);
}

test('authenticated checkout explicitly reports unavailable without charging or granting credit', async () => {
  const response = await request(app()).post('/api/account/topups/checkout').send({ credits: 750 });
  assert.equal(response.status, 503);
  assert.equal(response.body.detail.error_code, 'PAYMENT_GATEWAY_UNAVAILABLE');
  assert.match(response.body.detail.message, /support@gennexbyte.com/);
});

test('checkout requires sign in and a positive integer credit amount', async () => {
  assert.equal((await request(app(false)).post('/api/account/topups/checkout').send({ credits: 100 })).status, 401);
  for (const credits of [0, -1, 1.5, '100', Number.MAX_SAFE_INTEGER]) {
    assert.equal((await request(app()).post('/api/account/topups/checkout').send({ credits })).status, 422);
  }
});
