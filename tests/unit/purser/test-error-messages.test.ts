// Purser contract obligation 6/10 (PR #8889): the skill-index embedder's gate
// error must name BOTH remediation paths (the prefetch script and the opt-in
// env var), and the shipwright loader must enforce the same egress policy as
// the semantic resolver. Repaired in place per the purser stack protocol: the
// original authoring omitted every import and called a two-argument
// `createSkillIndex(db, {cacheDir})` that does not exist (options-object only)
// while asserting the throw at construction time — the gate is in the LAZY
// embedder, so the rejection surfaces on the first operation that embeds.
import { expect, test } from '@jest/globals';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { ALLOW_MODEL_DOWNLOAD_ENV } from '../../../lib/semantic-resolver.js';
import { createSkillIndex } from '../../../lib/shipwright/skill-index.js';

test('skill index embedder error message names prefetch and opt-in', async () => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'pd-egress-gate-'));
  const db = new Database(':memory:');
  // No injected embedder → the lazy MiniLM loader runs the egress gate on the
  // first embed. An empty cache with no opt-in must reject before any import
  // of @huggingface/transformers.
  const index = createSkillIndex({ db, cacheDir });
  const entry = {
    skillId: 'purser/contract-probe',
    name: 'contract probe',
    description: 'probe entry so index() must embed',
    contentHash: 'deadbeefdeadbeef',
  };
  await expect(index.index([entry])).rejects.toThrow(/Prefetch it while online/);
  await expect(index.index([entry])).rejects.toThrow(new RegExp(ALLOW_MODEL_DOWNLOAD_ENV));
  db.close();
});
