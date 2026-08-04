import { describe, expect, test } from '@jest/globals';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  digestCandidateTree,
  validateReleaseDocReview,
} from '../../scripts/check-release-doc-review.mjs';

function validReceipt(candidateDigest) {
  const reviewers = ['a', 'b', 'c', 'd'].map((suffix) => ({
    agentId: `spawned-${suffix}`,
    identity: `port-daddy:docs:${suffix}`,
    role: `reviewer-${suffix}`,
    transcriptId: `transcript-${suffix}`,
    verdict: 'SHIP',
  }));
  return {
    schemaVersion: 1,
    release: 'v3.28.0',
    candidateDigest,
    minorDocumentationReview: {
      agentId: 'spawned-a',
      transcriptId: 'transcript-a',
      candidateDigest,
      verdict: 'SHIP',
    },
    reviewedSurfaces: [
      'AGENTS.md',
      'CLAUDE.md',
      'README.md',
      'skills/port-daddy-agent-skill/SKILL.md',
      'skills/port-daddy-internal-dev/SKILL.md',
    ],
    proofArtifacts: {
      'website-v2/public/demos/harness/harness-conformance-live.gif': '1'.repeat(64),
      'website-v2/public/demos/harness/harness-conformance-live-dark.gif': '2'.repeat(64),
      'website-v2/public/demos/harness/harness-attention-activation.gif': '3'.repeat(64),
      'website-v2/public/demos/harness/harness-attention-activation-dark.gif': '4'.repeat(64),
    },
    reviewers,
    steelman: [
      ['a', 'b'], ['b', 'c'], ['c', 'a'],
    ].map(([author, target]) => ({
      reviewerAgentId: `spawned-${author}`,
      targetAgentId: `spawned-${target}`,
      argument: 'The strongest opposing case is concrete and grounded in the candidate tree.',
      disposition: 'The candidate addresses that case with a deterministic gate and focused proof.',
    })),
    synthesis: { agentId: 'spawned-d', verdict: 'SHIP', blockers: [] },
    namedFeatureDaemon: {
      label: 'squid-3-28-feature',
      version: '3.28.0',
      url: 'http://127.0.0.1:3174',
      binarySha256: 'a'.repeat(64),
    },
  };
}

describe('release instruction review gate', () => {
  test('candidate digest changes when any reviewed tree byte changes', () => {
    const scratch = join(homedir(), 'coding', 'tmp');
    mkdirSync(scratch, { recursive: true });
    const root = mkdtempSync(join(scratch, 'pd-release-review-'));
    try {
      mkdirSync(join(root, 'docs'), { recursive: true });
      writeFileSync(join(root, 'AGENTS.md'), 'one\n');
      writeFileSync(join(root, 'docs', 'RELEASING.md'), 'two\n');
      const files = ['AGENTS.md', 'docs/RELEASING.md'];
      const before = digestCandidateTree(root, files);
      writeFileSync(join(root, 'AGENTS.md'), 'changed\n');
      expect(digestCandidateTree(root, files)).not.toBe(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('accepts four unique reviewers, three cross-steelmans, and a named daemon', () => {
    const root = mkdtempSync(join(homedir(), 'coding', 'tmp', 'pd-release-proof-'));
    try {
      const receipt = validReceipt('b'.repeat(64));
      for (const path of Object.keys(receipt.proofArtifacts)) {
        const absolute = join(root, path);
        mkdirSync(dirname(absolute), { recursive: true });
        writeFileSync(absolute, path);
        receipt.proofArtifacts[path] = createHash('sha256').update(path).digest('hex');
      }
      expect(validateReleaseDocReview(receipt, {
        version: '3.28.0',
        candidateDigest: 'b'.repeat(64),
        root,
      })).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('fails stale tree digests and self-authored theater', () => {
    const receipt = validReceipt('b'.repeat(64));
    receipt.reviewers = [receipt.reviewers[0], receipt.reviewers[0], receipt.reviewers[0], receipt.reviewers[0]];
    receipt.steelman[0].targetAgentId = receipt.steelman[0].reviewerAgentId;
    const errors = validateReleaseDocReview(receipt, {
      version: '3.28.0',
      candidateDigest: 'c'.repeat(64),
      root: join(homedir(), 'coding', 'tmp', 'missing-proof-root'),
    });
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining('candidateDigest'),
      expect.stringContaining('minorDocumentationReview'),
      expect.stringContaining('four unique'),
      expect.stringContaining('cannot steelman itself'),
      expect.stringContaining('proof artifact hash'),
    ]));
  });
});
