import { describe, expect, test, beforeEach, afterEach } from '@jest/globals';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  digestCandidateTree,
  validateReleaseDocReview,
  candidateFiles,
} from '../../scripts/check-release-doc-review.mjs';

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Create a minimal valid receipt for testing.
 * Can be mutated to test various failure modes.
 */
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
      argument:
        'The strongest opposing case is that the gate creates operational overhead without preventing real issues. ' +
        'However, the fail-closed semantics mean cost is paid once per release, not per incident.',
      disposition:
        'The candidate demonstrates this is acceptable via named daemon validation and cross-steelman ' +
        'that reviewers independently verified the proof artifacts match tree state.',
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

/**
 * Create a temporary test root with proof artifacts.
 */
function createTestRoot() {
  const scratch = join(homedir(), 'coding', 'tmp');
  mkdirSync(scratch, { recursive: true });
  return mkdtempSync(join(scratch, 'pd-release-test-'));
}

/**
 * Write proof artifacts to root and update receipt hashes.
 */
function installProofArtifacts(root, receipt) {
  const artifacts = receipt.proofArtifacts;
  for (const path of Object.keys(artifacts)) {
    const absolute = join(root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, `content:${path}`);
    artifacts[path] = createHash('sha256').update(`content:${path}`).digest('hex');
  }
}

// ============================================================================
// DIGEST TESTS
// ============================================================================

describe('digestCandidateTree', () => {
  let root;

  beforeEach(() => {
    root = createTestRoot();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test('produces stable digest for fixed files', () => {
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(join(root, 'AGENTS.md'), 'one\n');
    writeFileSync(join(root, 'docs', 'RELEASING.md'), 'two\n');
    const files = ['AGENTS.md', 'docs/RELEASING.md'];
    const digest1 = digestCandidateTree(root, files);
    const digest2 = digestCandidateTree(root, files);
    expect(digest1).toBe(digest2);
    expect(/^[0-9a-f]{64}$/.test(digest1)).toBe(true);
  });

  test('changes digest when file content changes', () => {
    const files = ['AGENTS.md'];
    writeFileSync(join(root, 'AGENTS.md'), 'original\n');
    const before = digestCandidateTree(root, files);
    writeFileSync(join(root, 'AGENTS.md'), 'modified\n');
    const after = digestCandidateTree(root, files);
    expect(before).not.toBe(after);
  });

  test('changes digest when file size changes', () => {
    const files = ['AGENTS.md'];
    writeFileSync(join(root, 'AGENTS.md'), 'a');
    const before = digestCandidateTree(root, files);
    writeFileSync(join(root, 'AGENTS.md'), 'ab');
    const after = digestCandidateTree(root, files);
    expect(before).not.toBe(after);
  });

  test('changes digest when file added to set', () => {
    writeFileSync(join(root, 'AGENTS.md'), 'one\n');
    const beforeDigest = digestCandidateTree(root, ['AGENTS.md']);
    writeFileSync(join(root, 'README.md'), 'two\n');
    const afterDigest = digestCandidateTree(root, ['AGENTS.md', 'README.md']);
    expect(beforeDigest).not.toBe(afterDigest);
  });

  test('respects file order deterministically (sorted)', () => {
    writeFileSync(join(root, 'a.txt'), 'a');
    writeFileSync(join(root, 'z.txt'), 'z');
    const digest1 = digestCandidateTree(root, ['a.txt', 'z.txt']);
    const digest2 = digestCandidateTree(root, ['z.txt', 'a.txt']);
    // Both should be the same because digestCandidateTree doesn't re-sort
    // (files come pre-sorted), but this documents the behavior.
    expect(digest1).toBe(digest2);
  });

  test('throws if candidate file is missing', () => {
    expect(() => digestCandidateTree(root, ['missing.txt'])).toThrow(/candidate file is missing/);
  });
});

// ============================================================================
// VALIDATION: SCHEMA & VERSIONING
// ============================================================================

describe('validateReleaseDocReview - schema & versioning', () => {
  test('passes valid receipt with all required fields', () => {
    const root = createTestRoot();
    try {
      const receipt = validReceipt('b'.repeat(64));
      installProofArtifacts(root, receipt);
      const errors = validateReleaseDocReview(receipt, {
        version: '3.28.0',
        candidateDigest: 'b'.repeat(64),
        root,
      });
      expect(errors).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('rejects schemaVersion !== 1', () => {
    const receipt = validReceipt('b'.repeat(64));
    receipt.schemaVersion = 2;
    const errors = validateReleaseDocReview(receipt, {
      version: '3.28.0',
      candidateDigest: 'b'.repeat(64),
    });
    expect(errors).toContainEqual(expect.stringContaining('schemaVersion must be 1'));
  });

  test('rejects mismatched release version', () => {
    const receipt = validReceipt('b'.repeat(64));
    receipt.release = 'v3.27.0';
    const errors = validateReleaseDocReview(receipt, {
      version: '3.28.0',
      candidateDigest: 'b'.repeat(64),
    });
    expect(errors).toContainEqual(expect.stringContaining('release must equal v3.28.0'));
  });

  test('rejects stale candidateDigest (fail-closed on tree edits)', () => {
    const receipt = validReceipt('a'.repeat(64));
    const errors = validateReleaseDocReview(receipt, {
      version: '3.28.0',
      candidateDigest: 'b'.repeat(64),
      root: join(homedir(), 'coding', 'tmp', 'missing-proof'),
    });
    expect(errors).toContainEqual(
      expect.stringContaining('candidateDigest does not match the current candidate tree')
    );
  });
});

// ============================================================================
// VALIDATION: MINOR DOCUMENTATION REVIEW
// ============================================================================

describe('validateReleaseDocReview - minorDocumentationReview', () => {
  test('requires agentId in minorDocumentationReview', () => {
    const receipt = validReceipt('b'.repeat(64));
    delete receipt.minorDocumentationReview.agentId;
    const errors = validateReleaseDocReview(receipt, {
      version: '3.28.0',
      candidateDigest: 'b'.repeat(64),
    });
    expect(errors).toContainEqual(
      expect.stringContaining('must record its Port Daddy agent ID')
    );
  });

  test('requires transcriptId in minorDocumentationReview', () => {
    const receipt = validReceipt('b'.repeat(64));
    delete receipt.minorDocumentationReview.transcriptId;
    const errors = validateReleaseDocReview(receipt, {
      version: '3.28.0',
      candidateDigest: 'b'.repeat(64),
    });
    expect(errors).toContainEqual(
      expect.stringContaining('must record its Port Daddy agent ID')
    );
  });

  test('requires minorDocumentationReview.candidateDigest to match', () => {
    const receipt = validReceipt('b'.repeat(64));
    receipt.minorDocumentationReview.candidateDigest = 'c'.repeat(64);
    const errors = validateReleaseDocReview(receipt, {
      version: '3.28.0',
      candidateDigest: 'b'.repeat(64),
    });
    expect(errors).toContainEqual(
      expect.stringContaining('minorDocumentationReview must bind the exact candidate tree')
    );
  });

  test('requires minorDocumentationReview.verdict === SHIP', () => {
    const receipt = validReceipt('b'.repeat(64));
    receipt.minorDocumentationReview.verdict = 'DO-NOT-SHIP';
    const errors = validateReleaseDocReview(receipt, {
      version: '3.28.0',
      candidateDigest: 'b'.repeat(64),
    });
    expect(errors).toContainEqual(
      expect.stringContaining('minorDocumentationReview verdict must be SHIP')
    );
  });
});

// ============================================================================
// VALIDATION: REVIEWED SURFACES
// ============================================================================

describe('validateReleaseDocReview - reviewedSurfaces', () => {
  test('requires all 5 canonical surfaces', () => {
    const receipt = validReceipt('b'.repeat(64));
    receipt.reviewedSurfaces = ['AGENTS.md', 'CLAUDE.md'];
    const errors = validateReleaseDocReview(receipt, {
      version: '3.28.0',
      candidateDigest: 'b'.repeat(64),
    });
    expect(errors.length).toBeGreaterThanOrEqual(3);
    expect(errors.some((e) => e.includes('README.md'))).toBe(true);
    expect(errors.some((e) => e.includes('port-daddy-agent-skill'))).toBe(true);
    expect(errors.some((e) => e.includes('port-daddy-internal-dev'))).toBe(true);
  });

  test('accepts all 5 surfaces reviewed', () => {
    const root = createTestRoot();
    try {
      const receipt = validReceipt('b'.repeat(64));
      installProofArtifacts(root, receipt);
      const errors = validateReleaseDocReview(receipt, {
        version: '3.28.0',
        candidateDigest: 'b'.repeat(64),
        root,
      });
      expect(errors.filter((e) => e.includes('reviewedSurfaces'))).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ============================================================================
// VALIDATION: PROOF ARTIFACTS
// ============================================================================

describe('validateReleaseDocReview - proofArtifacts', () => {
  test('rejects invalid SHA-256 digest format', () => {
    const receipt = validReceipt('b'.repeat(64));
    receipt.proofArtifacts['website-v2/public/demos/harness/harness-conformance-live.gif'] = 'not-hex';
    const errors = validateReleaseDocReview(receipt, {
      version: '3.28.0',
      candidateDigest: 'b'.repeat(64),
    });
    expect(errors).toContainEqual(
      expect.stringContaining('missing a valid SHA-256 digest')
    );
  });

  test('rejects proof artifact hash mismatch', () => {
    const root = createTestRoot();
    try {
      const receipt = validReceipt('b'.repeat(64));
      installProofArtifacts(root, receipt);
      receipt.proofArtifacts['website-v2/public/demos/harness/harness-conformance-live.gif'] =
        'f'.repeat(64);
      const errors = validateReleaseDocReview(receipt, {
        version: '3.28.0',
        candidateDigest: 'b'.repeat(64),
        root,
      });
      expect(errors).toContainEqual(
        expect.stringContaining('proof artifact hash does not match')
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('rejects missing proof artifact', () => {
    const root = createTestRoot();
    try {
      const receipt = validReceipt('b'.repeat(64));
      installProofArtifacts(root, receipt);
      rmSync(join(root, 'website-v2'), { recursive: true, force: true });
      const errors = validateReleaseDocReview(receipt, {
        version: '3.28.0',
        candidateDigest: 'b'.repeat(64),
        root,
      });
      expect(errors).toContainEqual(
        expect.stringContaining('proof artifact hash does not match')
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ============================================================================
// VALIDATION: REVIEWERS (4+ unique agents)
// ============================================================================

describe('validateReleaseDocReview - reviewers', () => {
  test('rejects fewer than 4 reviewers', () => {
    const receipt = validReceipt('b'.repeat(64));
    receipt.reviewers = receipt.reviewers.slice(0, 3);
    const errors = validateReleaseDocReview(receipt, {
      version: '3.28.0',
      candidateDigest: 'b'.repeat(64),
    });
    expect(errors).toContainEqual(
      expect.stringContaining('at least four unique Port Daddy reviewer agent IDs')
    );
  });

  test('rejects duplicate reviewer IDs (theater)', () => {
    const receipt = validReceipt('b'.repeat(64));
    receipt.reviewers = [receipt.reviewers[0], receipt.reviewers[0], receipt.reviewers[0], receipt.reviewers[0]];
    const errors = validateReleaseDocReview(receipt, {
      version: '3.28.0',
      candidateDigest: 'b'.repeat(64),
    });
    expect(errors).toContainEqual(
      expect.stringContaining('at least four unique Port Daddy reviewer agent IDs')
    );
  });

  test('rejects reviewer missing role', () => {
    const receipt = validReceipt('b'.repeat(64));
    delete receipt.reviewers[0].role;
    const errors = validateReleaseDocReview(receipt, {
      version: '3.28.0',
      candidateDigest: 'b'.repeat(64),
    });
    expect(errors).toContainEqual(
      expect.stringContaining('must have role, identity, and transcriptId')
    );
  });

  test('rejects reviewer missing identity', () => {
    const receipt = validReceipt('b'.repeat(64));
    delete receipt.reviewers[0].identity;
    const errors = validateReleaseDocReview(receipt, {
      version: '3.28.0',
      candidateDigest: 'b'.repeat(64),
    });
    expect(errors).toContainEqual(
      expect.stringContaining('must have role, identity, and transcriptId')
    );
  });

  test('rejects reviewer missing transcriptId', () => {
    const receipt = validReceipt('b'.repeat(64));
    delete receipt.reviewers[0].transcriptId;
    const errors = validateReleaseDocReview(receipt, {
      version: '3.28.0',
      candidateDigest: 'b'.repeat(64),
    });
    expect(errors).toContainEqual(
      expect.stringContaining('must have role, identity, and transcriptId')
    );
  });

  test('rejects invalid verdict', () => {
    const receipt = validReceipt('b'.repeat(64));
    receipt.reviewers[0].verdict = 'MAYBE';
    const errors = validateReleaseDocReview(receipt, {
      version: '3.28.0',
      candidateDigest: 'b'.repeat(64),
    });
    expect(errors).toContainEqual(
      expect.stringContaining('has invalid verdict')
    );
  });
});

// ============================================================================
// VALIDATION: CROSS-STEELMAN (3+ records from 3+ reviewers)
// ============================================================================

describe('validateReleaseDocReview - steelman', () => {
  test('rejects fewer than 3 steelman records', () => {
    const receipt = validReceipt('b'.repeat(64));
    receipt.steelman = receipt.steelman.slice(0, 2);
    const errors = validateReleaseDocReview(receipt, {
      version: '3.28.0',
      candidateDigest: 'b'.repeat(64),
    });
    expect(errors).toContainEqual(
      expect.stringContaining('at least three substantive cross-steelman records')
    );
  });

  test('rejects steelman from fewer than 3 unique reviewers', () => {
    const receipt = validReceipt('b'.repeat(64));
    receipt.steelman = [
      {
        reviewerAgentId: 'spawned-a',
        targetAgentId: 'spawned-b',
        argument: 'x'.repeat(40),
        disposition: 'y'.repeat(40),
      },
      {
        reviewerAgentId: 'spawned-a',
        targetAgentId: 'spawned-c',
        argument: 'x'.repeat(40),
        disposition: 'y'.repeat(40),
      },
      {
        reviewerAgentId: 'spawned-a',
        targetAgentId: 'spawned-d',
        argument: 'x'.repeat(40),
        disposition: 'y'.repeat(40),
      },
    ];
    const errors = validateReleaseDocReview(receipt, {
      version: '3.28.0',
      candidateDigest: 'b'.repeat(64),
    });
    expect(errors).toContainEqual(
      expect.stringContaining('must come from at least three different reviewers')
    );
  });

  test('rejects self-authored steelman (theater)', () => {
    const receipt = validReceipt('b'.repeat(64));
    receipt.steelman[0].targetAgentId = receipt.steelman[0].reviewerAgentId;
    const errors = validateReleaseDocReview(receipt, {
      version: '3.28.0',
      candidateDigest: 'b'.repeat(64),
    });
    expect(errors).toContainEqual(
      expect.stringContaining('cannot steelman itself')
    );
  });

  test('rejects steelman with insufficient argument text', () => {
    const receipt = validReceipt('b'.repeat(64));
    receipt.steelman[0].argument = 'too short';
    const errors = validateReleaseDocReview(receipt, {
      version: '3.28.0',
      candidateDigest: 'b'.repeat(64),
    });
    expect(errors).toContainEqual(
      expect.stringContaining('must have substantive argument')
    );
  });

  test('rejects steelman with insufficient disposition text', () => {
    const receipt = validReceipt('b'.repeat(64));
    receipt.steelman[0].disposition = 'too short';
    const errors = validateReleaseDocReview(receipt, {
      version: '3.28.0',
      candidateDigest: 'b'.repeat(64),
    });
    expect(errors).toContainEqual(
      expect.stringContaining('must have substantive')
    );
  });

  test('rejects steelman referencing non-existent reviewer', () => {
    const receipt = validReceipt('b'.repeat(64));
    receipt.steelman[0].reviewerAgentId = 'unknown-reviewer';
    const errors = validateReleaseDocReview(receipt, {
      version: '3.28.0',
      candidateDigest: 'b'.repeat(64),
    });
    expect(errors).toContainEqual(
      expect.stringContaining('must both name recorded reviewers')
    );
  });
});

// ============================================================================
// VALIDATION: SYNTHESIS (final SHIP)
// ============================================================================

describe('validateReleaseDocReview - synthesis', () => {
  test('rejects synthesis.agentId not in reviewers', () => {
    const receipt = validReceipt('b'.repeat(64));
    receipt.synthesis.agentId = 'unknown-agent';
    const errors = validateReleaseDocReview(receipt, {
      version: '3.28.0',
      candidateDigest: 'b'.repeat(64),
    });
    expect(errors).toContainEqual(
      expect.stringContaining('synthesis.agentId must name one of the recorded reviewers')
    );
  });

  test('rejects synthesis verdict !== SHIP', () => {
    const receipt = validReceipt('b'.repeat(64));
    receipt.synthesis.verdict = 'SHIP-AFTER-FIX';
    const errors = validateReleaseDocReview(receipt, {
      version: '3.28.0',
      candidateDigest: 'b'.repeat(64),
    });
    expect(errors).toContainEqual(
      expect.stringContaining('synthesis verdict must be SHIP')
    );
  });

  test('rejects synthesis.blockers !== []', () => {
    const receipt = validReceipt('b'.repeat(64));
    receipt.synthesis.blockers = ['blocker1'];
    const errors = validateReleaseDocReview(receipt, {
      version: '3.28.0',
      candidateDigest: 'b'.repeat(64),
    });
    expect(errors).toContainEqual(
      expect.stringContaining('must be an empty array')
    );
  });

  test('rejects synthesis.blockers === null or undefined', () => {
    const receipt = validReceipt('b'.repeat(64));
    receipt.synthesis.blockers = undefined;
    const errors = validateReleaseDocReview(receipt, {
      version: '3.28.0',
      candidateDigest: 'b'.repeat(64),
    });
    expect(errors).toContainEqual(
      expect.stringContaining('must be an empty array')
    );
  });
});

// ============================================================================
// VALIDATION: NAMED FEATURE DAEMON
// ============================================================================

describe('validateReleaseDocReview - namedFeatureDaemon', () => {
  test('rejects daemon version mismatch', () => {
    const receipt = validReceipt('b'.repeat(64));
    receipt.namedFeatureDaemon.version = '3.27.0';
    const errors = validateReleaseDocReview(receipt, {
      version: '3.28.0',
      candidateDigest: 'b'.repeat(64),
    });
    expect(errors).toContainEqual(
      expect.stringContaining('namedFeatureDaemon.version must match release version')
    );
  });

  test('rejects daemon with stable label', () => {
    const receipt = validReceipt('b'.repeat(64));
    receipt.namedFeatureDaemon.label = 'stable';
    const errors = validateReleaseDocReview(receipt, {
      version: '3.28.0',
      candidateDigest: 'b'.repeat(64),
    });
    expect(errors).toContainEqual(
      expect.stringContaining('must not be "stable"')
    );
  });

  test('rejects daemon missing label', () => {
    const receipt = validReceipt('b'.repeat(64));
    delete receipt.namedFeatureDaemon.label;
    const errors = validateReleaseDocReview(receipt, {
      version: '3.28.0',
      candidateDigest: 'b'.repeat(64),
    });
    expect(errors).toContainEqual(
      expect.stringContaining('must be a non-stable feature branch name')
    );
  });

  test('rejects daemon URL not loopback', () => {
    const receipt = validReceipt('b'.repeat(64));
    receipt.namedFeatureDaemon.url = 'http://localhost:3174';
    const errors = validateReleaseDocReview(receipt, {
      version: '3.28.0',
      candidateDigest: 'b'.repeat(64),
    });
    expect(errors).toContainEqual(
      expect.stringContaining('must be an explicit loopback URL')
    );
  });

  test('rejects daemon URL with wrong IP', () => {
    const receipt = validReceipt('b'.repeat(64));
    receipt.namedFeatureDaemon.url = 'http://192.168.1.1:3174';
    const errors = validateReleaseDocReview(receipt, {
      version: '3.28.0',
      candidateDigest: 'b'.repeat(64),
    });
    expect(errors).toContainEqual(
      expect.stringContaining('must be an explicit loopback URL')
    );
  });

  test('rejects daemon URL with invalid port', () => {
    const receipt = validReceipt('b'.repeat(64));
    receipt.namedFeatureDaemon.url = 'http://127.0.0.1:bad-port';
    const errors = validateReleaseDocReview(receipt, {
      version: '3.28.0',
      candidateDigest: 'b'.repeat(64),
    });
    expect(errors).toContainEqual(
      expect.stringContaining('must be an explicit loopback URL')
    );
  });

  test('rejects daemon binarySha256 invalid format', () => {
    const receipt = validReceipt('b'.repeat(64));
    receipt.namedFeatureDaemon.binarySha256 = 'not-hex';
    const errors = validateReleaseDocReview(receipt, {
      version: '3.28.0',
      candidateDigest: 'b'.repeat(64),
    });
    expect(errors).toContainEqual(
      expect.stringContaining('must be a valid SHA-256 digest')
    );
  });

  test('accepts valid daemon configuration', () => {
    const root = createTestRoot();
    try {
      const receipt = validReceipt('b'.repeat(64));
      installProofArtifacts(root, receipt);
      const errors = validateReleaseDocReview(receipt, {
        version: '3.28.0',
        candidateDigest: 'b'.repeat(64),
        root,
      });
      expect(errors.filter((e) => e.includes('daemon'))).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ============================================================================
// INTEGRATION: REAL-WORLD SCENARIOS
// ============================================================================

describe('validateReleaseDocReview - integration scenarios', () => {
  test('accepts complete valid receipt with all requirements', () => {
    const root = createTestRoot();
    try {
      const receipt = validReceipt('b'.repeat(64));
      installProofArtifacts(root, receipt);
      const errors = validateReleaseDocReview(receipt, {
        version: '3.28.0',
        candidateDigest: 'b'.repeat(64),
        root,
      });
      expect(errors).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('rejects kitchen-sink failure (multiple independent errors)', () => {
    const receipt = validReceipt('a'.repeat(64)); // wrong digest
    receipt.schemaVersion = 2; // wrong schema
    receipt.reviewers = receipt.reviewers.slice(0, 2); // too few
    receipt.steelman = []; // no steelmans
    receipt.synthesis.verdict = 'DO-NOT-SHIP'; // wrong verdict
    receipt.namedFeatureDaemon.label = 'stable'; // wrong daemon
    const errors = validateReleaseDocReview(receipt, {
      version: '3.28.0',
      candidateDigest: 'b'.repeat(64),
      root: join(homedir(), 'coding', 'tmp', 'missing'),
    });
    expect(errors.length).toBeGreaterThanOrEqual(6);
    expect(errors.some((e) => e.includes('schemaVersion'))).toBe(true);
    expect(errors.some((e) => e.includes('candidateDigest does not match'))).toBe(true);
    expect(errors.some((e) => e.includes('four unique'))).toBe(true);
    expect(errors.some((e) => e.includes('three substantive cross-steelman'))).toBe(true);
    expect(errors.some((e) => e.includes('synthesis verdict must be SHIP'))).toBe(true);
    expect(errors.some((e) => e.includes('stable'))).toBe(true);
  });

  test('handles missing daemon gracefully', () => {
    const receipt = validReceipt('b'.repeat(64));
    delete receipt.namedFeatureDaemon;
    const errors = validateReleaseDocReview(receipt, {
      version: '3.28.0',
      candidateDigest: 'b'.repeat(64),
    });
    expect(errors).toContainEqual(
      expect.stringContaining('namedFeatureDaemon must be present')
    );
  });

  test('handles null receipt gracefully', () => {
    const errors = validateReleaseDocReview(null, {
      version: '3.28.0',
      candidateDigest: 'b'.repeat(64),
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  test('handles empty reviewers array', () => {
    const receipt = validReceipt('b'.repeat(64));
    receipt.reviewers = [];
    const errors = validateReleaseDocReview(receipt, {
      version: '3.28.0',
      candidateDigest: 'b'.repeat(64),
    });
    expect(errors).toContainEqual(
      expect.stringContaining('at least four unique Port Daddy reviewer agent IDs')
    );
  });

  test('handles empty steelman array', () => {
    const receipt = validReceipt('b'.repeat(64));
    receipt.steelman = [];
    const errors = validateReleaseDocReview(receipt, {
      version: '3.28.0',
      candidateDigest: 'b'.repeat(64),
    });
    expect(errors).toContainEqual(
      expect.stringContaining('at least three substantive cross-steelman')
    );
  });
});
