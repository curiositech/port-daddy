import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

test('static preview permits only its exact inline script bytes', () => {
  const html = readFileSync(new URL('../../../design/egosystem-reconciliation/index.html', import.meta.url), 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1);
  const policy = html.match(/script-src ([^;]+)/)[1];
  const digest = bytes => createHash('sha256').update(bytes).digest('base64');
  assert.equal(policy, `'sha256-${digest(scripts[0][1])}'`);
  assert.notEqual(policy, `'sha256-${digest(scripts[0][1] + '\nalert(1);')}'`);
  assert.ok(!policy.includes('unsafe-inline'));
});
