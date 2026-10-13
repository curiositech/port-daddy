import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const ledgerUrl = new URL('../../docs/harbor-research/omni-ledger.json', import.meta.url);

export function readRetiredDocument(path) {
  const ledger = JSON.parse(readFileSync(ledgerUrl, 'utf8'));
  const source = ledger.sources.find((item) => item.path === path);
  assert.ok(source, `Omni source missing: ${path}`);
  assert.equal(source.disposition, 'retire', `Omni source is not retired: ${path}`);
  assert.equal(typeof source.text, 'string', `Omni source has no text: ${path}`);
  const digest = createHash('sha256').update(source.text, 'utf8').digest('hex');
  assert.equal(digest, source.text_sha256, `Omni source text hash drift: ${path}`);
  return source.text;
}
