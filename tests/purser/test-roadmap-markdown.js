import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const content = readFileSync(
  new URL('../../docs/recovery/UNIFIED-ROADMAP.md', import.meta.url),
  'utf8',
);
const heading = '## Track 8: Coordination Papers Proof And Runtime Closure';
const start = content.indexOf(heading);
const end = content.indexOf('\n## ', start + heading.length);
const section = start >= 0 ? content.slice(start, end >= 0 ? end : undefined) : '';

const count = (text, needle) => text.split(needle).length - 1;

describe('Coordination Papers roadmap track', () => {
  it('appears exactly once and before the deferred-work section', () => {
    assert.equal(count(content, heading), 1);
    assert.ok(start >= 0);
    assert.ok(start < content.indexOf('## Not Doing Right Now'));
  });

  it('links the canonical research program and all four registry items once', () => {
    assert.equal(
      count(section, '[`docs/roadmap/whitepaper-research-program.md`](../roadmap/whitepaper-research-program.md)'),
      1,
    );

    for (const slug of [
      'coordination-papers-mega-volume',
      'coordination-papers-proof-program',
      'coordination-papers-empirical-program',
      'coordination-papers-runtime-closure',
    ]) {
      assert.equal(count(section, `link:${slug}`), 1, `${slug} must be linked exactly once`);
    }
  });

  it('states the implementation priorities and production-only exit condition', () => {
    for (const phrase of [
      'reputation-grade outcome ledger',
      'complete actor-identity write gating',
      'execution-state checkpoints',
      'sealed relay',
      'federated revocation',
      'custody/settlement conformance',
      'projection consistency',
      'live library route',
      'production PDF hash and page count',
      'standalone artifact hashes',
      'source commit',
    ]) {
      assert.ok(section.includes(phrase), `missing Track 8 requirement: ${phrase}`);
    }
  });
});
