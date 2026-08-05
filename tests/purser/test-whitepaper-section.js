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

describe('whitepaper publication receipt contract', () => {
  it('is present exactly once', () => {
    assert.equal(content.split(heading).length - 1, 1);
    assert.ok(section.length > heading.length);
  });

  it('binds source, collected volume, every standalone, and deployment evidence', () => {
    for (const requirement of [
      'landed source commit and volume edition',
      'mega-volume route, page count, byte count, and SHA-256 digest',
      'route and SHA-256 digest of each of the seven standalone papers',
      'production library deployment identifier and verification timestamp',
    ]) {
      assert.ok(section.includes(requirement), `missing receipt requirement: ${requirement}`);
    }
  });

  it('does not mistake preview or CI evidence for a production release', () => {
    assert.ok(normalizedSection.includes('read back from production'));
    assert.ok(normalizedSection.includes('match the landed artifacts'));
    assert.ok(
      normalizedSection.includes('A preview URL, local build, or CI artifact is evidence for the release, but is not the release receipt.'),
    );
  });
});
