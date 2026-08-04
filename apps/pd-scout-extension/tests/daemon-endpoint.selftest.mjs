import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../daemon-endpoint.js', import.meta.url), 'utf8');
const context = vm.createContext({ URL });
vm.runInContext(source, context, { filename: 'daemon-endpoint.js' });

const { MISSING_ENDPOINT_MESSAGE, normalizePublishedEndpoint } = context.PortDaddyScoutEndpoint;

assert.equal(normalizePublishedEndpoint(' http://127.0.0.1:4319/ '), 'http://127.0.0.1:4319');
assert.equal(normalizePublishedEndpoint('http://localhost:3174'), 'http://localhost:3174');
assert.throws(() => normalizePublishedEndpoint(''), new RegExp(MISSING_ENDPOINT_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
assert.throws(() => normalizePublishedEndpoint('http://127.0.0.1'), /explicit port/);
assert.throws(() => normalizePublishedEndpoint('https://127.0.0.1:4319'), /local HTTP endpoint/);
assert.throws(() => normalizePublishedEndpoint('http://example.com:4319'), /local HTTP endpoint/);
assert.throws(() => normalizePublishedEndpoint('http://127.0.0.1:4319/health'), /must be an origin/);

for (const relative of ['../background.js', '../popup.js', '../popup.html']) {
  const runtimeSource = readFileSync(new URL(relative, import.meta.url), 'utf8');
  assert.doesNotMatch(runtimeSource, /(?:localhost|127\.0\.0\.1):9876/);
}

console.log('Scout daemon endpoint selftest passed');
