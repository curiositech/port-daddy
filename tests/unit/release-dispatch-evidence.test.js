import { describe, expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import {
  RELEASE_ARCHIVES,
  verifyReleaseDispatchEvidence,
} from '../../scripts/verify-release-dispatch-evidence.mjs';

const candidateSha = 'a'.repeat(40);
const version = 'v3.28.0';
const releaseWorkflow = readFileSync(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8');

function completeImprints() {
  return Object.fromEntries(RELEASE_ARCHIVES.map(({ archive, imprint }, index) => [imprint, {
    version: 2,
    sourceCommit: candidateSha,
    releaseVersion: version,
    missingRequired: [],
    archives: [{
      name: archive,
      bytes: 1_000 + index,
      sha256: String(index + 1).repeat(64),
    }],
  }]));
}

describe('release-to-tap dispatch evidence', () => {
  test('extracts candidate-bound archive digests from complete Batten imprints', () => {
    expect(verifyReleaseDispatchEvidence({
      version,
      candidateSha,
      imprints: completeImprints(),
    })).toEqual({
      version,
      candidate_sha: candidateSha,
      darwin_archive_sha256: '1'.repeat(64),
      linux_archive_sha256: '2'.repeat(64),
    });
  });

  test.each([
    ['wrong candidate', (imprints) => { imprints['pd-darwin-arm64-imprint.json'].sourceCommit = 'b'.repeat(40); }],
    ['wrong tag', (imprints) => { imprints['pd-linux-x64-imprint.json'].releaseVersion = 'v3.27.0'; }],
    ['incomplete cargo', (imprints) => { imprints['pd-darwin-arm64-imprint.json'].missingRequired = ['daemon']; }],
    ['wrong archive', (imprints) => { imprints['pd-linux-x64-imprint.json'].archives[0].name = 'other.tar.gz'; }],
    ['invalid digest', (imprints) => { imprints['pd-darwin-arm64-imprint.json'].archives[0].sha256 = 'nope'; }],
  ])('fails closed for %s', (_label, mutate) => {
    const imprints = completeImprints();
    mutate(imprints);
    expect(() => verifyReleaseDispatchEvidence({ version, candidateSha, imprints }))
      .toThrow('release dispatch evidence rejected');
  });

  test('rejects prerelease tags on the Homebrew dispatch path', () => {
    expect(() => verifyReleaseDispatchEvidence({
      version: 'v3.28.0-rc.1',
      candidateSha,
      imprints: completeImprints(),
    })).toThrow('exact stable v-prefixed release tag');
  });

  test('release workflow dispatches every verified evidence field', () => {
    expect(releaseWorkflow).toContain('node scripts/verify-release-dispatch-evidence.mjs');
    expect(releaseWorkflow).toContain('--candidate-sha "$CANDIDATE_SHA"');
    expect(releaseWorkflow).toContain('"candidate_sha":"${{ steps.evidence.outputs.candidate_sha }}"');
    expect(releaseWorkflow).toContain('"darwin_archive_sha256":"${{ steps.evidence.outputs.darwin_archive_sha256 }}"');
    expect(releaseWorkflow).toContain('"linux_archive_sha256":"${{ steps.evidence.outputs.linux_archive_sha256 }}"');
    expect(releaseWorkflow).not.toContain('client-payload: \'{"version": "${{ steps.release.outputs.version }}"}\'');
  });
});
