import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, test } from '@jest/globals';

import { canonicalJson } from '../../lib/merkle-chain.js';
import {
  HYPERTREE_PROJECTION_SCHEMA,
  HYPERTREE_REDUCER_VERSION,
  type HypertreeExecutionDefinition,
  type HypertreeExecutionEvent,
  type HypertreeExecutionProjectionV1,
  type HypertreeProjectionUpdateV1,
} from '../../lib/drydock/hypertree-execution-types.js';
import {
  HypertreeExecutionReducer,
  HypertreeReductionError,
  digestHypertreeEvidencePrefix,
  digestHypertreeExecutionDefinition,
  digestHypertreeProjection,
  reduceHypertreeExecution,
} from '../../lib/drydock/hypertree-execution-reducer.js';
import {
  HypertreeProjectionStream,
  ProjectionStreamError,
  projectionTruthAt,
} from '../../lib/drydock/hypertree-execution-stream.js';

interface ExecutionFixture {
  executionId: string;
  definitionDigest: HypertreeExecutionDefinition['definitionDigest'];
  plan: HypertreeExecutionDefinition['plan'];
  authorityModel: HypertreeExecutionDefinition['authorityModel'];
  scope: {
    nodeIds: string[];
    dependencies: HypertreeExecutionDefinition['nodeDependencies'];
  };
  contracts: {
    projectionSchema: typeof HYPERTREE_PROJECTION_SCHEMA;
    nodeContracts: HypertreeExecutionDefinition['nodeContracts'];
  };
  reviewPolicy: HypertreeExecutionDefinition['reviewPolicy'];
  capacityBudgets: HypertreeExecutionDefinition['capacityBudgets'];
  limits: HypertreeExecutionDefinition['limits'];
  events: HypertreeExecutionEvent[];
  expectedProjection: HypertreeExecutionProjectionV1;
}

const fixturePath = join(
  process.cwd(),
  'skills/drydock-program-architecture/examples/hypertree-execution.review-loop.json',
);
const goldenPath = join(
  process.cwd(),
  'tests/fixtures/drydock-hypertree-execution/v1/review-loop.golden.json',
);

function loadFixture(): ExecutionFixture {
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as ExecutionFixture;
}

function independentCanonicalJson(value: unknown): string {
  const canonicalize = (candidate: unknown): unknown => {
    if (Array.isArray(candidate)) return candidate.map(canonicalize);
    if (candidate && typeof candidate === 'object') {
      return Object.fromEntries(
        Object.keys(candidate as Record<string, unknown>)
          .sort()
          .map((key) => [key, canonicalize((candidate as Record<string, unknown>)[key])]),
      );
    }
    return candidate;
  };
  return JSON.stringify(canonicalize(value));
}

function independentSha256(value: string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function independentEvidenceRoot(trace: readonly HypertreeExecutionEvent[]): `sha256:${string}` {
  let tip = '0'.repeat(64);
  for (const event of trace) {
    tip = createHash('sha256').update(tip).update(independentCanonicalJson(event)).digest('hex');
  }
  return `sha256:${tip}`;
}

function definitionFor(fixture = loadFixture()): HypertreeExecutionDefinition {
  return {
    executionId: fixture.executionId,
    definitionDigest: fixture.definitionDigest,
    plan: structuredClone(fixture.plan),
    authorityModel: structuredClone(fixture.authorityModel),
    scopeNodeIds: structuredClone(fixture.scope.nodeIds),
    nodeDependencies: structuredClone(fixture.scope.dependencies),
    capacityBudgets: structuredClone(fixture.capacityBudgets),
    projectionSchema: fixture.contracts.projectionSchema,
    nodeContracts: structuredClone(fixture.contracts.nodeContracts),
    reviewPolicy: structuredClone(fixture.reviewPolicy),
    limits: structuredClone(fixture.limits),
    truthState: 'FIXTURE',
    staleAfterSeconds: 300,
  };
}

function resealDefinition(
  definition: HypertreeExecutionDefinition,
): HypertreeExecutionDefinition {
  definition.definitionDigest = digestHypertreeExecutionDefinition(definition);
  return definition;
}

function events(): HypertreeExecutionEvent[] {
  return structuredClone(loadFixture().events);
}

function eventsForDefinition(definition: HypertreeExecutionDefinition): HypertreeExecutionEvent[] {
  const trace = events();
  for (const event of trace) {
    if (event.type === 'RUN_OPENED') event.payload.definitionDigest = definition.definitionDigest;
    if (event.type === 'NODE_STARTED') event.payload.input.definitionDigest = definition.definitionDigest;
  }
  const terminal = trace.at(-1);
  if (terminal?.type === 'RUN_COMPLETED') {
    terminal.payload.evidenceRoot = digestHypertreeEvidencePrefix(trace.slice(0, -1));
  }
  return trace;
}

function twoNodeDefinition(): HypertreeExecutionDefinition {
  const definition = definitionFor();
  const secondContract = structuredClone(definition.nodeContracts[0]);
  secondContract.id = 'dd-071-contract-v1';
  secondContract.nodeId = 'DD-071';
  definition.scopeNodeIds = ['DD-070', 'DD-071'];
  definition.nodeContracts = [definition.nodeContracts[0], secondContract];
  definition.nodeDependencies = [
    { nodeId: 'DD-070', dependsOnNodeIds: [] },
    { nodeId: 'DD-071', dependsOnNodeIds: ['DD-070'] },
  ];
  return resealDefinition(definition);
}

function openEventFor(definition: HypertreeExecutionDefinition): HypertreeExecutionEvent {
  const opening = structuredClone(events()[0]);
  if (opening.type !== 'RUN_OPENED') throw new Error('fixture must begin with RUN_OPENED');
  opening.payload.scopeNodeIds = [...definition.scopeNodeIds];
  opening.payload.definitionDigest = definition.definitionDigest;
  return opening;
}

function expectReductionCode(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error('expected reducer to reject the event');
  } catch (error) {
    expect(error).toBeInstanceOf(HypertreeReductionError);
    expect((error as HypertreeReductionError).code).toBe(code);
  }
}

function expectStreamCode(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error('expected projection stream to reject the update');
  } catch (error) {
    expect(error).toBeInstanceOf(ProjectionStreamError);
    expect((error as ProjectionStreamError).code).toBe(code);
    expect((error as ProjectionStreamError).requiresRefetch).toBe(true);
  }
}

describe('Drydock hypertree execution reducer', () => {
  test('reproduces the independently sealed review-loop projection byte for byte', () => {
    const fixture = loadFixture();
    const projection = reduceHypertreeExecution(definitionFor(fixture), fixture.events);

    expect(canonicalJson(projection)).toBe(canonicalJson(fixture.expectedProjection));
    expect(projection).toMatchObject({
      reducerVersion: HYPERTREE_REDUCER_VERSION,
      executionId: fixture.executionId,
      planId: fixture.plan.id,
      planDigest: fixture.plan.digest,
      definitionDigest: fixture.definitionDigest,
      asOfSequence: 14,
      asOfEventId: 'evt-014',
      runState: 'COMPLETED',
      staleAfter: '2026-09-14T12:05:24Z',
    });
    expect(projection.nodes).toEqual([
      expect.objectContaining({
        nodeId: 'DD-070',
        state: 'APPROVED',
        attempt: 2,
        reworkRounds: 1,
        checkStatus: 'PASS',
        reviewVerdict: 'APPROVE',
        managerDecision: 'APPROVE_NODE',
      }),
    ]);
  });

  test('matches fixed independently-derived definition, event-root, and projection digests', () => {
    const fixture = loadFixture();
    const definition = definitionFor(fixture);
    const unsealedDefinition = structuredClone(definition) as unknown as Record<string, unknown>;
    delete unsealedDefinition.definitionDigest;

    expect(independentSha256(independentCanonicalJson(unsealedDefinition))).toBe(
      'sha256:2486f4b4ef1957d6e9f210b1bce56d17e823dbd760648cf21ec7d3096babdd93',
    );
    expect(independentEvidenceRoot(fixture.events.slice(0, -1))).toBe(
      'sha256:b0e657ebb4b7b6c195a29df847f3d94de22b446ab64bbf92f534824a867c1ade',
    );
    expect(independentSha256(independentCanonicalJson(fixture.expectedProjection))).toBe(
      'sha256:4f5452f4a43d2ed61b824ec71d58b0f9d79c03d4088b2e369c856793114e9fa9',
    );
  });

  test('rejects a stale definition digest after graph, contract, or capacity authority changes', () => {
    const graphDrift = definitionFor();
    graphDrift.nodeDependencies[0].dependsOnNodeIds = ['DD-070'];
    expectReductionCode(() => new HypertreeExecutionReducer(graphDrift), 'INVALID_DEFINITION');

    const contractDrift = definitionFor();
    contractDrift.nodeContracts[0].output.requiredArtifactKinds[0] = 'different-authority-proof';
    expectReductionCode(() => new HypertreeExecutionReducer(contractDrift), 'INVALID_DEFINITION');

    const accountDrift = definitionFor();
    accountDrift.capacityBudgets[0].accountRef = 'operator/other-account';
    expectReductionCode(() => new HypertreeExecutionReducer(accountDrift), 'INVALID_DEFINITION');

    const aliasedCapacity = definitionFor();
    aliasedCapacity.capacityBudgets.push({
      ...structuredClone(aliasedCapacity.capacityBudgets[0]),
      id: 'same-account-second-name',
    });
    resealDefinition(aliasedCapacity);
    expectReductionCode(() => new HypertreeExecutionReducer(aliasedCapacity), 'INVALID_DEFINITION');
  });

  test('binds terminal completion to the exact admitted event bytes', () => {
    const trace = events();
    const arbitraryRoot = new HypertreeExecutionReducer(definitionFor());
    arbitraryRoot.replay(trace.slice(0, -1));
    const terminal = structuredClone(trace.at(-1)!);
    if (terminal.type !== 'RUN_COMPLETED') throw new Error('fixture must terminate with RUN_COMPLETED');
    terminal.payload.evidenceRoot = `sha256:${'0'.repeat(64)}`;
    expectReductionCode(() => arbitraryRoot.apply(terminal), 'CONTRACT_VIOLATION');

    const alteredTrace = events();
    const produced = alteredTrace[7];
    if (produced.type !== 'OUTPUT_PRODUCED') throw new Error('fixture event 8 must be OUTPUT_PRODUCED');
    produced.payload.artifacts[0].digest = `sha256:${'f'.repeat(64)}`;
    const altered = new HypertreeExecutionReducer(definitionFor());
    altered.replay(alteredTrace.slice(0, -1));
    expectReductionCode(() => altered.apply(alteredTrace.at(-1)!), 'CONTRACT_VIOLATION');
  });

  test('projects honest partial states before any event and through rework', () => {
    const reducer = new HypertreeExecutionReducer(definitionFor());
    expect(reducer.projection).toMatchObject({
      asOfSequence: 0,
      asOfEventId: null,
      runState: 'OPEN',
      staleAfter: null,
      nodes: [{ state: 'BLOCKED', attempt: 0, checkStatus: 'UNKNOWN' }],
    });

    const trace = events();
    reducer.apply(trace[0]);
    expect(reducer.projection).toMatchObject({
      asOfSequence: 1,
      runState: 'RUNNING',
      nodes: [{ state: 'ELIGIBLE', attempt: 0 }],
    });
    reducer.apply(trace[1]);
    expect(reducer.projection.nodes[0]).toMatchObject({ state: 'RUNNING', attempt: 1 });
    reducer.apply(trace[2]);
    expect(reducer.projection.nodes[0]).toMatchObject({ state: 'AWAITING_CHECKS' });
    reducer.apply(trace[3]);
    expect(reducer.projection.nodes[0]).toMatchObject({ state: 'AWAITING_REVIEW', checkStatus: 'PASS' });
    reducer.apply(trace[4]);
    expect(reducer.projection.nodes[0]).toMatchObject({ state: 'REWORK_REQUIRED', reviewVerdict: 'REWORK' });
    reducer.apply(trace[5]);
    expect(reducer.projection.nodes[0]).toMatchObject({ state: 'REWORK_REQUIRED', reworkRounds: 1 });
  });

  test('enforces the scoped DAG frontier and unlocks a dependent only after approval', () => {
    const definition = twoNodeDefinition();
    const reducer = new HypertreeExecutionReducer(definition);
    reducer.apply(openEventFor(definition));
    expect(reducer.projection.nodes).toEqual([
      expect.objectContaining({ nodeId: 'DD-070', dependsOnNodeIds: [], state: 'ELIGIBLE' }),
      expect.objectContaining({ nodeId: 'DD-071', dependsOnNodeIds: ['DD-070'], state: 'BLOCKED' }),
    ]);

    const dependentStart = structuredClone(events()[1]);
    if (dependentStart.type !== 'NODE_STARTED') throw new Error('fixture event 2 must start a node');
    dependentStart.eventId = 'evt-dependent-start';
    dependentStart.nodeId = 'DD-071';
    dependentStart.payload.input.nodeContractId = 'dd-071-contract-v1';
    expectReductionCode(() => reducer.apply(dependentStart), 'INVALID_TRANSITION');

    reducer.replay(eventsForDefinition(definition).slice(1, 13));
    expect(reducer.projection.nodes).toEqual([
      expect.objectContaining({ nodeId: 'DD-070', state: 'APPROVED' }),
      expect.objectContaining({ nodeId: 'DD-071', state: 'ELIGIBLE' }),
    ]);
  });

  test('rejects cyclic or incomplete dependency graphs before opening a run', () => {
    const cyclic = twoNodeDefinition();
    cyclic.nodeDependencies = [
      { nodeId: 'DD-070', dependsOnNodeIds: ['DD-071'] },
      { nodeId: 'DD-071', dependsOnNodeIds: ['DD-070'] },
    ];
    resealDefinition(cyclic);
    expectReductionCode(() => new HypertreeExecutionReducer(cyclic), 'INVALID_DEFINITION');

    const incomplete = twoNodeDefinition();
    incomplete.nodeDependencies.pop();
    resealDefinition(incomplete);
    expectReductionCode(() => new HypertreeExecutionReducer(incomplete), 'INVALID_DEFINITION');
  });

  test('converges across incremental chunk boundaries', () => {
    const trace = events();
    const singlePass = new HypertreeExecutionReducer(definitionFor());
    const chunked = new HypertreeExecutionReducer(definitionFor());

    singlePass.replay(trace);
    chunked.replay(trace.slice(0, 1));
    chunked.replay(trace.slice(1, 6));
    chunked.replay(trace.slice(6, 12));
    chunked.replay(trace.slice(12));

    expect(canonicalJson(chunked.projection)).toBe(canonicalJson(singlePass.projection));
  });

  test('converges at every possible two-chunk replay boundary', () => {
    const trace = events();
    const expected = reduceHypertreeExecution(definitionFor(), trace);
    for (let split = 0; split <= trace.length; split += 1) {
      const reducer = new HypertreeExecutionReducer(definitionFor());
      reducer.replay(trace.slice(0, split));
      reducer.replay(trace.slice(split));
      expect(canonicalJson(reducer.projection)).toBe(canonicalJson(expected));
    }
  });

  test('matches every independently sealed golden prefix and projection digest', () => {
    const golden = JSON.parse(readFileSync(goldenPath, 'utf8')) as {
      sourceExecutionDigest: string;
      cases: Array<{
        id: string;
        eventCount: number;
        projectionDigest: string;
        projection: HypertreeExecutionProjectionV1;
      }>;
    };
    const fixture = loadFixture() as ExecutionFixture & { executionDigest: string };
    expect(golden.sourceExecutionDigest).toBe(fixture.executionDigest);

    for (const testCase of golden.cases) {
      const reducer = new HypertreeExecutionReducer(definitionFor(fixture));
      reducer.replay(fixture.events.slice(0, testCase.eventCount));
      expect(canonicalJson(reducer.projection)).toBe(canonicalJson(testCase.projection));
      expect(digestHypertreeProjection(reducer.projection)).toBe(testCase.projectionDigest);
    }
  });

  test('replays exact duplicate bytes idempotently and rejects conflicting duplicates atomically', () => {
    const reducer = new HypertreeExecutionReducer(definitionFor());
    const opening = events()[0];
    expect(reducer.apply(opening)).not.toBeNull();
    expect(reducer.apply(structuredClone(opening))).toBeNull();
    expect(reducer.projection.asOfSequence).toBe(1);

    reducer.apply(events()[1]);
    const afterProgress = canonicalJson(reducer.projection);
    expect(reducer.apply(structuredClone(opening))).toBeNull();
    expect(canonicalJson(reducer.projection)).toBe(afterProgress);

    const conflicting = structuredClone(opening);
    conflicting.payload.scopeNodeIds = ['DD-999'];
    const before = canonicalJson(reducer.projection);
    expectReductionCode(() => reducer.apply(conflicting), 'EVENT_ID_CONFLICT');
    expect(canonicalJson(reducer.projection)).toBe(before);
  });

  test('rejects cursor gaps, backward timestamps, and post-terminal events', () => {
    const trace = events();
    const missingOpening = new HypertreeExecutionReducer(definitionFor());
    expectReductionCode(() => missingOpening.apply(trace[1]), 'CURSOR_MISMATCH');

    const backward = new HypertreeExecutionReducer(definitionFor());
    backward.apply(trace[0]);
    const second = structuredClone(trace[1]);
    second.occurredAt = '2026-09-14T11:59:59Z';
    expectReductionCode(() => backward.apply(second), 'TIMESTAMP_REGRESSION');

    const noncanonical = new HypertreeExecutionReducer(definitionFor());
    noncanonical.apply(trace[0]);
    const offsetTimestamp = structuredClone(trace[1]);
    offsetTimestamp.occurredAt = '2026-09-14T12:00:01+00:00';
    expectReductionCode(() => noncanonical.apply(offsetTimestamp), 'INVALID_EVENT');

    const terminal = new HypertreeExecutionReducer(definitionFor());
    terminal.replay(trace);
    const extra = structuredClone(trace[13]);
    extra.sequence = 15;
    extra.eventId = 'evt-015';
    extra.previousEventId = 'evt-014';
    extra.occurredAt = '2026-09-14T12:00:25Z';
    expectReductionCode(() => terminal.apply(extra), 'TERMINAL_RUN');
  });

  test('rejects event authority claimed by the wrong witness class', () => {
    const reducer = new HypertreeExecutionReducer(definitionFor());
    const opening = events()[0];
    opening.witnessClass = 'GUEST_ASSERTED';
    expectReductionCode(() => reducer.apply(opening), 'CONTRACT_VIOLATION');
    expect(reducer.projection.asOfSequence).toBe(0);
  });

  test('keeps rejected events from consuming sequence, budget, or node state', () => {
    const reducer = new HypertreeExecutionReducer(definitionFor());
    const trace = events();
    reducer.replay(trace.slice(0, 3));
    const malformedChecks = structuredClone(trace[3]);
    malformedChecks.payload.checks[0].id = 'not-the-required-floor';
    const before = canonicalJson(reducer.projection);

    expectReductionCode(() => reducer.apply(malformedChecks), 'CONTRACT_VIOLATION');
    expect(canonicalJson(reducer.projection)).toBe(before);

    reducer.apply(trace[3]);
    expect(reducer.projection).toMatchObject({ asOfSequence: 4, asOfEventId: 'evt-004' });
  });

  test('does not let failed checks advance and rejects incomplete output before checks or review', () => {
    const failedChecksTrace = events();
    failedChecksTrace[8].payload.checks[0].status = 'FAIL';
    const failedChecks = new HypertreeExecutionReducer(definitionFor());
    failedChecks.replay(failedChecksTrace.slice(0, 9));
    expectReductionCode(() => failedChecks.apply(failedChecksTrace[9]), 'INVALID_TRANSITION');

    const incompleteTrace = events();
    incompleteTrace[2].payload.artifacts.pop();
    const incomplete = new HypertreeExecutionReducer(definitionFor());
    incomplete.replay(incompleteTrace.slice(0, 2));
    expectReductionCode(() => incomplete.apply(incompleteTrace[2]), 'CONTRACT_VIOLATION');
    expect(incomplete.projection).toMatchObject({
      asOfSequence: 2,
      nodes: [{ state: 'RUNNING', attempt: 1 }],
    });
  });

  test('separates producer, reviewer, and manager identities', () => {
    const trace = events();
    const selfReview = new HypertreeExecutionReducer(definitionFor());
    selfReview.replay(trace.slice(0, 9));
    const review = structuredClone(trace[9]);
    review.payload.reviewerIdentity = review.payload.producerIdentity;
    expectReductionCode(() => selfReview.apply(review), 'AUTHORITY_COLLISION');

    const managerCollision = new HypertreeExecutionReducer(definitionFor());
    managerCollision.replay(trace.slice(0, 11));
    const manager = structuredClone(trace[11]);
    manager.payload.managerIdentity = trace[9].payload.reviewerIdentity;
    expectReductionCode(() => managerCollision.apply(manager), 'AUTHORITY_COLLISION');

    const crossAttemptManager = new HypertreeExecutionReducer(definitionFor());
    crossAttemptManager.replay(trace.slice(0, 11));
    const priorReviewerAsManager = structuredClone(trace[11]);
    priorReviewerAsManager.payload.managerIdentity = trace[4].payload.reviewerIdentity;
    expectReductionCode(() => crossAttemptManager.apply(priorReviewerAsManager), 'AUTHORITY_COLLISION');

    const crossAttemptProducer = new HypertreeExecutionReducer(definitionFor());
    crossAttemptProducer.replay(trace.slice(0, 6));
    const priorReviewerAsWorker = structuredClone(trace[6]);
    priorReviewerAsWorker.payload.workerIdentity = trace[4].payload.reviewerIdentity;
    expectReductionCode(() => crossAttemptProducer.apply(priorReviewerAsWorker), 'AUTHORITY_COLLISION');

    const crossAttemptAssignment = new HypertreeExecutionReducer(definitionFor());
    crossAttemptAssignment.replay(trace.slice(0, 6));
    const priorReviewerAsAssignedManager = structuredClone(trace[6]);
    priorReviewerAsAssignedManager.payload.assignment.managerIdentity = trace[4].payload.reviewerIdentity;
    expectReductionCode(() => crossAttemptAssignment.apply(priorReviewerAsAssignedManager), 'AUTHORITY_COLLISION');
  });

  test('binds manager reasoning to exact output, check, and review events', () => {
    const trace = events();
    const reducer = new HypertreeExecutionReducer(definitionFor());
    reducer.replay(trace.slice(0, 11));
    const manager = structuredClone(trace[11]);
    manager.payload.reasoningEvidenceIds = ['bogus-evidence'];
    const before = canonicalJson(reducer.projection);
    expectReductionCode(() => reducer.apply(manager), 'CONTRACT_VIOLATION');
    expect(canonicalJson(reducer.projection)).toBe(before);
  });

  test('admits exactly one manager decision per node attempt', () => {
    const trace = events();
    const reducer = new HypertreeExecutionReducer(definitionFor());
    reducer.replay(trace.slice(0, 12));
    const conflicting = structuredClone(trace[11]);
    conflicting.sequence = 13;
    conflicting.eventId = 'evt-conflicting-manager';
    conflicting.previousEventId = 'evt-012';
    conflicting.occurredAt = '2026-09-14T12:00:22Z';
    conflicting.payload.decision = 'HALT';
    const before = canonicalJson(reducer.projection);
    expectReductionCode(() => reducer.apply(conflicting), 'INVALID_TRANSITION');
    expect(canonicalJson(reducer.projection)).toBe(before);
  });

  test('uses CONTINUE as one bounded manager rework round with an exact next-attempt directive', () => {
    const trace = events();
    const reducer = new HypertreeExecutionReducer(definitionFor());
    reducer.replay(trace.slice(0, 11));
    const manager = structuredClone(trace[11]);
    manager.payload.decision = 'CONTINUE';
    manager.payload.rework = {
      findings: [{
        id: 'manager-needs-fresh-responsive-proof',
        severity: 'major',
        summary: 'The measured responsive proof is incomplete.',
        evidenceUri: 'evidence://run/dd-070/attempt/2/manager/responsive-proof',
      }],
      requiredArtifactKinds: ['responsive rules'],
    };
    reducer.apply(manager);
    expect(reducer.projection).toMatchObject({
      runState: 'RUNNING',
      nodes: [{ state: 'REWORK_REQUIRED', reworkRounds: 2, managerDecision: 'CONTINUE' }],
    });

    const nextAttempt = structuredClone(trace[6]);
    nextAttempt.sequence = 13;
    nextAttempt.eventId = 'evt-manager-rework-start';
    nextAttempt.previousEventId = 'evt-012';
    nextAttempt.occurredAt = '2026-09-14T12:00:23Z';
    nextAttempt.attempt = 3;
    nextAttempt.payload.assignment.round = 3;
    nextAttempt.payload.input.priorAttemptArtifactIds = [
      'authority-split-a2',
      'state-reel-a2',
      'zoom-paths-a2',
      'responsive-rules-a2',
    ];
    nextAttempt.payload.input.reworkDirective = {
      eventId: 'evt-012',
      findings: [{
        id: 'manager-needs-fresh-responsive-proof',
        sourceEventId: 'evt-012',
        evidenceUri: 'evidence://run/dd-070/attempt/2/manager/responsive-proof',
      }],
      requiredArtifactKinds: ['responsive rules'],
    };
    const nextReservation = nextAttempt.payload.input.capacityReservations[0];
    nextReservation.id = 'capacity/work/dd-070/3/13';
    nextReservation.idempotencyKey = 'idempotency/work/dd-070/3/13';
    nextReservation.attempt = 3;
    nextReservation.receiptDigest = `sha256:${'9'.repeat(64)}`;
    nextReservation.evidenceUri = 'evidence://capacity/reservations/capacity/work/dd-070/3/13';
    reducer.apply(nextAttempt);
    expect(reducer.projection.nodes[0]).toMatchObject({ state: 'RUNNING', attempt: 3 });
  });

  test('accepts only scoped ADD_ROLE assignments and then halts for a new sealed topology', () => {
    const trace = events();
    const escaped = new HypertreeExecutionReducer(definitionFor());
    escaped.replay(trace.slice(0, 11));
    const outsideScope = structuredClone(trace[11]);
    outsideScope.payload.decision = 'ADD_ROLE';
    outsideScope.payload.assignments = [{ nodeId: 'DD-999', roleId: 'new-reviewer', reason: 'Wrong scope.' }];
    expectReductionCode(() => escaped.apply(outsideScope), 'CONTRACT_VIOLATION');

    const accepted = new HypertreeExecutionReducer(definitionFor());
    accepted.replay(trace.slice(0, 11));
    const addRole = structuredClone(trace[11]);
    addRole.payload.decision = 'ADD_ROLE';
    addRole.payload.assignments = [{ nodeId: 'DD-070', roleId: 'accessibility-reviewer', reason: 'Add one bounded perspective.' }];
    accepted.apply(addRole);
    expect(accepted.projection).toMatchObject({ runState: 'HALTED', nodes: [{ state: 'ESCALATED' }] });
    expectReductionCode(() => accepted.apply(trace[12]), 'TERMINAL_RUN');

    const oversized = new HypertreeExecutionReducer(definitionFor());
    oversized.replay(trace.slice(0, 11));
    const tooManyAssignments = structuredClone(trace[11]);
    if (tooManyAssignments.type !== 'MANAGER_DECIDED') throw new Error('fixture event 12 must be MANAGER_DECIDED');
    tooManyAssignments.payload.decision = 'ADD_ROLE';
    tooManyAssignments.payload.assignments = Array.from({ length: 501 }, (_, index) => ({
      nodeId: 'DD-070',
      roleId: `bounded-role-${index}`,
      reason: 'Exercise the sealed manager-assignment ceiling.',
    }));
    expectReductionCode(() => oversized.apply(tooManyAssignments), 'BUDGET_EXCEEDED');
  });

  test('enforces per-review, aggregate-review, rework, and wall-clock ceilings', () => {
    const overReview = events();
    const reviewReducer = new HypertreeExecutionReducer(definitionFor());
    reviewReducer.replay(overReview.slice(0, 9));
    overReview[9].payload.capacitySettlement.usedUnits =
      overReview[9].payload.capacityReservation.reservedUnits + 1;
    expectReductionCode(() => reviewReducer.apply(overReview[9]), 'BUDGET_EXCEEDED');

    const aggregateDefinition = definitionFor();
    aggregateDefinition.capacityBudgets[0].maxReservedUnits = 279;
    resealDefinition(aggregateDefinition);
    const aggregate = new HypertreeExecutionReducer(aggregateDefinition);
    const aggregateTrace = eventsForDefinition(aggregateDefinition);
    aggregate.replay(aggregateTrace.slice(0, 9));
    expectReductionCode(() => aggregate.apply(aggregateTrace[9]), 'BUDGET_EXCEEDED');

    const noReworkDefinition = definitionFor();
    noReworkDefinition.limits.maxReworkRounds = 0;
    resealDefinition(noReworkDefinition);
    const noRework = new HypertreeExecutionReducer(noReworkDefinition);
    const reworkTrace = eventsForDefinition(noReworkDefinition);
    noRework.replay(reworkTrace.slice(0, 5));
    expectReductionCode(() => noRework.apply(reworkTrace[5]), 'BUDGET_EXCEEDED');

    const reusedCapacity = new HypertreeExecutionReducer(definitionFor());
    const reusedTrace = events();
    reusedCapacity.replay(reusedTrace.slice(0, 6));
    reusedTrace[6].payload.input.capacityReservations = structuredClone(
      reusedTrace[1].payload.input.capacityReservations,
    );
    reusedTrace[6].payload.input.capacityReservations[0].attempt = 2;
    expectReductionCode(() => reusedCapacity.apply(reusedTrace[6]), 'BUDGET_EXCEEDED');

    const oneAttemptDefinition = definitionFor();
    oneAttemptDefinition.limits.maxNodeAttempts = 1;
    resealDefinition(oneAttemptDefinition);
    const oneAttempt = new HypertreeExecutionReducer(oneAttemptDefinition);
    const attemptTrace = eventsForDefinition(oneAttemptDefinition);
    oneAttempt.replay(attemptTrace.slice(0, 5));
    expectReductionCode(() => oneAttempt.apply(attemptTrace[5]), 'BUDGET_EXCEEDED');

    const late = events();
    late[13].occurredAt = '2026-09-14T12:20:00Z';
    const wallClock = new HypertreeExecutionReducer(definitionFor());
    wallClock.replay(late.slice(0, 13));
    expectReductionCode(() => wallClock.apply(late[13]), 'BUDGET_EXCEEDED');
  });

  test('binds every capacity reservation to one budget, purpose, node, attempt, TTL, and idempotency key', () => {
    const trace = events();

    const expired = new HypertreeExecutionReducer(definitionFor());
    expired.replay(trace.slice(0, 6));
    const expiredStart = structuredClone(trace[6]);
    if (expiredStart.type !== 'NODE_STARTED') throw new Error('fixture event 7 must be NODE_STARTED');
    expiredStart.payload.input.capacityReservations[0].expiresAt = expiredStart.occurredAt;
    expectReductionCode(() => expired.apply(expiredStart), 'BUDGET_EXCEEDED');

    const crossAttempt = new HypertreeExecutionReducer(definitionFor());
    crossAttempt.replay(trace.slice(0, 6));
    const wrongAttemptStart = structuredClone(trace[6]);
    if (wrongAttemptStart.type !== 'NODE_STARTED') throw new Error('fixture event 7 must be NODE_STARTED');
    wrongAttemptStart.payload.input.capacityReservations[0].attempt = 1;
    expectReductionCode(() => crossAttempt.apply(wrongAttemptStart), 'CONTRACT_VIOLATION');

    const repeatedIdempotency = new HypertreeExecutionReducer(definitionFor());
    repeatedIdempotency.replay(trace.slice(0, 6));
    const repeatedKeyStart = structuredClone(trace[6]);
    if (repeatedKeyStart.type !== 'NODE_STARTED') throw new Error('fixture event 7 must be NODE_STARTED');
    repeatedKeyStart.payload.input.capacityReservations[0].idempotencyKey =
      trace[1].type === 'NODE_STARTED'
        ? trace[1].payload.input.capacityReservations[0].idempotencyKey
        : 'unreachable';
    expectReductionCode(() => repeatedIdempotency.apply(repeatedKeyStart), 'BUDGET_EXCEEDED');

    const splitBudget = new HypertreeExecutionReducer(definitionFor());
    splitBudget.replay(trace.slice(0, 6));
    const splitBudgetStart = structuredClone(trace[6]);
    if (splitBudgetStart.type !== 'NODE_STARTED') throw new Error('fixture event 7 must be NODE_STARTED');
    const aliasReservation = structuredClone(splitBudgetStart.payload.input.capacityReservations[0]);
    aliasReservation.id = 'capacity/work/dd-070/2/alias';
    aliasReservation.idempotencyKey = 'idempotency/work/dd-070/2/alias';
    splitBudgetStart.payload.input.capacityReservations.push(aliasReservation);
    expectReductionCode(() => splitBudget.apply(splitBudgetStart), 'CONTRACT_VIOLATION');

    const wrongPurpose = new HypertreeExecutionReducer(definitionFor());
    wrongPurpose.replay(trace.slice(0, 9));
    const review = structuredClone(trace[9]);
    if (review.type !== 'REVIEW_COMPLETED') throw new Error('fixture event 10 must be REVIEW_COMPLETED');
    review.payload.capacityReservation.purpose = 'manager';
    expectReductionCode(() => wrongPurpose.apply(review), 'CONTRACT_VIOLATION');
  });

  test('settles capacity once, charges unknown outcomes conservatively, and exposes crash residue', () => {
    const trace = events();
    const reducer = new HypertreeExecutionReducer(definitionFor());
    reducer.replay(trace.slice(0, 2));
    expect(reducer.projection.capacity).toEqual([
      expect.objectContaining({ reservedUnits: 120, heldUnits: 120, usedUnits: 0, reservationCount: 1 }),
    ]);

    const unknownOutput = structuredClone(trace[2]);
    if (unknownOutput.type !== 'OUTPUT_PRODUCED') throw new Error('fixture event 3 must be OUTPUT_PRODUCED');
    unknownOutput.payload.capacitySettlements[0].outcome = 'UNKNOWN';
    unknownOutput.payload.capacitySettlements[0].usedUnits = 120;
    reducer.apply(unknownOutput);
    expect(reducer.projection.capacity).toEqual([
      expect.objectContaining({ reservedUnits: 120, heldUnits: 0, usedUnits: 120, reservationCount: 1 }),
    ]);

    const undercharged = new HypertreeExecutionReducer(definitionFor());
    undercharged.replay(trace.slice(0, 2));
    const cheapUnknown = structuredClone(trace[2]);
    if (cheapUnknown.type !== 'OUTPUT_PRODUCED') throw new Error('fixture event 3 must be OUTPUT_PRODUCED');
    cheapUnknown.payload.capacitySettlements[0].outcome = 'UNKNOWN';
    cheapUnknown.payload.capacitySettlements[0].usedUnits = 119;
    expectReductionCode(() => undercharged.apply(cheapUnknown), 'BUDGET_EXCEEDED');
    expect(undercharged.projection.capacity[0]).toMatchObject({ heldUnits: 120, usedUnits: 0 });

    const releasedWithUse = new HypertreeExecutionReducer(definitionFor());
    releasedWithUse.replay(trace.slice(0, 2));
    const dishonestRelease = structuredClone(trace[2]);
    if (dishonestRelease.type !== 'OUTPUT_PRODUCED') throw new Error('fixture event 3 must be OUTPUT_PRODUCED');
    dishonestRelease.payload.capacitySettlements[0].outcome = 'RELEASED';
    dishonestRelease.payload.capacitySettlements[0].usedUnits = 1;
    expectReductionCode(() => releasedWithUse.apply(dishonestRelease), 'CONTRACT_VIOLATION');
  });

  test('requires exact work settlement and enforces execution-wide event, start, reservation, and output ceilings', () => {
    const trace = events();

    const missingSettlement = new HypertreeExecutionReducer(definitionFor());
    missingSettlement.replay(trace.slice(0, 2));
    const incompleteOutput = structuredClone(trace[2]);
    if (incompleteOutput.type !== 'OUTPUT_PRODUCED') throw new Error('fixture event 3 must be OUTPUT_PRODUCED');
    incompleteOutput.payload.capacitySettlements = [];
    expectReductionCode(() => missingSettlement.apply(incompleteOutput), 'CONTRACT_VIOLATION');

    const eventBound = definitionFor();
    eventBound.limits.maxEvents = 13;
    resealDefinition(eventBound);
    const eventTrace = eventsForDefinition(eventBound);
    const eventReducer = new HypertreeExecutionReducer(eventBound);
    eventReducer.replay(eventTrace.slice(0, 13));
    expectReductionCode(() => eventReducer.apply(eventTrace[13]), 'BUDGET_EXCEEDED');

    const startBound = definitionFor();
    startBound.limits.maxNodeStartsTotal = 1;
    resealDefinition(startBound);
    const startTrace = eventsForDefinition(startBound);
    const startReducer = new HypertreeExecutionReducer(startBound);
    startReducer.replay(startTrace.slice(0, 6));
    expectReductionCode(() => startReducer.apply(startTrace[6]), 'BUDGET_EXCEEDED');

    const reservationBound = definitionFor();
    reservationBound.limits.maxCapacityReservationsTotal = 5;
    resealDefinition(reservationBound);
    const reservationTrace = eventsForDefinition(reservationBound);
    const reservationReducer = new HypertreeExecutionReducer(reservationBound);
    reservationReducer.replay(reservationTrace.slice(0, 11));
    expectReductionCode(() => reservationReducer.apply(reservationTrace[11]), 'BUDGET_EXCEEDED');

    const artifactBound = definitionFor();
    artifactBound.limits.maxArtifactsPerOutput = 3;
    resealDefinition(artifactBound);
    expectReductionCode(() => new HypertreeExecutionReducer(artifactBound), 'INVALID_DEFINITION');

    const byteBound = definitionFor();
    byteBound.limits.maxOutputBytesPerAttempt = 40_959;
    resealDefinition(byteBound);
    const byteTrace = eventsForDefinition(byteBound);
    const byteReducer = new HypertreeExecutionReducer(byteBound);
    byteReducer.replay(byteTrace.slice(0, 2));
    expectReductionCode(() => byteReducer.apply(byteTrace[2]), 'BUDGET_EXCEEDED');
  });

  test('requires sequential assignment receipts and capacity-backed manager decisions', () => {
    const trace = events();
    const jumpedRound = new HypertreeExecutionReducer(definitionFor());
    jumpedRound.replay(trace.slice(0, 6));
    const start = structuredClone(trace[6]);
    if (start.type !== 'NODE_STARTED') throw new Error('fixture event 7 must be NODE_STARTED');
    start.payload.assignment.round = 3;
    expectReductionCode(() => jumpedRound.apply(start), 'INVALID_TRANSITION');

    const overManager = new HypertreeExecutionReducer(definitionFor());
    overManager.replay(trace.slice(0, 11));
    const manager = structuredClone(trace[11]);
    if (manager.type !== 'MANAGER_DECIDED') throw new Error('fixture event 12 must be MANAGER_DECIDED');
    manager.payload.capacityReservation.reservedUnits = 21;
    expectReductionCode(() => overManager.apply(manager), 'BUDGET_EXCEEDED');

    const identityBound = new HypertreeExecutionReducer(definitionFor());
    identityBound.replay(trace.slice(0, 11));
    const substitutedManager = structuredClone(trace[11]);
    if (substitutedManager.type !== 'MANAGER_DECIDED') throw new Error('fixture event 12 must be MANAGER_DECIDED');
    substitutedManager.payload.managerIdentity = 'agent/unassigned-manager';
    expectReductionCode(() => identityBound.apply(substitutedManager), 'AUTHORITY_COLLISION');

    const noEvidenceFinding = new HypertreeExecutionReducer(definitionFor());
    noEvidenceFinding.replay(trace.slice(0, 11));
    const continueWithoutFinding = structuredClone(trace[11]);
    if (continueWithoutFinding.type !== 'MANAGER_DECIDED') throw new Error('fixture event 12 must be MANAGER_DECIDED');
    continueWithoutFinding.payload.decision = 'CONTINUE';
    continueWithoutFinding.payload.rework = { findings: [], requiredArtifactKinds: ['responsive rules'] };
    expectReductionCode(() => noEvidenceFinding.apply(continueWithoutFinding), 'CONTRACT_VIOLATION');
  });

  test('halts on escalation and refuses hidden manager assignments', () => {
    const trace = events();
    const escalated = new HypertreeExecutionReducer(definitionFor());
    escalated.replay(trace.slice(0, 9));
    const escalation = structuredClone(trace[9]);
    escalation.payload.verdict = 'ESCALATE';
    escalation.payload.findings = [{
      id: 'uncertain-authority',
      severity: 'blocking',
      summary: 'Authority evidence is inconclusive.',
      evidenceUri: 'evidence://review/uncertain-authority',
    }];
    escalated.apply(escalation);
    expect(escalated.projection).toMatchObject({
      runState: 'HALTED',
      nodes: [{ state: 'ESCALATED', reviewVerdict: 'ESCALATE' }],
    });
    expectReductionCode(() => escalated.apply(trace[10]), 'TERMINAL_RUN');

    const assignment = new HypertreeExecutionReducer(definitionFor());
    assignment.replay(trace.slice(0, 11));
    const manager = structuredClone(trace[11]);
    manager.payload.assignments = [{ nodeId: 'DD-070', roleId: 'extra-reviewer', reason: 'Hidden expansion.' }];
    expectReductionCode(() => assignment.apply(manager), 'CONTRACT_VIOLATION');
  });

  test('rejects a repeated rework finding instead of looping on unchanged evidence', () => {
    const trace = events();
    const reducer = new HypertreeExecutionReducer(definitionFor());
    reducer.replay(trace.slice(0, 9));
    const repeatedFinding = structuredClone(trace[4].payload.findings[0]);
    const secondReworkReview = structuredClone(trace[9]);
    secondReworkReview.payload.verdict = 'REWORK';
    secondReworkReview.payload.findings = [repeatedFinding];
    reducer.apply(secondReworkReview);

    const secondDirective = {
      sequence: 11,
      eventId: 'evt-011',
      previousEventId: 'evt-010',
      type: 'REWORK_REQUESTED',
      occurredAt: '2026-09-14T12:00:21Z',
      witnessClass: 'HOST_OBSERVED',
      nodeId: 'DD-070',
      attempt: 2,
      payload: {
        targetNodeId: 'DD-070',
        targetAttempt: 3,
        findings: [{
          id: repeatedFinding.id,
          sourceEventId: 'evt-010',
          evidenceUri: repeatedFinding.evidenceUri,
        }],
        requiredArtifactKinds: ['responsive rules'],
      },
    } as HypertreeExecutionEvent;
    expectReductionCode(() => reducer.apply(secondDirective), 'BUDGET_EXCEEDED');
  });

  test('rejects an authority-model widening before any event can be admitted', () => {
    const definition = definitionFor();
    (definition.authorityModel as { clientAuthority: string }).clientAuthority = 'control-and-projection';
    resealDefinition(definition);
    expectReductionCode(() => new HypertreeExecutionReducer(definition), 'INVALID_DEFINITION');
  });

  test('rejects widened or drifted runtime definitions instead of trusting TypeScript types', () => {
    const widened = definitionFor() as HypertreeExecutionDefinition & { ambientAuthority?: boolean };
    widened.ambientAuthority = true;
    expectReductionCode(() => new HypertreeExecutionReducer(widened), 'INVALID_DEFINITION');

    const freeReview = definitionFor();
    (freeReview.reviewPolicy.independentReview as { reservationUnit: string }).reservationUnit = 'free';
    resealDefinition(freeReview);
    expectReductionCode(() => new HypertreeExecutionReducer(freeReview), 'INVALID_DEFINITION');

    const unknownRisk = definitionFor();
    (unknownRisk.nodeContracts[0].riskClasses as string[]).push('vibes');
    resealDefinition(unknownRisk);
    expectReductionCode(() => new HypertreeExecutionReducer(unknownRisk), 'INVALID_DEFINITION');

    const oversizedDefinition = definitionFor();
    oversizedDefinition.nodeContracts[0].input.requiredArtifactKinds[0] = 'x'.repeat(4_194_304);
    resealDefinition(oversizedDefinition);
    expectReductionCode(() => new HypertreeExecutionReducer(oversizedDefinition), 'INVALID_DEFINITION');
  });

  test('rejects an oversized event before it can consume cursor or capacity', () => {
    const reducer = new HypertreeExecutionReducer(definitionFor());
    const trace = events();
    reducer.replay(trace.slice(0, 4));
    const oversized = structuredClone(trace[4]);
    if (oversized.type !== 'REVIEW_COMPLETED') throw new Error('fixture event 5 must be REVIEW_COMPLETED');
    oversized.payload.findings[0].summary = 'x'.repeat(1_048_576);
    const before = canonicalJson(reducer.projection);
    expectReductionCode(() => reducer.apply(oversized), 'INVALID_EVENT');
    expect(canonicalJson(reducer.projection)).toBe(before);
  });

  test('returns defensive projections that cannot mutate reducer state', () => {
    const reducer = new HypertreeExecutionReducer(definitionFor());
    reducer.apply(events()[0]);
    const projection = reducer.projection;
    projection.nodes[0].state = 'APPROVED';
    projection.topology.eligibility = 'dag';
    expect(reducer.projection.nodes[0].state).toBe('ELIGIBLE');
  });

  test('normalizes node order with locale-independent code-point comparison', () => {
    const definition = definitionFor();
    const secondContract = structuredClone(definition.nodeContracts[0]);
    secondContract.id = 'dd-071-contract-v1';
    secondContract.nodeId = 'DD-071';
    definition.scopeNodeIds = ['DD-071', 'DD-070'];
    definition.nodeContracts = [secondContract, definition.nodeContracts[0]];
    definition.nodeDependencies = [
      { nodeId: 'DD-071', dependsOnNodeIds: [] },
      { nodeId: 'DD-070', dependsOnNodeIds: [] },
    ];
    resealDefinition(definition);

    const reducer = new HypertreeExecutionReducer(definition);
    expect(reducer.projection.nodes.map((node) => node.nodeId)).toEqual(['DD-070', 'DD-071']);
    expect(readFileSync(join(process.cwd(), 'lib/drydock/hypertree-execution-reducer.ts'), 'utf8'))
      .not.toContain('localeCompare');
  });
});

describe('Drydock projection-only client stream', () => {
  function updates(): HypertreeProjectionUpdateV1[] {
    const reducer = new HypertreeExecutionReducer(definitionFor());
    return events().map((event) => {
      const update = reducer.apply(event);
      if (!update) throw new Error(`unexpected duplicate fixture event ${event.eventId}`);
      return update;
    });
  }

  function stream(): HypertreeProjectionStream {
    const definition = definitionFor();
    return new HypertreeProjectionStream({
      executionId: definition.executionId,
      planId: definition.plan.id,
      planDigest: definition.plan.digest,
      definitionDigest: definition.definitionDigest,
      reducerVersion: HYPERTREE_REDUCER_VERSION,
    });
  }

  test('accepts the controller update chain and converges on its final projection', () => {
    const client = stream();
    const chain = updates();
    chain.forEach((update) => expect(client.accept(update).duplicate).toBe(false));
    expect(client.projection).toEqual(chain.at(-1)?.projection);
  });

  test('hydrates from a controller snapshot, ignores its matching replay, and resumes at the next cursor', () => {
    const client = stream();
    const chain = updates();
    const snapshot = chain[5].projection;
    expect(client.replaceFromSnapshot(snapshot, chain[5].projectionDigest)).toEqual(snapshot);
    expectStreamCode(() => client.accept(chain[5]), 'CURSOR_CONFLICT');
    expect(client.accept(chain[6])).toMatchObject({
      duplicate: false,
      projection: { asOfSequence: 7, asOfEventId: 'evt-007' },
    });

    const badSnapshot = stream();
    expectStreamCode(
      () => badSnapshot.replaceFromSnapshot(snapshot, `sha256:${'0'.repeat(64)}`),
      'DIGEST_MISMATCH',
    );
  });

  test('refuses snapshot rollback or same-cursor equivocation', () => {
    const client = stream();
    const chain = updates();
    chain.slice(0, 5).forEach((update) => client.accept(update));

    expectStreamCode(
      () => client.replaceFromSnapshot(chain[0].projection, chain[0].projectionDigest),
      'CURSOR_CONFLICT',
    );

    const equivocation = structuredClone(chain[4].projection);
    equivocation.truthState = 'STALE';
    expectStreamCode(
      () => client.replaceFromSnapshot(equivocation, digestHypertreeProjection(equivocation)),
      'CURSOR_CONFLICT',
    );
  });

  test('accepts only byte-identical current duplicates', () => {
    const client = stream();
    const first = updates()[0];
    client.accept(first);
    expect(client.accept(structuredClone(first)).duplicate).toBe(true);

    const conflicting = structuredClone(first);
    conflicting.projection.truthState = 'STALE';
    conflicting.projectionDigest = digestHypertreeProjection(conflicting.projection);
    expectStreamCode(() => client.accept(conflicting), 'CURSOR_CONFLICT');
  });

  test('requires a controller refetch for gaps and previous-cursor conflicts', () => {
    const chain = updates();
    const missingFirst = stream();
    expectStreamCode(() => missingFirst.accept(chain[1]), 'CURSOR_GAP');

    const conflict = stream();
    conflict.accept(chain[0]);
    const second = structuredClone(chain[1]);
    second.previousEventId = 'evt-wrong';
    expectStreamCode(() => conflict.accept(second), 'CURSOR_CONFLICT');
  });

  test('fails closed on execution, plan, reducer, or digest drift', () => {
    const first = updates()[0];

    const authority = stream();
    const wrongPlan = structuredClone(first) as HypertreeProjectionUpdateV1;
    wrongPlan.planDigest = `sha256:${'f'.repeat(64)}`;
    expectStreamCode(() => authority.accept(wrongPlan), 'AUTHORITY_DRIFT');

    const digest = stream();
    const tampered = structuredClone(first);
    tampered.projection.truthState = 'LIVE';
    expectStreamCode(() => digest.accept(tampered), 'DIGEST_MISMATCH');

    const invalidState = stream();
    const malformed = structuredClone(first);
    (malformed.projection.nodes[0] as { state: string }).state = 'LOOKS_FINE';
    malformed.projectionDigest = digestHypertreeProjection(malformed.projection);
    expectStreamCode(() => invalidState.accept(malformed), 'INVALID_UPDATE');

    const emptyProjection = stream();
    const empty = structuredClone(first);
    empty.projection.nodes = [];
    empty.projectionDigest = digestHypertreeProjection(empty.projection);
    expectStreamCode(() => emptyProjection.accept(empty), 'INVALID_UPDATE');

    const noFreshness = stream();
    const missingDeadline = structuredClone(first);
    missingDeadline.projection.staleAfter = null;
    missingDeadline.projectionDigest = digestHypertreeProjection(missingDeadline.projection);
    expectStreamCode(() => noFreshness.accept(missingDeadline), 'INVALID_UPDATE');

    for (const staleAfter of ['2026-02-29T00:00:00Z', '2026-09-14T24:00:00Z']) {
      const impossibleFreshness = stream();
      const impossibleDeadline = structuredClone(first);
      impossibleDeadline.projection.staleAfter = staleAfter;
      impossibleDeadline.projectionDigest = digestHypertreeProjection(impossibleDeadline.projection);
      expectStreamCode(() => impossibleFreshness.accept(impossibleDeadline), 'INVALID_UPDATE');
    }

    const wrongPlanId = stream();
    const renamedPlan = structuredClone(first);
    renamedPlan.projection.planId = 'different-plan';
    renamedPlan.projectionDigest = digestHypertreeProjection(renamedPlan.projection);
    expectStreamCode(() => wrongPlanId.accept(renamedPlan), 'AUTHORITY_DRIFT');
  });

  test('labels stale, offline, and unknown truth without inventing lifecycle state', () => {
    const projection = updates()[0].projection;
    expect(projectionTruthAt(projection, Date.parse('2026-09-14T12:04:00Z'), true)).toBe('FIXTURE');
    expect(projectionTruthAt(projection, Date.parse(projection.staleAfter!), true)).toBe('STALE');
    expect(projectionTruthAt(projection, Date.parse('2026-09-14T12:06:00Z'), true)).toBe('STALE');
    expect(projectionTruthAt(projection, Date.parse('2026-09-14T12:04:00Z'), false)).toBe('OFFLINE');
    expect(projectionTruthAt(null, Date.now(), true)).toBe('UNKNOWN');
  });

  test('binds each update digest to canonical projection bytes', () => {
    for (const update of updates()) {
      expect(update.projectionDigest).toBe(digestHypertreeProjection(update.projection));
    }
  });

  test('emits updates that satisfy the closed public update schema', async () => {
    const { default: Ajv2020 } = await import('ajv/dist/2020.js');
    const schema = JSON.parse(readFileSync(join(
      process.cwd(),
      'skills/drydock-program-architecture/schemas/hypertree-execution-projection-update.schema.json',
    ), 'utf8'));
    const ajv = new Ajv2020({ allErrors: true, strict: false, formats: { 'date-time': true } });
    const validate = ajv.compile(schema);
    const chain = updates();
    for (const update of chain) expect(validate(update)).toBe(true);

    const widened = structuredClone(chain[0]) as HypertreeProjectionUpdateV1 & { rawEvent?: unknown };
    widened.rawEvent = events()[0];
    expect(validate(widened)).toBe(false);
    expect(validate.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ keyword: 'additionalProperties' }),
    ]));
  });

  test('validates initial, rework, and terminal golden states against the public projection schema', async () => {
    const { default: Ajv2020 } = await import('ajv/dist/2020.js');
    const schema = JSON.parse(readFileSync(join(
      process.cwd(),
      'skills/drydock-program-architecture/schemas/hypertree-execution-projection.schema.json',
    ), 'utf8'));
    const golden = JSON.parse(readFileSync(goldenPath, 'utf8')) as {
      cases: Array<{ projection: HypertreeExecutionProjectionV1 }>;
    };
    const ajv = new Ajv2020({ allErrors: true, strict: false, formats: { 'date-time': true } });
    const validate = ajv.compile(schema);
    for (const testCase of golden.cases) expect(validate(testCase.projection)).toBe(true);

    const dishonestZeroCursor = structuredClone(golden.cases[0].projection);
    dishonestZeroCursor.asOfEventId = 'evt-invented';
    expect(validate(dishonestZeroCursor)).toBe(false);
  });
});

describe('Drydock reducer purity boundary', () => {
  test('imports no filesystem, network, process, database, or spawner module', () => {
    const reducerSource = readFileSync(join(process.cwd(), 'lib/drydock/hypertree-execution-reducer.ts'), 'utf8');
    const streamSource = readFileSync(join(process.cwd(), 'lib/drydock/hypertree-execution-stream.ts'), 'utf8');
    const forbidden = [
      "'node:fs'",
      "'node:http'",
      "'node:https'",
      "'node:net'",
      "'node:child_process'",
      "'better-sqlite3'",
      "'../spawner",
      "'../../spawner",
    ];
    for (const needle of forbidden) {
      expect(reducerSource).not.toContain(needle);
      expect(streamSource).not.toContain(needle);
    }
  });
});
