import { describe, it, expect } from '@jest/globals';
import {
  EpistemologyMergeVerifier,
  createSyntheticContradictionFixture
} from '../../lib/epistemology/merge-verifier.js';
import { ClaimEnvelope } from '../../lib/epistemology/types.js';

describe('EpistemologyMergeVerifier & Contradiction Ladder', () => {
  const verifier = new EpistemologyMergeVerifier();

  describe('Level 0: Schema & Version Validation', () => {
    it('rejects an envelope with an invalid schema identifier', () => {
      const invalidClaim = {
        schema: 'unsupported.schema.v99',
        claimId: 'claim-bad-schema',
        kind: 'fact',
        subject: 'User.id',
        proposition: { type: 'type_constraint' },
        scope: { repository: 'repo', paths: ['file.ts'] },
        assumptions: [],
        evidence: [],
        issuer: { principalId: 'p1', agentId: 'a1' },
        observationTime: new Date().toISOString(),
        authority: 'proposed'
      } as unknown as ClaimEnvelope;

      const result = verifier.verifyMerge([], [invalidClaim]);
      expect(result.success).toBe(false);
      expect(result.ladderLevelTrapped).toBe(0);
      expect(result.rejectedClaims[0].reason).toContain('Invalid or unsupported schema');
    });

    it('rejects an expired claim envelope based on TTL', () => {
      const expiredClaim: ClaimEnvelope = {
        schema: 'pd.epistemology.claim-envelope.v0',
        claimId: 'claim-expired',
        kind: 'hypothesis',
        subject: 'Telemetry.rate',
        proposition: { type: 'type_constraint' },
        scope: { repository: 'repo', paths: ['telemetry.ts'] },
        assumptions: [],
        evidence: [{ witnessClass: 'witnessed', digest: '123', uri: 'file:///' }],
        issuer: { principalId: 'p1', agentId: 'a1' },
        observationTime: new Date(Date.now() - 50000).toISOString(),
        ttlSeconds: 10, // expired 40s ago
        authority: 'proposed'
      };

      const result = verifier.verifyMerge([], [expiredClaim]);
      expect(result.success).toBe(false);
      expect(result.ladderLevelTrapped).toBe(0);
      expect(result.rejectedClaims[0].reason).toContain('Claim has expired');
    });
  });

  describe('Level 1: Exact Claims & Typed Constraints', () => {
    it('detects direct nullability contradiction and generates a valid ParleyPacket', () => {
      const { admittedClaim, conflictingCandidateClaim } = createSyntheticContradictionFixture();

      const result = verifier.verifyMerge([admittedClaim], [conflictingCandidateClaim]);

      expect(result.success).toBe(false);
      expect(result.ladderLevelTrapped).toBe(1);
      expect(result.rejectedClaims).toHaveLength(1);
      expect(result.rejectedClaims[0].reason).toContain('Direct nullability contradiction');

      // ParleyPacket assertions
      const packet = result.parleyPacket;
      expect(packet).toBeDefined();
      expect(packet?.schema).toBe('pd.epistemology.parley-packet.v0');
      expect(packet?.ladderLevel).toBe(1);
      expect(packet?.conflictingClaimIds).toEqual([
        admittedClaim.claimId,
        conflictingCandidateClaim.claimId
      ]);
      expect(packet?.unsatisfiableCore).toContain(`${admittedClaim.claimId}:nullable=false`);
      expect(packet?.unsatisfiableCore).toContain(`${conflictingCandidateClaim.claimId}:nullable=true`);
      expect(packet?.authorizedDecisionMakers).toContain('principal-erich');
      expect(packet?.consequenceMatrix.length).toBeGreaterThanOrEqual(3);
      expect(packet?.quiescentState.pausedTaskIds.length).toBeGreaterThan(0);
    });

    it('detects conflicting state invariants on the same subject', () => {
      const claimA: ClaimEnvelope = {
        schema: 'pd.epistemology.claim-envelope.v0',
        claimId: 'claim-inv-1',
        kind: 'obligation',
        subject: 'Cluster.minReplicas',
        proposition: {
          type: 'state_invariant',
          property: 'minReplicas',
          value: 3
        },
        scope: { repository: 'infra', paths: ['cluster.yaml'] },
        assumptions: ['High availability policy requires at least 3 nodes'],
        evidence: [{ witnessClass: 'witnessed', digest: 'd1', uri: 'file:///infra' }],
        issuer: { principalId: 'principal-devops', agentId: 'agent-infra' },
        observationTime: new Date().toISOString(),
        authority: 'principal_approved'
      };

      const claimB: ClaimEnvelope = {
        schema: 'pd.epistemology.claim-envelope.v0',
        claimId: 'claim-inv-2',
        kind: 'obligation',
        subject: 'Cluster.minReplicas',
        proposition: {
          type: 'state_invariant',
          property: 'minReplicas',
          value: 1
        },
        scope: { repository: 'infra', paths: ['cluster.yaml'] },
        assumptions: ['Cost saving policy limits to 1 node in staging'],
        evidence: [{ witnessClass: 'witnessed', digest: 'd2', uri: 'file:///staging' }],
        issuer: { principalId: 'principal-finance', agentId: 'agent-cost-optimizer' },
        observationTime: new Date().toISOString(),
        authority: 'proposed'
      };

      const result = verifier.verifyMerge([claimA], [claimB]);
      expect(result.success).toBe(false);
      expect(result.ladderLevelTrapped).toBe(1);
      expect(result.rejectedClaims[0].reason).toContain('Contradictory state invariant');
      expect(result.parleyPacket?.unsatisfiableCore).toContain('claim-inv-1:value=3');
      expect(result.parleyPacket?.unsatisfiableCore).toContain('claim-inv-2:value=1');
    });
  });

  describe('Level 2: Contract & Behavioral Invariants', () => {
    it('detects contract precondition breach and halts admission', () => {
      const contractClaim: ClaimEnvelope = {
        schema: 'pd.epistemology.claim-envelope.v0',
        claimId: 'claim-contract-precond-fail',
        kind: 'obligation',
        subject: 'PaymentService.charge',
        proposition: {
          type: 'contract_behavior',
          expression: 'VIOLATES_PRECONDITION: amount > 0'
        },
        scope: { repository: 'curiositech/billing', paths: ['src/charge.ts'] },
        assumptions: [],
        evidence: [{ witnessClass: 'witnessed', digest: 'd1', uri: 'file:///charge' }],
        issuer: { principalId: 'principal-erich', agentId: 'agent-billing' },
        observationTime: new Date().toISOString(),
        authority: 'proposed'
      };

      const result = verifier.verifyMerge([], [contractClaim]);
      expect(result.success).toBe(false);
      expect(result.ladderLevelTrapped).toBe(2);
      expect(result.rejectedClaims[0].reason).toContain('L2 Contract Breach: Precondition expression failure');
    });
  });

  describe('Clean Admission & Porthole Evidence Binding', () => {
    it('admits non-conflicting claims and preserves Porthole capture evidence', () => {
      const { admittedClaim, cleanCandidateClaim } = createSyntheticContradictionFixture();

      const result = verifier.verifyMerge([admittedClaim], [cleanCandidateClaim]);
      expect(result.success).toBe(true);
      expect(result.admittedClaims).toHaveLength(2);
      expect(result.admittedClaims.map((c) => c.claimId)).toEqual([
        admittedClaim.claimId,
        cleanCandidateClaim.claimId
      ]);
      expect(result.parleyPacket).toBeUndefined();
    });

    it('verifies Porthole evidence receipt structure in claim envelope', () => {
      const { conflictingCandidateClaim } = createSyntheticContradictionFixture();
      const portholeReceipt = conflictingCandidateClaim.evidence.find(
        (e) => e.witnessClass === 'porthole_capture'
      );

      expect(portholeReceipt).toBeDefined();
      expect(portholeReceipt?.portholeSessionId).toBe('sess-porthole-9821');
      expect(portholeReceipt?.portholeTimestampMs).toBe(14250);
      expect(portholeReceipt?.uri).toContain('session-anon-auth.mp4');
    });

    it('gracefully rejects null or malformed candidate claims at L0 without throwing', () => {
      const result = verifier.verifyMerge([], [null as unknown as ClaimEnvelope]);
      expect(result.success).toBe(false);
      expect(result.ladderLevelTrapped).toBe(0);
      expect(result.rejectedClaims[0].claimId).toBe('unknown');
      expect(result.rejectedClaims[0].reason).toContain('Claim payload is not an object');
    });

    it('rejects malformed proposition, evidence, or out-of-range confidence at L0', () => {
      const badConfidenceClaim: ClaimEnvelope = {
        schema: 'pd.epistemology.claim-envelope.v0',
        claimId: 'claim-bad-confidence',
        kind: 'hypothesis',
        subject: 'Auth.token',
        proposition: { type: 'type_constraint' },
        scope: { repository: 'repo', paths: ['auth.ts'] },
        assumptions: [],
        evidence: [{ witnessClass: 'witnessed', digest: 'd1', uri: 'file:///auth' }],
        issuer: { principalId: 'p1', agentId: 'a1' },
        observationTime: new Date().toISOString(),
        confidence: 1.5,
        authority: 'proposed'
      };

      const result = verifier.verifyMerge([], [badConfidenceClaim]);
      expect(result.success).toBe(false);
      expect(result.ladderLevelTrapped).toBe(0);
      expect(result.rejectedClaims[0].reason).toContain('Invalid confidence (number between 0 and 1 required)');
    });

    it('admits structurally equal object state_invariant claims and generates deterministic packetId on conflict', () => {
      const baseClaim: ClaimEnvelope = {
        schema: 'pd.epistemology.claim-envelope.v0',
        claimId: 'claim-obj-1',
        kind: 'obligation',
        subject: 'Policy.retryConfig',
        proposition: {
          type: 'state_invariant',
          property: 'retryConfig',
          value: { maxRetries: 3, backoffMs: 500 }
        },
        scope: { repository: 'infra', paths: ['retry.ts'] },
        assumptions: [],
        evidence: [{ witnessClass: 'witnessed', digest: 'd1', uri: 'file:///retry' }],
        issuer: { principalId: 'p1', agentId: 'a1' },
        observationTime: new Date().toISOString(),
        authority: 'principal_approved'
      };

      const matchingCandidate: ClaimEnvelope = {
        ...baseClaim,
        claimId: 'claim-obj-2',
        proposition: {
          type: 'state_invariant',
          property: 'retryConfig',
          // Reordered keys, distinct object reference, identical canonical structure
          value: { backoffMs: 500, maxRetries: 3 }
        }
      };

      const cleanResult = verifier.verifyMerge([baseClaim], [matchingCandidate]);
      expect(cleanResult.success).toBe(true);
      expect(cleanResult.admittedClaims).toHaveLength(2);

      const conflictingCandidate: ClaimEnvelope = {
        ...baseClaim,
        claimId: 'claim-obj-3',
        proposition: {
          type: 'state_invariant',
          property: 'retryConfig',
          value: { maxRetries: 5, backoffMs: 500 }
        }
      };

      const conflict1 = verifier.verifyMerge([baseClaim], [conflictingCandidate]);
      const conflict2 = verifier.verifyMerge([baseClaim], [conflictingCandidate]);
      expect(conflict1.success).toBe(false);
      expect(conflict1.parleyPacket?.packetId).toBe('parley-L1-claim-obj-1-claim-obj-3');
      expect(conflict1.parleyPacket?.packetId).toBe(conflict2.parleyPacket?.packetId);
    });
  });
});

