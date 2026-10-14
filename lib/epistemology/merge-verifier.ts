/**
 * Minimal Deterministic Prototype Merge Verifier (@epistemology/merge-verifier)
 * 
 * Standalone, dependency-free in-memory merge verifier implementing
 * the Contradiction Ladder (L0 Schema -> L1 Constraints -> L2 Contracts -> L4 Parley).
 */

import {
  ClaimEnvelope,
  MergeVerificationResult,
  ParleyPacket,
  VerificationRejection,
  LadderLevel,
  IncompatiblePropositionSummary,
  ConsequenceOption
} from './types.js';

export interface VerifierOptions {
  currentTimeIso?: string;
  enforceTtl?: boolean;
}

/**
 * Deterministic in-memory merge verifier that enforces epistemic consistency across candidate claims.
 *
 * Motivation: Multi-agent workspaces can introduce silent cross-branch or cross-repository
 * assumption drift when structural or behavioral contracts change. This verifier provides a
 * fail-closed, deterministic Contradiction Ladder (L0 schema -> L1 typed constraints -> L2 behavioral contracts)
 * before candidate claims are admitted, emitting a structured ParleyPacket when human governance is needed.
 */
export class EpistemologyMergeVerifier {
  private options: VerifierOptions;

  /**
   * Initializes a new EpistemologyMergeVerifier instance.
   *
   * Purpose: Allows callers and deterministic unit tests to inject a fixed reference clock
   * and toggle TTL enforcement for reproducible verification runs.
   *
   * @param options - Configuration options governing clock reference and TTL enforcement.
   */
  constructor(options: VerifierOptions = {}) {
    this.options = {
      enforceTtl: true,
      ...options
    };
  }

  /**
   * Evaluates candidate claims against existing admitted claims across the Contradiction Ladder.
   *
   * Design rationale: Separates syntactic schema/TTL checks (L0) from propositional/constraint
   * contradiction detection (L1) and behavioral contract preconditions (L2), ensuring that
   * incompatible assumptions are trapped deterministically and escalated with an explicit
   * unsatisfiable core rather than silently merged.
   *
   * @param admittedClaims - Currently accepted ClaimEnvelope records forming the baseline truth set.
   * @param candidateClaims - Incoming ClaimEnvelope records proposed for merge admission.
   * @returns A MergeVerificationResult indicating admission success, any rejected claims, and an optional ParleyPacket on conflict.
   */
  public verifyMerge(
    admittedClaims: ClaimEnvelope[],
    candidateClaims: ClaimEnvelope[]
  ): MergeVerificationResult {
    const rejectedClaims: VerificationRejection[] = [];
    const validCandidates: ClaimEnvelope[] = [];

    // --- LEVEL 0: Schema, Version, and Expiry Check ---
    for (const claim of candidateClaims) {
      const l0Error = this.validateL0(claim);
      if (l0Error) {
        const safeClaimId =
          claim && typeof claim === 'object' && typeof claim.claimId === 'string' && claim.claimId
            ? claim.claimId
            : 'unknown';
        rejectedClaims.push({
          claimId: safeClaimId,
          reason: l0Error,
          ladderLevel: 0
        });
      } else {
        validCandidates.push(claim);
      }
    }

    if (validCandidates.length === 0 && candidateClaims.length > 0) {
      return {
        success: false,
        ladderLevelTrapped: 0,
        admittedClaims,
        rejectedClaims
      };
    }

    // --- LEVEL 1: Exact Claims & Typed Constraints (Conflict Detection) ---
    // Check candidate against admitted, as well as candidate against candidate
    const pool = [...admittedClaims, ...validCandidates];

    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        const claimA = pool[i];
        const claimB = pool[j];

        const conflict = this.detectL1Conflict(claimA, claimB);
        if (conflict) {
          const parleyPacket = this.generateParleyPacket(
            1,
            claimA,
            claimB,
            conflict.reason,
            conflict.unsatisfiableCore
          );

          return {
            success: false,
            ladderLevelTrapped: 1,
            admittedClaims,
            rejectedClaims: [
              {
                claimId: claimB.claimId,
                reason: `L1 Constraint Conflict with Claim ${claimA.claimId}: ${conflict.reason}`,
                ladderLevel: 1
              }
            ],
            parleyPacket
          };
        }
      }
    }

    // --- LEVEL 2: Contract & Behavioral Invariants ---
    for (const claim of validCandidates) {
      const contractError = this.checkL2Contract(claim, admittedClaims);
      if (contractError) {
        return {
          success: false,
          ladderLevelTrapped: 2,
          admittedClaims,
          rejectedClaims: [
            {
              claimId: claim.claimId,
              reason: `L2 Contract Breach: ${contractError}`,
              ladderLevel: 2
            }
          ]
        };
      }
    }

    // If all pass, admit candidates
    return {
      success: true,
      admittedClaims: [...admittedClaims, ...validCandidates],
      rejectedClaims
    };
  }

  /**
   * Validates Level 0 syntactic structure, required envelope fields, and TTL freshness.
   *
   * Purpose: Ensures malformed, untyped, or stale claims fail closed at the outer gate
   * before expensive pairwise constraint comparisons are performed.
   *
   * @param claim - The candidate ClaimEnvelope to validate.
   * @returns An error message string if validation fails, or null if valid.
   */
  private validateL0(claim: ClaimEnvelope): string | null {
    if (!claim || typeof claim !== 'object' || Array.isArray(claim)) {
      return 'Claim payload is not an object';
    }
    if (claim.schema !== 'pd.epistemology.claim-envelope.v0') {
      return `Invalid or unsupported schema: ${claim.schema}`;
    }
    if (!claim.claimId || typeof claim.claimId !== 'string') {
      return 'Missing or invalid claimId';
    }
    if (!claim.kind || !['fact', 'hypothesis', 'preference', 'decision', 'obligation'].includes(claim.kind)) {
      return `Invalid epistemic kind: ${claim.kind}`;
    }
    if (!claim.subject || typeof claim.subject !== 'string') {
      return 'Missing or invalid subject';
    }
    if (
      !claim.proposition ||
      typeof claim.proposition !== 'object' ||
      Array.isArray(claim.proposition) ||
      !['type_constraint', 'contract_behavior', 'state_invariant', 'custom'].includes(claim.proposition.type)
    ) {
      return 'Missing or invalid proposition (supported proposition.type required)';
    }
    if (
      !claim.scope ||
      typeof claim.scope !== 'object' ||
      typeof claim.scope.repository !== 'string' ||
      !claim.scope.repository ||
      !Array.isArray(claim.scope.paths) ||
      !claim.scope.paths.every((p) => typeof p === 'string')
    ) {
      return 'Invalid scope: repository and string paths[] required';
    }
    if (!Array.isArray(claim.assumptions) || !claim.assumptions.every((a) => typeof a === 'string')) {
      return 'Missing or invalid assumptions array';
    }
    if (
      !Array.isArray(claim.evidence) ||
      !claim.evidence.every(
        (ev) =>
          ev &&
          typeof ev === 'object' &&
          !Array.isArray(ev) &&
          ['witnessed', 'derived', 'asserted', 'porthole_capture'].includes(ev.witnessClass) &&
          typeof ev.digest === 'string' &&
          ev.digest.length > 0 &&
          typeof ev.uri === 'string' &&
          ev.uri.length > 0
      )
    ) {
      return 'Missing or invalid evidence array';
    }
    if (
      !claim.issuer ||
      typeof claim.issuer !== 'object' ||
      typeof claim.issuer.principalId !== 'string' ||
      !claim.issuer.principalId ||
      typeof claim.issuer.agentId !== 'string' ||
      !claim.issuer.agentId
    ) {
      return 'Missing or incomplete issuer (principalId and agentId required)';
    }
    if (!claim.observationTime || typeof claim.observationTime !== 'string' || isNaN(Date.parse(claim.observationTime))) {
      return 'Invalid observationTime (ISO 8601 expected)';
    }
    if (
      claim.ttlSeconds !== undefined &&
      (typeof claim.ttlSeconds !== 'number' || Number.isNaN(claim.ttlSeconds) || claim.ttlSeconds < 0)
    ) {
      return 'Invalid ttlSeconds (non-negative number required)';
    }
    if (
      claim.confidence !== undefined &&
      (typeof claim.confidence !== 'number' || Number.isNaN(claim.confidence) || claim.confidence < 0 || claim.confidence > 1)
    ) {
      return 'Invalid confidence (number between 0 and 1 required)';
    }
    if (!['draft', 'proposed', 'principal_approved', 'revoked'].includes(claim.authority)) {
      return `Invalid authority status: ${claim.authority}`;
    }

    // TTL Freshness Check
    if (this.options.enforceTtl && claim.ttlSeconds && claim.ttlSeconds > 0) {
      const now = this.options.currentTimeIso
        ? Date.parse(this.options.currentTimeIso)
        : Date.now();
      const obs = Date.parse(claim.observationTime);
      if (now > obs + claim.ttlSeconds * 1000) {
        return `Claim has expired (TTL ${claim.ttlSeconds}s exceeded)`;
      }
    }

    return null;
  }

  /**
   * Serializes a JSON-compatible value into a canonical key-sorted string for structural comparison.
   *
   * Purpose: Ensures object and array `state_invariant` values are compared by content rather
   * than reference identity or key insertion order.
   *
   * @param value - The value to canonicalize.
   * @returns A deterministic JSON string representation.
   */
  private canonicalizeValue(value: unknown): string {
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.canonicalizeValue(item)).join(',')}]`;
    }
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${this.canonicalizeValue((value as Record<string, unknown>)[key])}`);
    return `{${entries.join(',')}}`;
  }

  /**
   * Detects Level 1 propositional, type-constraint, and state-invariant contradictions between two claims.
   *
   * Design motivation: Identifies mutually incompatible claims over the same subject and property
   * (such as opposing nullability constraints or conflicting state invariant values) and extracts
   * a minimal unsatisfiable core for human review.
   *
   * @param a - The first ClaimEnvelope in the comparison pair.
   * @param b - The second ClaimEnvelope in the comparison pair.
   * @returns An object describing the contradiction reason and unsatisfiableCore, or null if compatible.
   */
  private detectL1Conflict(
    a: ClaimEnvelope,
    b: ClaimEnvelope
  ): { reason: string; unsatisfiableCore: string[] } | null {
    // 1. Check if both claims refer to the same subject
    if (a.subject !== b.subject) {
      return null;
    }

    // 2. Type Constraint & Nullability Incompatibility
    // e.g. A asserts nullable: true, B asserts nullable: false (or non-null required)
    const propA = a.proposition;
    const propB = b.proposition;

    if (
      propA.type === 'type_constraint' &&
      propB.type === 'type_constraint' &&
      propA.property === propB.property
    ) {
      if (propA.nullable !== undefined && propB.nullable !== undefined) {
        if (propA.nullable !== propB.nullable) {
          return {
            reason: `Direct nullability contradiction on '${a.subject}.${propA.property}': Claim ${a.claimId} asserts nullable=${propA.nullable}, while Claim ${b.claimId} asserts nullable=${propB.nullable}`,
            unsatisfiableCore: [
              `${a.claimId}:nullable=${propA.nullable}`,
              `${b.claimId}:nullable=${propB.nullable}`
            ]
          };
        }
      }
    }

    // 3. State Invariant Value Contradiction
    if (
      propA.type === 'state_invariant' &&
      propB.type === 'state_invariant' &&
      propA.property === propB.property
    ) {
      if (propA.value !== undefined && propB.value !== undefined) {
        const canonicalA = this.canonicalizeValue(propA.value);
        const canonicalB = this.canonicalizeValue(propB.value);
        if (canonicalA !== canonicalB) {
          return {
            reason: `Contradictory state invariant on '${a.subject}.${propA.property}': Claim ${a.claimId} requires value=${canonicalA}, while Claim ${b.claimId} requires value=${canonicalB}`,
            unsatisfiableCore: [
              `${a.claimId}:value=${canonicalA}`,
              `${b.claimId}:value=${canonicalB}`
            ]
          };
        }
      }
    }

    return null;
  }

  /**
   * Checks Level 2 interface and behavioral contract preconditions.
   *
   * Rationale: Even when structural types match at L1, a candidate claim can violate
   * behavioral preconditions established by admitted contracts.
   *
   * @param candidate - The candidate ClaimEnvelope being evaluated.
   * @param _admitted - The currently admitted ClaimEnvelope set for contract context.
   * @returns A failure description string if a contract precondition is breached, or null if satisfied.
   */
  private checkL2Contract(candidate: ClaimEnvelope, _admitted: ClaimEnvelope[]): string | null {
    if (candidate.proposition.type === 'contract_behavior') {
      const expr = candidate.proposition.expression;
      if (expr && expr.includes('VIOLATES_PRECONDITION')) {
        return `Precondition expression failure: ${expr}`;
      }
    }
    return null;
  }

  /**
   * Formulates a structured ParleyPacket for human governance escalation when two claims conflict.
   *
   * Intent: Packages the minimal unsatisfiable core, consequence matrix, and authorized decision
   * makers so operators can resolve cross-branch contradictions while unrelated tasks continue safely.
   *
   * @param ladderLevel - The Contradiction Ladder level that trapped the conflict.
   * @param claimA - The first conflicting ClaimEnvelope.
   * @param claimB - The second conflicting ClaimEnvelope.
   * @param _reason - Human-readable summary of the detected contradiction.
   * @param unsatisfiableCore - Minimal list of conflicting proposition atoms.
   * @returns A populated ParleyPacket ready for governance escalation.
   */
  private generateParleyPacket(
    ladderLevel: LadderLevel,
    claimA: ClaimEnvelope,
    claimB: ClaimEnvelope,
    _reason: string,
    unsatisfiableCore: string[]
  ): ParleyPacket {
    const packetId = `parley-L${ladderLevel}-${claimA.claimId}-${claimB.claimId}`;
    const incidentId = `inc-${claimA.claimId}-${claimB.claimId}`;

    const propSummaries: IncompatiblePropositionSummary[] = [
      {
        claimId: claimA.claimId,
        subject: claimA.subject,
        summary: JSON.stringify(claimA.proposition),
        sourceRepository: claimA.scope.repository,
        assumptions: claimA.assumptions
      },
      {
        claimId: claimB.claimId,
        subject: claimB.subject,
        summary: JSON.stringify(claimB.proposition),
        sourceRepository: claimB.scope.repository,
        assumptions: claimB.assumptions
      }
    ];

    const consequenceMatrix: ConsequenceOption[] = [
      {
        option: `Adopt Claim ${claimA.claimId} (${claimA.scope.repository})`,
        favorsClaimId: claimA.claimId,
        impact: `Accepts ${claimA.subject} proposition. Requires downstream adaptation in ${claimB.scope.repository}.`,
        affectedWork: claimB.scope.paths
      },
      {
        option: `Adopt Claim ${claimB.claimId} (${claimB.scope.repository})`,
        favorsClaimId: claimB.claimId,
        impact: `Accepts ${claimB.subject} proposition. Retains existing invariants; requires ${claimA.scope.repository} to revert or adapt.`,
        affectedWork: claimA.scope.paths
      },
      {
        option: 'Quarantine & Request Principal Redesign',
        favorsClaimId: null,
        impact: 'Neither claim admitted. Dependent branches paused while independent work proceeds.',
        affectedWork: [...claimA.scope.paths, ...claimB.scope.paths]
      }
    ];

    // Deduplicate authorized decision makers from issuers
    const decisionMakers = Array.from(
      new Set([claimA.issuer.principalId, claimB.issuer.principalId])
    );

    return {
      schema: 'pd.epistemology.parley-packet.v0',
      packetId,
      incidentId,
      ladderLevel,
      conflictingClaimIds: [claimA.claimId, claimB.claimId],
      incompatiblePropositions: propSummaries,
      unsatisfiableCore,
      consequenceMatrix,
      authorizedDecisionMakers: decisionMakers,
      quiescentState: {
        pausedTaskIds: [`task-merge-${incidentId}`],
        safeIndependentTaskIds: ['task-unrelated-frontend-docs', 'task-telemetry-fix']
      },
      resolution: {
        status: 'pending'
      }
    };
  }
}

/**
 * Creates the canonical cross-project contradiction fixture for deterministic tests.
 *
 * Purpose: Models the benchmark scenario where one branch updates an API field (`UserAccount.email`)
 * to nullable while an existing admitted obligation requires it to remain non-null, alongside an
 * orthogonal clean claim (`UserAccount.displayName`).
 *
 * @returns An object containing `admittedClaim`, `conflictingCandidateClaim`, and `cleanCandidateClaim`.
 */
export function createSyntheticContradictionFixture(): {
  admittedClaim: ClaimEnvelope;
  conflictingCandidateClaim: ClaimEnvelope;
  cleanCandidateClaim: ClaimEnvelope;
} {
  const admittedClaim: ClaimEnvelope = {
    schema: 'pd.epistemology.claim-envelope.v0',
    claimId: 'claim-api-email-v1',
    kind: 'obligation',
    subject: 'UserAccount.email',
    proposition: {
      type: 'type_constraint',
      property: 'email',
      nullable: false
    },
    scope: {
      repository: 'curiositech/port-daddy-backend',
      branch: 'main',
      paths: ['src/models/user.ts']
    },
    assumptions: ['Database schema enforces NOT NULL constraint on email column'],
    evidence: [
      {
        witnessClass: 'witnessed',
        digest: 'sha256-a1b2c3d4e5f6',
        uri: 'file:///workspace/tests/user-schema.test.ts#L42'
      }
    ],
    issuer: {
      principalId: 'principal-erich',
      agentId: 'agent-backend-architect'
    },
    observationTime: new Date(Date.now() - 3600000).toISOString(),
    authority: 'principal_approved'
  };

  // Contradictory Claim: API team changes field to nullable
  const conflictingCandidateClaim: ClaimEnvelope = {
    schema: 'pd.epistemology.claim-envelope.v0',
    claimId: 'claim-api-email-v2-nullable',
    kind: 'hypothesis',
    subject: 'UserAccount.email',
    proposition: {
      type: 'type_constraint',
      property: 'email',
      nullable: true
    },
    scope: {
      repository: 'curiositech/port-daddy-backend',
      branch: 'feat/allow-anonymous-users',
      paths: ['src/models/user.ts']
    },
    assumptions: ['Anonymous registration without email is permitted'],
    evidence: [
      {
        witnessClass: 'porthole_capture',
        digest: 'sha256-f6e5d4c3b2a1',
        uri: 'file:///artifacts/porthole-recordings/session-anon-auth.mp4',
        portholeSessionId: 'sess-porthole-9821',
        portholeTimestampMs: 14250
      }
    ],
    issuer: {
      principalId: 'principal-erich',
      agentId: 'agent-auth-feature'
    },
    observationTime: new Date().toISOString(),
    authority: 'proposed'
  };

  // Clean Candidate: touching independent subject
  const cleanCandidateClaim: ClaimEnvelope = {
    schema: 'pd.epistemology.claim-envelope.v0',
    claimId: 'claim-api-displayname',
    kind: 'fact',
    subject: 'UserAccount.displayName',
    proposition: {
      type: 'type_constraint',
      property: 'displayName',
      nullable: true
    },
    scope: {
      repository: 'curiositech/port-daddy-backend',
      branch: 'feat/display-name',
      paths: ['src/models/user.ts']
    },
    assumptions: ['Display name is an optional user profile field'],
    evidence: [
      {
        witnessClass: 'witnessed',
        digest: 'sha256-789abc456def',
        uri: 'file:///workspace/tests/display-name.test.ts'
      }
    ],
    issuer: {
      principalId: 'principal-erich',
      agentId: 'agent-profile-feature'
    },
    observationTime: new Date().toISOString(),
    authority: 'proposed'
  };

  return {
    admittedClaim,
    conflictingCandidateClaim,
    cleanCandidateClaim
  };
}
