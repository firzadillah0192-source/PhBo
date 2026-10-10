import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { CustomerCookieSigner, hashCustomerPassword, verifyCustomerPassword } from '../src/services/customer-credentials.service.js';
import { migrationConfigSchema } from '../src/config/migration-env.js';
import { CreditAccountingService } from '../src/services/credit-accounting.service.js';
import type { CreditAccountingModel } from '../src/models/credit-accounting.model.js';

test('TypeScript password verifier accepts the existing Python scrypt representation', async () => {
  const script = 'import hashlib,base64; salt=bytes(range(16)); digest=hashlib.scrypt("NXBooth-test-✓".encode(),salt=salt,n=16384,r=8,p=1); enc=lambda value:base64.urlsafe_b64encode(value).decode(); print("scrypt$16384$8$1$"+enc(salt)+"$"+enc(digest))';
  const legacy = execFileSync('python3', ['-c', script], { encoding: 'utf8' }).trim();
  assert.equal(await verifyCustomerPassword('NXBooth-test-✓', legacy), true);
  assert.equal(await verifyCustomerPassword('wrong-password', legacy), false);
});

test('new TypeScript password hashes remain verifiable by the original Python algorithm', async () => {
  const hash = await hashCustomerPassword('test-password-✓');
  const script = 'import sys,json,hashlib,base64,hmac; value=json.load(sys.stdin); scheme,n,r,p,salt,digest=value["hash"].split("$"); actual=hashlib.scrypt(value["password"].encode(),salt=base64.urlsafe_b64decode(salt),n=int(n),r=int(r),p=int(p)); print(hmac.compare_digest(actual,base64.urlsafe_b64decode(digest)))';
  assert.equal(execFileSync('python3', ['-c', script], { input: JSON.stringify({ password: 'test-password-✓', hash }), encoding: 'utf8' }).trim(), 'True');
});

test('cookie HMAC matches Python and rejects tampering and malformed values', () => {
  const signer = new CustomerCookieSigner('test-only-session-secret');
  const expected = execFileSync('python3', ['-c', 'import hmac,hashlib; print("test-session."+hmac.new(b"test-only-session-secret",b"test-session",hashlib.sha256).hexdigest())'], { encoding: 'utf8' }).trim();
  assert.equal(signer.sign('test-session'), expected);
  assert.equal(signer.unsign(expected), 'test-session');
  assert.equal(signer.unsign(expected.replace('test-session', 'different-session')), null);
  assert.equal(signer.unsign('invalid'), null);
  assert.equal(signer.unsign(expected.slice(0, -1)), null);
});

test('password verifier rejects malformed, unsupported and corrupt hashes without throwing', async () => {
  for (const hash of ['', 'not-a-hash', 'scrypt$1$8$1$salt$digest', 'other$16384$8$1$salt$digest']) assert.equal(await verifyCustomerPassword('password', hash), false);
});

test('native migration configuration requires stable production cookie secret', () => {
  const config = { DATABASE_URL: 'postgresql://test@localhost/nxbooth_express_test', NODE_ENV: 'production' };
  assert.equal(migrationConfigSchema.safeParse(config).success, false);
  assert.equal(migrationConfigSchema.parse({ ...config, SESSION_SECRET_KEY: 'test-only-secret' }).COOKIE_SECURE, true);
});

test('Every mode records a pending charge without charging before success; unknown modes fail before accounting', async () => {
  let calls = 0;
  const model = { async reserve() { calls++; return null; } } as unknown as CreditAccountingModel;
  const credits = new CreditAccountingService(model);
  const owner = { account_id: 'test-account', guest_id: null };
  await credits.reserve('CLASSIC', 'classic-job', owner);
  await credits.reserve('BASIC', 'basic-job', owner);
  assert.equal(calls, 2);
  assert.throws(() => credits.reserve('UNKNOWN', 'invalid-job', owner));
  await credits.reserve('ADVANCED', 'advanced-job', owner);
  assert.equal(calls, 3);
});
