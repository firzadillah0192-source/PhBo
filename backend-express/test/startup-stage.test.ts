import assert from 'node:assert/strict';
import test from 'node:test';
import { failedStage, startupStage } from '../src/lib/startup-stage.js';

test('startupStage returns the value of a successful step', async () => {
  assert.equal(await startupStage('storage', async () => 42), 42);
});

test('startupStage names the failed step and hides the original message', async () => {
  const error = await startupStage('storage', async () => { throw new Error('connect ECONNREFUSED postgres://user:secret@host'); }).catch(e => e);
  assert.equal(failedStage(error), 'storage');
  assert.doesNotMatch(String(error.message), /secret|ECONNREFUSED/);
});

test('failedStage reports unknown for unrelated errors', () => {
  assert.equal(failedStage(new Error('x')), 'unknown');
});
