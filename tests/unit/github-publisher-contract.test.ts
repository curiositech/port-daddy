import { describe, expect, test } from '@jest/globals';
import {
  FLEETBOT_ACTION_SCHEMA,
  FLEETBOT_RECEIPT_READ_SCHEMA,
  FLEETBOT_RECEIPT_RECOVERY_PATH,
  fleetbotIdempotencyPreimage,
  fleetbotReceiptReadProofPreimage,
  fleetbotReceiptRecoveryBindingPreimage,
  fleetbotReceiptPreimage,
  roadmapTrailers,
  stampFleetbotMessage,
  stampPullRequestBody,
  validateRoadmapTrailer,
  type FleetbotActionRequest,
  type FleetbotAuthorship,
  type FleetbotReceiptReadProof,
} from '../../lib/github-publisher-contract.js';

const authorship: FleetbotAuthorship = {
  actorId: '01ACTOR',
  agentId: 'agent-publisher',
  sessionId: 'session-publisher',
  purpose: 'Publish a tested fix',
  identityProject: 'port-daddy',
  roadmapItem: 'provable-action-adjudicator',
  sidequestReason: null,
  worktreeId: 'worktree-1',
  sourceBranch: 'codex/fix',
};

describe('Fleetbot publisher contract', () => {
  test('domain-separates recovery bindings and read proofs from mutation capabilities', () => {
    const binding = {
      grantId: `pdg_${'1'.repeat(32)}`,
      grantEpoch: 2,
      repository: 'curiositech/port-daddy',
      operation: 'pull-request.enqueue' as const,
      baseBranch: 'main',
      baseSha: '2'.repeat(40),
      headSha: '3'.repeat(40),
      sessionId: 'session-publisher',
      requestHash: '4'.repeat(64),
      idempotencyKey: 'pd-gh-recovery-test',
    };
    const proof: FleetbotReceiptReadProof = {
      schema: FLEETBOT_RECEIPT_READ_SCHEMA,
      method: 'POST',
      path: FLEETBOT_RECEIPT_RECOVERY_PATH,
      daemonFingerprint: '5'.repeat(64),
      signingKeyGeneration: 3,
      issuedAt: 1_800_000_000,
      nonce: '6'.repeat(64),
      binding,
    };
    expect(fleetbotReceiptRecoveryBindingPreimage(binding)).toContain('"grantId":"pdg_');
    expect(fleetbotReceiptReadProofPreimage(proof)).toContain(FLEETBOT_RECEIPT_READ_SCHEMA);
    expect(fleetbotReceiptReadProofPreimage(proof)).toContain(
      fleetbotReceiptRecoveryBindingPreimage(binding).slice(1, -1),
    );
    expect(fleetbotReceiptReadProofPreimage(proof)).not.toContain('fleetbot-publisher-capability');
  });

  test('canonicalizes nested objects without changing array order', () => {
    const left: FleetbotActionRequest = {
      schema: FLEETBOT_ACTION_SCHEMA,
      operation: 'pull-request.publish',
      repository: 'curiositech/port-daddy',
      sessionId: authorship.sessionId,
      authorship,
      payload: { z: 2, nested: { b: 2, a: 1 }, files: ['b', 'a'] },
      capability: {
        schema: 'port-daddy.fleetbot-publisher-capability.v2',
        grantId: `pdg_${'1'.repeat(32)}`,
        grantEpoch: 1,
        daemonFingerprint: '2'.repeat(64),
        signingKeyGeneration: 1,
        sessionId: authorship.sessionId,
        repository: 'curiositech/port-daddy',
        operation: 'pull-request.publish',
        baseBranch: 'main',
        baseSha: '3'.repeat(40),
        headSha: '4'.repeat(40),
        requestHash: '5'.repeat(64),
        issuedAt: 1,
        expiresAt: 2,
        nonce: '6'.repeat(64),
      },
      capabilitySignature: '7'.repeat(128),
    };
    const right = {
      ...left,
      payload: { files: ['b', 'a'], nested: { a: 1, b: 2 }, z: 2 },
    };
    expect(fleetbotIdempotencyPreimage(left)).toBe(fleetbotIdempotencyPreimage(right));
  });

  test('requires exactly one trailer matching daemon-stored roadmap rent', () => {
    expect(validateRoadmapTrailer(
      '## Summary\nGood fix.\n\nRoadmap-Item: provable-action-adjudicator',
      authorship,
    )).toBeNull();
    expect(validateRoadmapTrailer(
      'Roadmap-Item: other\nRoadmap-Item: provable-action-adjudicator',
      authorship,
    )?.code).toBe('ROADMAP_TRAILER_INVALID');
    expect(validateRoadmapTrailer('Roadmap-Item: other', authorship)?.code)
      .toBe('ROADMAP_OWNERSHIP_MISMATCH');
  });

  test('sidequests require a specific opt-out rather than a claimed slug', () => {
    const sidequest = { ...authorship, roadmapItem: null, sidequestReason: 'Deterministic fixture hotfix only' };
    expect(validateRoadmapTrailer(
      'Roadmap-Item: none — deterministic fixture hotfix only',
      sidequest,
    )).toBeNull();
    expect(validateRoadmapTrailer('Roadmap-Item: none — tiny', sidequest)?.code)
      .toBe('ROADMAP_OPT_OUT_INVALID');
    expect(validateRoadmapTrailer(
      'Roadmap-Item: none — a different specific hotfix reason',
      sidequest,
    )?.code).toBe('ROADMAP_OPT_OUT_INVALID');
  });

  test('stamps PR bodies visibly before the sole roadmap trailer and is idempotent', () => {
    const body = '## Summary\nA complete fix.\n\nRoadmap-Item: provable-action-adjudicator\n';
    const once = stampPullRequestBody({ body, authorship, receiptId: 'receipt-1', sourceHeadSha: 'a'.repeat(40) });
    const twice = stampPullRequestBody({ body: once, authorship, receiptId: 'receipt-1', sourceHeadSha: 'a'.repeat(40) });
    expect(twice).toBe(once);
    expect(roadmapTrailers(once)).toEqual(['provable-action-adjudicator']);
    expect(once.indexOf('Published by Port Daddy Fleetbot')).toBeLessThan(once.indexOf('Roadmap-Item:'));
    expect(once).toContain('agent-publisher');
    expect(once).toContain('session-publisher');
  });

  test('stamps comments with verified-dispatcher and supplied-label provenance', () => {
    const stamped = stampFleetbotMessage({ body: 'Addressed the review.', authorship, receiptId: 'receipt-2' });
    expect(stamped).toContain('Addressed the review.');
    expect(stamped).toContain('Verified dispatcher: `01ACTOR`');
    expect(stamped).toContain('Dispatcher-supplied agent label: `agent-publisher`');
    expect(stamped).toContain('Dispatcher-supplied session label: `session-publisher`');
    expect(stamped).toContain('Relay receipt: `receipt-2`');
  });

  test('signs a receipt preimage that excludes only the signature', () => {
    const receipt = {
      schema: 'port-daddy.fleetbot-receipt.v1' as const,
      receiptId: 'github_receipt_abc',
      authority: 'port-daddy-relay-github-app' as const,
      appSlug: 'port-daddy',
      operation: 'pull-request.enqueue' as const,
      repository: 'curiositech/port-daddy',
      idempotencyKey: 'pd-gh-abc',
      accountUserId: 'user-1',
      accountGithubUserId: 42,
      actorId: authorship.actorId,
      agentId: authorship.agentId,
      sessionId: authorship.sessionId,
      roadmapItem: authorship.roadmapItem,
      resourceUrl: 'https://github.com/curiositech/port-daddy/pull/1',
      resourceNumber: 1,
      publishedBranch: 'pd-agent/fix-abc',
      sourceHeadSha: 'a'.repeat(40),
      githubHeadSha: 'b'.repeat(40),
      result: 'updated' as const,
      verifiedAt: 1,
      relayPublicKey: 'c'.repeat(64),
      tokenCleanup: 'confirmed' as const,
      signature: 'd'.repeat(128),
    };
    expect(fleetbotReceiptPreimage(receipt)).not.toContain(receipt.signature);
    expect(fleetbotReceiptPreimage(receipt)).toContain('github_receipt_abc');
  });
});
