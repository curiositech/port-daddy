import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const content = readFileSync(
  new URL('../../docs/recovery/UNIFIED-ROADMAP.md', import.meta.url),
  'utf8',
);

describe('unified roadmap Markdown integrity', () => {
  it('contains no accidentally committed patch syntax', () => {
    assert.doesNotMatch(content, /^index [0-9a-f]+\.\.[0-9a-f]+/mu);
    assert.doesNotMatch(content, /^\+\+\+ [ab]\//mu);
    assert.doesNotMatch(content, /^@@ .* @@/mu);
  });

  it('has balanced fenced code blocks', () => {
    const fences = content.match(/^```/gmu) ?? [];
    assert.equal(fences.length % 2, 0, 'every code fence must be closed');
  });

  it('keeps all level-two headings unique and Track 8 in the intended order', () => {
    const headings = [...content.matchAll(/^## (.+)$/gmu)].map((match) => match[1]);
    assert.equal(new Set(headings).size, headings.length, 'level-two headings must be unique');

    const trackIndex = headings.indexOf('Track 8: Coordination Papers Proof And Runtime Closure');
    const deferredIndex = headings.indexOf('Not Doing Right Now');
    const weeklyIndex = headings.indexOf('Weekly Recovery Test');
    assert.ok(trackIndex >= 0 && trackIndex < deferredIndex && deferredIndex < weeklyIndex);
  });
});
