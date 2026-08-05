import { test, expect } from 'vitest';
import { LIBRARY_CHANGELOG } from '../../website-v2/src/data/whitePapers';

test('Verify changelog entry for Chapter III is correct', () => {
  const entry = LIBRARY_CHANGELOG.find(e => e.chapters.includes('III'));
  expect(entry).toBeDefined();
  expect(entry!.summary).toContain('shipped local actor-soul and commitment substrates');
  expect(entry!.summary).toContain('still-open write-boundary, neutral-grading, reputation, and cross-operator-attestation obligations');
});