/**
 * Rent-note → changelog derivation. Locks the opt-in contract: a note files a
 * changelog entry ONLY via an explicit flag or an author-written Conventional-
 * Commit token — never by scanning prose. (Respects the no-keyword-NLP rule.)
 */

import { describe, test, expect } from '@jest/globals';
import { deriveChangelogFromNote, CHANGELOG_TYPES } from '../../lib/changelog-from-note.js';

describe('deriveChangelogFromNote — opt-in only', () => {
  test('a plain coordination note is NOT recorded', () => {
    const r = deriveChangelogFromNote({ content: 'Scope: refactoring the guard. Validation: tests.' });
    expect(r.record).toBe(false);
  });

  test('prose that merely mentions "fix" or "feature" is NOT recorded (no NLP)', () => {
    const r = deriveChangelogFromNote({
      content: 'I will fix the feature later but this is just a status update',
    });
    expect(r.record).toBe(false);
  });

  test('the --changelog flag opts a plain note in', () => {
    const r = deriveChangelogFromNote({ content: 'Added a Ledger pane', changelog: true });
    expect(r.record).toBe(true);
    expect(r.type).toBe('feature'); // default when no token/override
    expect(r.summary).toBe('Added a Ledger pane');
  });
});

describe('deriveChangelogFromNote — conventional tokens (author-controlled)', () => {
  test('"feat:" records a feature and strips the token from the summary', () => {
    const r = deriveChangelogFromNote({ content: 'feat: add the Ledger pane' });
    expect(r.record).toBe(true);
    expect(r.type).toBe('feature');
    expect(r.summary).toBe('add the Ledger pane');
  });

  test('"fix(scope):" records a fix and honors the scope syntax', () => {
    const r = deriveChangelogFromNote({ content: 'fix(guard): claim batch swallowed errors' });
    expect(r.record).toBe(true);
    expect(r.type).toBe('fix');
    expect(r.summary).toBe('claim batch swallowed errors');
  });

  test('a trailing "!" marks a breaking change', () => {
    const r = deriveChangelogFromNote({ content: 'feat!: rename pd orient → pd periscope' });
    expect(r.record).toBe(true);
    expect(r.type).toBe('breaking');
  });

  test('"breaking:" maps to breaking', () => {
    expect(deriveChangelogFromNote({ content: 'breaking: drop the v1 API' }).type).toBe('breaking');
  });

  test('perf/build/ci/test map to refactor/chore', () => {
    expect(deriveChangelogFromNote({ content: 'perf: memoize the resolver' }).type).toBe('refactor');
    expect(deriveChangelogFromNote({ content: 'ci: cache deps' }).type).toBe('chore');
    expect(deriveChangelogFromNote({ content: 'test: add rent cases' }).type).toBe('chore');
  });

  test('an unknown leading token is NOT a changelog note', () => {
    const r = deriveChangelogFromNote({ content: 'scope: files I will touch' });
    expect(r.record).toBe(false);
  });
});

describe('deriveChangelogFromNote — explicit type + body', () => {
  test('--type overrides the token mapping', () => {
    const r = deriveChangelogFromNote({ content: 'feat: x', type: 'fix' });
    expect(r.type).toBe('fix');
  });

  test('an invalid --type falls back to the token/default, never throws', () => {
    const r = deriveChangelogFromNote({ content: 'feat: x', type: 'nonsense' });
    expect(r.type).toBe('feature');
  });

  test('lines after the first become the description', () => {
    const r = deriveChangelogFromNote({ content: 'feat: add panes\n\nThe pane contract is render-agnostic.' });
    expect(r.summary).toBe('add panes');
    expect(r.description).toBe('The pane contract is render-agnostic.');
  });

  test('a single-line note has no description', () => {
    expect(deriveChangelogFromNote({ content: 'feat: x' }).description).toBeUndefined();
  });

  test('every produced type is a valid changelog type', () => {
    for (const c of ['feat: a', 'fix: b', 'breaking: c', 'docs: d', 'refactor: e', 'chore: f']) {
      expect(CHANGELOG_TYPES).toContain(deriveChangelogFromNote({ content: c }).type);
    }
  });
});
