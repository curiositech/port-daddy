import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const content = readFileSync(
  new URL('../../docs/roadmap/whitepaper-research-program.md', import.meta.url),
  'utf8',
);
const heading = '### Publication receipt contract';
const start = content.indexOf(heading);
const nextHeading = content.indexOf('\n### ', start + heading.length);
const section = start >= 0 ? content.slice(start, nextHeading >= 0 ? nextHeading : undefined) : '';
const normalizedSection = section.replace(/\s+/gu, ' ');

const bullets = section
  .split('\n')
  .filter((line) => line.trimStart().startsWith('- '))
  .map((line) => line.trim().replace(/\s+/gu, ' '));

// This section is design prose in a living doc, and the original assertions
// pinned whole bullet texts and one 100-character sentence verbatim. That the
// author normalised whitespace first is the tell: re-wrapping was anticipated,
// rewording was not, and copy-editing a sentence is ordinary correct work.
//
// What the contract actually fixes is which values each receipt line must
// carry, so assert that per bullet: every clause below must be satisfied by
// exactly one bullet. Matching terms of art instead of sentences survives a
// reword, and scoping them to a single bullet keeps the check strict —
// asserting the terms against the whole section would let a bullet quietly
// drop `SHA-256` while the other bullet that also mentions it covered up.
const RECEIPT_CLAUSES = [
  { name: 'landed source', terms: [/source commit/iu, /edition/iu] },
  {
    name: 'collected volume',
    terms: [/route/iu, /page count/iu, /byte count/iu, /SHA-256/iu],
  },
  { name: 'each standalone paper', terms: [/route/iu, /SHA-256/iu, /standalone/iu] },
  {
    name: 'production deployment',
    terms: [/deployment identifier/iu, /verification timestamp/iu],
  },
];

// The disqualification clause is the load-bearing half of the contract: it is
// what stops a release being declared on a preview URL. Assert that each kind
// of non-production evidence is still named, and that the term of art it is
// being denied still exists — not the sentence that currently joins them.
const NON_RECEIPT_EVIDENCE = [/preview/iu, /local build/iu, /CI artifact/iu];

describe('whitepaper publication receipt contract', () => {
  it('is present exactly once', () => {
    assert.equal(content.split(heading).length - 1, 1);
    assert.ok(section.length > heading.length);
  });

  it('binds source, collected volume, every standalone, and deployment evidence', () => {
    for (const { name, terms } of RECEIPT_CLAUSES) {
      const matching = bullets.filter((bullet) => terms.every((term) => term.test(bullet)));
      assert.equal(
        matching.length,
        1,
        `exactly one receipt bullet must record ${name} (${terms.join(', ')}); found ${matching.length}`,
      );
    }
  });

  it('does not mistake preview or CI evidence for a production release', () => {
    assert.match(normalizedSection, /read back from production/iu);
    assert.match(normalizedSection, /match the landed artifacts/iu);

    for (const evidence of NON_RECEIPT_EVIDENCE) {
      assert.match(normalizedSection, evidence, `receipt contract stopped naming ${evidence}`);
    }
    assert.match(
      normalizedSection,
      /release receipt/iu,
      'receipt contract must still distinguish a release receipt from its evidence',
    );
  });
});
