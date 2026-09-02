import { describe, expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const research = 'docs/research/';
const censusPath = `${research}2026-09-02-delivery-census.json`;
const documentPaths = [
  `${research}2026-09-02-delivery-census.md`,
  `${research}2026-09-02-runtime-resilience-successor-findings.md`,
];

/**
 * Reject private material in this explicitly public, dated evidence export.
 * Purpose: publication has an allowlist, not a promise that a raw dump is safe.
 * Decoding also catches escaped paths/URLs before a renderer makes them links.
 * @param {string} text Candidate public text, never a live credential source.
 * @returns {void} Throws when the candidate violates the publication boundary.
 */
function checkPublicText(text) {
  let decoded = text;
  for (let pass = 0; pass < 3; pass += 1) {
    expect(decoded).not.toMatch(/(?:\/Users\/|\/home\/|[a-z]:[\\/]Users[\\/]|file:\/\/|~\/(?:\.codex|\.port-daddy))/i);
    expect(decoded).not.toMatch(/(?:gh[psu]_[A-Za-z0-9]{12,}|github_pat_[A-Za-z0-9_]{12,}|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----)/);
    for (const match of decoded.matchAll(/https?:\/\/[^\s<>"')]+/gi)) {
      const url = new URL(match[0]);
      expect(url.username).toBe('');
      expect(url.password).toBe('');
      expect(url.search).toBe('');
      expect(url.hash).not.toMatch(/(?:token|credential|signature|secret|authorization|^#t=)/i);
    }
    const next = decoded.replace(/%[0-9a-f]{2}/gi, value => String.fromCharCode(parseInt(value.slice(1), 16)));
    if (next === decoded) break;
    decoded = next;
  }
}

/**
 * Enforce exact object keys so new raw-note/request fields cannot slip through.
 * @param {object} value Candidate object.
 * @param {string[]} keys The intentionally published field names.
 * @returns {void} Throws on additions, omissions or non-object values.
 */
function exactKeys(value, keys) {
  expect(value).not.toBeNull();
  expect(Array.isArray(value)).toBe(false);
  expect(typeof value).toBe('object');
  expect(Object.keys(value).sort()).toEqual([...keys].sort());
}

/**
 * Check the small publication format against the actual committed derivative.
 * Purpose: retained evidence cannot turn into a roadmap writer or a raw archive.
 * @param {object} value Parsed publication candidate.
 * @returns {void} Throws on private/unknown fields or false authority boundaries.
 */
function checkCensus(value) {
  exactKeys(value, ['schemaVersion', 'kind', 'authority', 'sourceObservedAt', 'publicationObservedAt', 'sourceMain', 'publicationMain', 'sourceArtifacts', 'attribution', 'historicalPRs', 'mergedPRs', 'chartroomReceipt']);
  expect(value.schemaVersion).toBe(1);
  expect(value.kind).toBe('dated-evidence');
  expect(value.authority).toBe('none');
  for (const key of ['sourceObservedAt', 'publicationObservedAt']) expect(Number.isFinite(Date.parse(value[key]))).toBe(true);
  expect(Date.parse(value.publicationObservedAt)).toBeGreaterThan(Date.parse(value.sourceObservedAt));
  for (const key of ['sourceMain', 'publicationMain']) expect(value[key]).toMatch(/^[a-f0-9]{40}$/);
  expect(value.sourceArtifacts).toHaveLength(3);
  for (const source of value.sourceArtifacts) {
    exactKeys(source, ['name', 'sha256']);
    expect(source.name).toMatch(/^[a-z0-9-]+\.(?:md|json)$/);
    expect(source.sha256).toMatch(/^[a-f0-9]{64}$/);
  }
  exactKeys(value.attribution, ['auditorSessionId', 'publisherSessionId', 'supplementalNoteId']);
  for (const key of ['auditorSessionId', 'publisherSessionId']) expect(value.attribution[key]).toMatch(/^session-[a-z0-9-]+$/);
  expect(value.attribution.supplementalNoteId).toBe(22894);
  expect(value.historicalPRs.map(pr => pr.number)).toEqual([9970, 9989, 9992, 9993, 9995]);
  for (const pr of value.historicalPRs) {
    exactKeys(pr, ['number', 'url', 'publicHead', 'localHead', 'localOnlyCommitCount', 'unresolvedReviewThreads', 'state', 'isDraft', 'disposition']);
    expect(pr.url).toBe(`https://github.com/curiositech/port-daddy/pull/${pr.number}`);
    for (const key of ['publicHead', 'localHead']) expect(pr[key]).toMatch(/^[a-f0-9]{40}$/);
    expect(pr.state).toBe('OPEN');
    expect(typeof pr.isDraft).toBe('boolean');
    expect(typeof pr.disposition).toBe('string');
    expect(Number.isInteger(pr.localOnlyCommitCount)).toBe(true);
    expect(Number.isInteger(pr.unresolvedReviewThreads)).toBe(true);
    expect(pr.localOnlyCommitCount).toBeGreaterThanOrEqual(0);
    expect(pr.unresolvedReviewThreads).toBeGreaterThanOrEqual(0);
  }
  expect(value.mergedPRs.map(pr => pr.number)).toEqual([10002, 10003, 10004, 10005, 10006]);
  for (const pr of value.mergedPRs) {
    exactKeys(pr, ['number', 'url', 'head', 'mergeCommit', 'mergedAt', 'installedRuntimePromoted']);
    expect(pr.url).toBe(`https://github.com/curiositech/port-daddy/pull/${pr.number}`);
    expect(pr.head).toMatch(/^[a-f0-9]{40}$/);
    expect(pr.mergeCommit).toMatch(/^[a-f0-9]{40}$/);
    expect(Number.isFinite(Date.parse(pr.mergedAt))).toBe(true);
    expect(pr.installedRuntimePromoted).toBe(false);
  }
  exactKeys(value.chartroomReceipt, ['verification', 'spawnId', 'failureAt', 'elapsedMs', 'transcriptRecords', 'assistantRecords', 'toolCalls', 'claims', 'automaticFailureHandoffs', 'interruptId', 'interruptAcknowledged', 'interruptCausedFailure', 'registryChanged', 'unresolvedGates']);
  expect(value.chartroomReceipt.verification).toBe('manager-reported; not rerun by publisher');
  expect(value.chartroomReceipt.spawnId).toBe('spawned-a94f71bfda4a');
  expect(value.chartroomReceipt.failureAt).toBe('2026-09-02T15:01:46.867Z');
  expect(value.chartroomReceipt.interruptId).toBe(206087);
  expect(value.chartroomReceipt.unresolvedGates).toEqual(['wrong-world binding', 'startup transport', 'governed publisher']);
  expect(value.chartroomReceipt).toMatchObject({ elapsedMs: 1200126, transcriptRecords: 8, assistantRecords: 0, toolCalls: 0, claims: 0, automaticFailureHandoffs: 1, interruptAcknowledged: false, interruptCausedFailure: false, registryChanged: false });
  checkPublicText(JSON.stringify(value));
}

describe('dated delivery evidence publication', () => {
  test('committed JSON is a compact allowlisted derivative, not the private archive', () => {
    const text = readFileSync(join(root, censusPath), 'utf8');
    expect(Buffer.byteLength(text)).toBeLessThan(12000);
    checkCensus(JSON.parse(text));
  });

  test.each(documentPaths)('%s contains public links and no private machine paths', path => {
    const text = readFileSync(join(root, path), 'utf8');
    checkPublicText(text);
    expect(text).toContain('dated evidence');
    expect(text).toContain('not roadmap authority');
  });

  test.each([
    'https://relay.example/fleet/run?t=synthetic-signature',
    'https://github.example/report?access_token=synthetic',
    'HTTPS://EXAMPLE.TEST/report?access_token=synthetic',
    'https://user:synthetic@example.test/report',
    'https://example.test/report#token=synthetic',
    'https%3A%2F%2Fexample.test%2Freport%3Ft%3Dsynthetic',
    'https%253A%252F%252Fexample.test%252Freport%253Ft%253Dsynthetic',
    '/Users/synthetic/coding/private',
    '%2FUsers%2Fsynthetic%2Fprivate',
    '/home/synthetic/private',
    'C:\\Users\\synthetic\\private',
    'file:///synthetic/evidence',
    'ghp_syntheticcredential12345',
  ])('rejects private candidate %s', candidate => {
    expect(() => checkPublicText(candidate)).toThrow();
  });

  test('accepts a public source URL and a normal review anchor', () => {
    expect(() => checkPublicText('https://github.com/curiositech/port-daddy/pull/10006#issuecomment-5512075621')).not.toThrow();
  });

  test.each(['ownerNotes', 'ownerRequests', 'credential', 'worktree'])('rejects raw %s fields even with innocuous content', key => {
    const candidate = JSON.parse(readFileSync(join(root, censusPath), 'utf8'));
    candidate.historicalPRs[0][key] = 'synthetic';
    expect(() => checkCensus(candidate)).toThrow();
  });

  test('rejects promotion of the snapshot to an authority', () => {
    const candidate = JSON.parse(readFileSync(join(root, censusPath), 'utf8'));
    candidate.authority = 'canonical';
    expect(() => checkCensus(candidate)).toThrow();
  });

  test('rejects raw note objects nested inside an otherwise allowed field', () => {
    const candidate = JSON.parse(readFileSync(join(root, censusPath), 'utf8'));
    candidate.historicalPRs[0].disposition = { ownerNotes: ['synthetic'] };
    expect(() => checkCensus(candidate)).toThrow();
  });
});
