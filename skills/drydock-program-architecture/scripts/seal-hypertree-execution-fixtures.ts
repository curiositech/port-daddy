#!/usr/bin/env -S npx tsx

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalJson } from '../../../lib/merkle-chain.js';
import {
  digestHypertreeProjection,
  reduceHypertreeExecution,
} from '../../../lib/drydock/hypertree-execution-reducer.js';
import type {
  CapacityPurpose,
  CapacityReservationRef,
  CapacitySettlementRef,
  HypertreeExecutionDefinition,
  HypertreeExecutionEvent,
} from '../../../lib/drydock/hypertree-execution-types.js';

type JsonObject = Record<string, any>;

const scriptDir = dirname(fileURLToPath(import.meta.url));
const skillRoot = resolve(scriptDir, '..');
const repositoryRoot = resolve(skillRoot, '../..');
const fixturePath = resolve(skillRoot, 'examples/hypertree-execution.review-loop.json');
const goldenPath = resolve(repositoryRoot, 'tests/fixtures/drydock-hypertree-execution/v1/review-loop.golden.json');
const checkOnly = process.argv.includes('--check');

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(
    typeof value === 'string' ? value : canonicalJson(value),
  ).digest('hex')}`;
}

function definitionFor(document: JsonObject): HypertreeExecutionDefinition {
  return {
    executionId: document.executionId,
    definitionDigest: document.definitionDigest,
    plan: structuredClone(document.plan),
    authorityModel: structuredClone(document.authorityModel),
    scopeNodeIds: structuredClone(document.scope.nodeIds),
    nodeDependencies: structuredClone(document.scope.dependencies),
    capacityBudgets: structuredClone(document.capacityBudgets),
    projectionSchema: document.contracts.projectionSchema,
    nodeContracts: structuredClone(document.contracts.nodeContracts),
    reviewPolicy: structuredClone(document.reviewPolicy),
    limits: structuredClone(document.limits),
    truthState: 'FIXTURE',
    staleAfterSeconds: 300,
  };
}

function definitionDigest(document: JsonObject): `sha256:${string}` {
  const definition = definitionFor(document) as unknown as JsonObject;
  delete definition.definitionDigest;
  return digest(definition);
}

function executionDigest(document: JsonObject): `sha256:${string}` {
  const sealed = structuredClone(document);
  delete sealed.executionDigest;
  return digest(sealed);
}

function evidencePrefixDigest(events: HypertreeExecutionEvent[]): `sha256:${string}` {
  let tip = '0'.repeat(64);
  for (const event of events) {
    tip = createHash('sha256').update(tip).update(canonicalJson(event)).digest('hex');
  }
  return `sha256:${tip}`;
}

function reservation(
  document: JsonObject,
  event: HypertreeExecutionEvent,
  purpose: CapacityPurpose,
  reservedUnits: number,
): CapacityReservationRef {
  if (event.nodeId === null || event.attempt === null) throw new Error('capacity requires a node event');
  const purposeSlug = purpose.replace(':', '/');
  const id = `capacity/${purposeSlug}/${event.nodeId.toLowerCase()}/${event.attempt}/${event.sequence}`;
  return {
    id,
    idempotencyKey: `idempotency/${purposeSlug}/${event.nodeId.toLowerCase()}/${event.attempt}/${event.sequence}`,
    budgetId: 'codex-subscription-window',
    purpose,
    executionId: document.executionId,
    nodeId: event.nodeId,
    attempt: event.attempt,
    reservedUnits,
    expiresAt: '2026-09-14T12:09:59Z',
    receiptDigest: digest(`reservation:${id}:${reservedUnits}`),
    evidenceUri: `evidence://capacity/reservations/${id}`,
  };
}

function settlement(
  reservationRef: CapacityReservationRef,
  usedUnits: number,
): CapacitySettlementRef {
  return {
    reservationId: reservationRef.id,
    outcome: 'CONSUMED',
    usedUnits,
    receiptDigest: digest(`settlement:${reservationRef.id}:${usedUnits}`),
    evidenceUri: `evidence://capacity/settlements/${reservationRef.id}`,
  };
}

function normalizeFixture(input: JsonObject): JsonObject {
  const document = structuredClone(input);
  document.capacityBudgets = [{
    id: 'codex-subscription-window',
    providerId: 'openai-codex',
    accountRef: 'operator/main',
    unit: 'subscription-basis-points',
    maxReservedUnits: 1_000,
  }];
  document.reviewPolicy.managerGate.reservationUnit = 'provider-native-units';
  document.reviewPolicy.managerGate.maxUnitsPerDecision = 20;
  document.limits = {
    maxScopeNodes: 100,
    maxEvents: 500,
    maxNodeStartsTotal: 20,
    maxCapacityReservationsTotal: 40,
    maxArtifactsPerOutput: 16,
    maxOutputBytesPerAttempt: 1_048_576,
    maxNodeAttempts: 3,
    maxReworkRounds: 2,
    maxManagerRounds: 3,
    maxTopologyMutations: 3,
    maxWallClockSeconds: 600,
    maxRecursiveBirths: 0,
    retryOwner: 'external-controller',
    retryLayers: 1,
  };

  for (const event of document.events as HypertreeExecutionEvent[]) {
    const payload = event.payload as JsonObject;
    if (event.type === 'NODE_STARTED') {
      if (payload.managerRound !== undefined || payload.input.capacityReservationIds !== undefined) {
        throw new Error(`legacy NODE_STARTED capacity/round fields remain at ${event.eventId}`);
      }
      const round = payload.assignment?.round;
      if (!Number.isInteger(round)) throw new Error(`missing assignment round at ${event.eventId}`);
      payload.assignment = {
        round,
        managerIdentity: payload.assignment.managerIdentity,
        roleId: payload.assignment.roleId,
        receiptDigest: digest(`assignment:${event.nodeId}:${event.attempt}:${round}`),
        evidenceUri: `evidence://staffing/${event.nodeId?.toLowerCase()}/attempt/${event.attempt}/assignment`,
      };
      for (const [index, artifact] of payload.input.artifacts.entries()) {
        artifact.byteLength = artifact.byteLength ?? 512 * (index + 1);
      }
      const work = reservation(document, event, 'work', 120);
      payload.input.capacityReservations = [work];
      if (payload.input.reworkDirective?.findingIds !== undefined) {
        throw new Error(`legacy rework findingIds remain at ${event.eventId}`);
      }
    }
    if (event.type === 'OUTPUT_PRODUCED') {
      for (const [index, artifact] of payload.artifacts.entries()) {
        artifact.byteLength = artifact.byteLength ?? 4_096 * (index + 1);
      }
      const start = document.events.find((candidate: HypertreeExecutionEvent) =>
        candidate.type === 'NODE_STARTED'
          && candidate.nodeId === event.nodeId
          && candidate.attempt === event.attempt,
      ) as JsonObject;
      const work = start.payload.input.capacityReservations[0] as CapacityReservationRef;
      payload.capacitySettlements = [settlement(work, event.attempt === 1 ? 90 : 80)];
    }
    if (event.type === 'REVIEW_COMPLETED') {
      if (payload.reservedUnits !== undefined || payload.usedUnits !== undefined) {
        throw new Error(`legacy REVIEW_COMPLETED capacity fields remain at ${event.eventId}`);
      }
      const purpose = payload.reviewerClass === 'specialist'
        ? 'review:specialist'
        : 'review:low-cost-independent';
      const reserved = payload.capacityReservation?.reservedUnits;
      const used = payload.capacitySettlement?.usedUnits;
      if (!Number.isInteger(reserved) || !Number.isInteger(used)) {
        throw new Error(`missing REVIEW_COMPLETED capacity receipt at ${event.eventId}`);
      }
      payload.capacityReservation = reservation(document, event, purpose, reserved);
      payload.capacitySettlement = settlement(payload.capacityReservation, used);
    }
    if (event.type === 'REWORK_REQUESTED' && payload.findingIds !== undefined) {
      throw new Error(`legacy REWORK_REQUESTED findingIds remain at ${event.eventId}`);
    }
    if (event.type === 'MANAGER_DECIDED') {
      payload.capacityReservation = reservation(document, event, 'manager', 15);
      payload.capacitySettlement = settlement(payload.capacityReservation, 6);
      if (payload.rework?.findingIds !== undefined) {
        throw new Error(`legacy MANAGER_DECIDED findingIds remain at ${event.eventId}`);
      }
    }
  }

  document.definitionDigest = definitionDigest(document);
  for (const event of document.events as HypertreeExecutionEvent[]) {
    if (event.type === 'RUN_OPENED') event.payload.definitionDigest = document.definitionDigest;
    if (event.type === 'NODE_STARTED') event.payload.input.definitionDigest = document.definitionDigest;
  }
  const terminal = document.events.at(-1) as HypertreeExecutionEvent;
  if (terminal.type !== 'RUN_COMPLETED') throw new Error('fixture must end in RUN_COMPLETED');
  terminal.payload.evidenceRoot = evidencePrefixDigest(document.events.slice(0, -1));
  document.expectedProjection = reduceHypertreeExecution(definitionFor(document), document.events);
  document.executionDigest = executionDigest(document);
  return document;
}

const originalFixture = readFileSync(fixturePath, 'utf8');
const normalized = normalizeFixture(JSON.parse(originalFixture));
const fixtureOutput = `${JSON.stringify(normalized, null, 2)}\n`;

const priorGolden = JSON.parse(readFileSync(goldenPath, 'utf8')) as JsonObject;
const cases = (priorGolden.cases ?? [
  { id: 'initial', eventCount: 0 },
  { id: 'opened', eventCount: 1 },
  { id: 'rework-requested', eventCount: 6 },
  { id: 'completed', eventCount: normalized.events.length },
]).map((testCase: JsonObject) => {
  const projection = reduceHypertreeExecution(
    definitionFor(normalized),
    normalized.events.slice(0, testCase.eventCount),
  );
  return {
    id: testCase.id,
    eventCount: testCase.eventCount,
    projectionDigest: digestHypertreeProjection(projection),
    projection,
  };
});
const goldenOutput = `${JSON.stringify({
  schemaVersion: 1,
  sourceExecutionDigest: normalized.executionDigest,
  cases,
}, null, 2)}\n`;

if (checkOnly) {
  const drift = originalFixture !== fixtureOutput || readFileSync(goldenPath, 'utf8') !== goldenOutput;
  if (drift) {
    console.error('sealed hypertree fixture or golden corpus is stale');
    process.exit(1);
  }
  console.log('sealed hypertree fixture and golden corpus are current');
} else {
  writeFileSync(fixturePath, fixtureOutput);
  writeFileSync(goldenPath, goldenOutput);
  console.log(`sealed ${fixturePath}`);
  console.log(`sealed ${goldenPath}`);
}
