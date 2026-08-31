/**
 * Agent Harbor v0 contract freeze tests — ADR-0095 (binder ch18 Work Order F0),
 * extended by the ADR-0096 M5 F0-delta (GuidanceEnvelope + forged-guidance) and
 * the ADR-0097 M6 F0-delta (CompactionPacket, MemoryEpisode,
 * TranscriptSearchQuery/Result, and the read-only BlackboardItem), and the
 * ADR-0028 backend-neutral HandoffCapsule continuation boundary, and the
 * ADR-0118 successor-brief and N:N harness evidence contracts, and the
 * ADR-0119 durable named-agent profile carried by AgentNode facts.
 *
 * Locks three things:
 *   1. Every schema in schemas/agent-harbor/v0/ parses and COMPILES — the
 *      validator is fail-closed and rejects any validation keyword it does not
 *      implement, so a schema cannot silently carry constraints nothing checks.
 *   2. Every fixture instance in schemas/agent-harbor/v0/fixtures/ validates,
 *      unknown extra fields are tolerated (tolerant reader), and missing
 *      required fields / bad enum values fail.
 *   3. The four ADR-0095 fork resolutions cannot drift: ch09 TranscriptEvent
 *      field names, the 7-level C0..C6 ladder, the seven topology archetypes,
 *      and legacy verbs as intake metadata only.
 *
 * The repo ships no ajv/zod; contracts are language-neutral JSON Schema files
 * consumed by TypeScript, Rust, and external custom agents alike, so this test
 * carries its own small draft-2020-12 subset validator instead of adding a
 * runtime dependency.
 */
import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  witnessedComplianceLevel,
  checkProbeWitnessing,
  assertProbeWitnessing,
  checkNodeWitnessing,
  assertNodeWitnessing,
} from '../../schemas/agent-harbor/v0/compliance-invariants.mjs';

const {
  BODY_KINDS,
  MODEL_TIERS,
  LAUNCH_MODES,
  SURFACE_GATEWAY_SURFACES,
  SURFACE_GATEWAY_DIRECTIONS,
  SURFACE_GATEWAY_MODES,
  SURFACE_GATEWAY_NOUNS,
  CAPABILITY_DECISIONS,
  CAPABILITY_DECISION_DOMAINS,
  CAPABILITY_DECISION_SURFACES,
  CAPABILITY_NAMES,
  BERTH_TARGET_TIERS,
  BERTH_AUTHORITY_DOMAINS,
  BERTH_AUTHORITY_GRANTS,
  BERTH_RESOLUTION_STATES,
  BERTH_RESOLUTION_SOURCES,
} = await import('../../lib/agent-harbor/types.js');

const here = dirname(fileURLToPath(import.meta.url));
const schemaDir = join(here, '..', '..', 'schemas', 'agent-harbor', 'v0');
const fixtureDir = join(schemaDir, 'fixtures');

const SCHEMA_NAMES = [
  'work-intent',
  'work-plan',
  'agent-node',
  'durable-agent-profile',
  'agent-run',
  'body',
  'transcript-event',
  'control-command',
  'capability-decision',
  'berth-target',
  'surface-gateway',
  'compliance-probe-result',
  'cost-accrual-event',
  'context-envelope',
  'skill-graft',
  'work-receipt',
  'guidance-envelope',
  'handoff-capsule',
  'handoff-successor-brief',
  'harness-continuation-matrix',
  'compaction-packet',
  'memory-episode',
  'transcript-search-query',
  'transcript-search-result',
  'blackboard-item',
  'porthole-perspective',
  'porthole-completeness-receipt',
  'porthole-stage',
  'porthole-stage-event',
  'porthole-control-lease',
  'porthole-disclosure-receipt',
  'porthole-regression-receipt',
];

const PORTHOLE_SCHEMA_CONSTS = {
  'porthole-perspective': 'pd.porthole.perspective.v1',
  'porthole-completeness-receipt': 'pd.porthole.completeness-receipt.v1',
  'porthole-stage': 'pd.porthole.stage.v1',
  'porthole-stage-event': 'pd.porthole.stage-event.v1',
  'porthole-control-lease': 'pd.porthole.control-lease.v1',
  'porthole-disclosure-receipt': 'pd.porthole.disclosure-receipt.v1',
  'porthole-regression-receipt': 'pd.porthole.regression-receipt.v1',
};

const STRICT_SCHEMA_NAMES = new Set([
  'handoff-capsule',
  'handoff-successor-brief',
  'harness-continuation-matrix',
  // These v1 contracts have not shipped. Their security-sensitive shape is
  // deliberately fail-closed so an old plaintext descriptor, byte-count side
  // channel, or incomplete authority receipt cannot be accepted as a future
  // extension.
  'porthole-perspective',
  'porthole-completeness-receipt',
  'porthole-stage',
  'porthole-stage-event',
  'porthole-control-lease',
  'porthole-disclosure-receipt',
  'porthole-regression-receipt',
]);

// ---------------------------------------------------------------------------
// Minimal fail-closed JSON Schema (draft 2020-12 subset) validator.
// ---------------------------------------------------------------------------

const ANNOTATION_KEYWORDS = new Set(['$schema', '$id', 'title', 'description', 'default', 'examples']);
const VALIDATION_KEYWORDS = new Set([
  '$ref',
  'type', 'properties', 'required', 'additionalProperties', 'items',
  'enum', 'const', 'minLength', 'maxLength', 'minimum', 'maximum',
  'minItems', 'maxItems', 'pattern', '$defs', '$ref', 'oneOf', 'allOf',
  'if', 'then', 'else', 'not', 'format',
]);

function resolveLocalRef(ref) {
  if (typeof ref !== 'string' || !ref) {
    throw new Error('$ref must be a non-empty string');
  }
  const [file, fragment = ''] = ref.split('#', 2);
  if (!file.endsWith('.schema.json') || file.includes('/') || file.includes('\\')) {
    throw new Error(`unsupported $ref "${ref}" — only sibling schema files are allowed`);
  }
  let target = loadSchema(file.slice(0, -'.schema.json'.length));
  if (fragment) {
    if (!fragment.startsWith('/')) {
      throw new Error(`unsupported $ref fragment "${fragment}"`);
    }
    for (const rawSegment of fragment.slice(1).split('/')) {
      const segment = rawSegment.replace(/~1/g, '/').replace(/~0/g, '~');
      if (!target || typeof target !== 'object' || !(segment in target)) {
        throw new Error(`unresolved $ref "${ref}" at "${segment}"`);
      }
      target = target[segment];
    }
  }
  if (!target || typeof target !== 'object' || Array.isArray(target)) {
    throw new Error(`$ref "${ref}" does not resolve to a schema object`);
  }
  return target;
}

/** Throws if the schema uses any keyword this validator does not implement. */
function compile(schema, path = '#', resolving = new Set()) {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) {
    throw new Error(`${path}: schema must be an object`);
  }
  for (const key of Object.keys(schema)) {
    if (ANNOTATION_KEYWORDS.has(key) || VALIDATION_KEYWORDS.has(key)) continue;
    throw new Error(`${path}: unsupported keyword "${key}" — extend the validator or simplify the schema`);
  }
  if (schema.$ref !== undefined) {
    if (resolving.has(schema.$ref)) {
      throw new Error(`${path}: cyclic $ref "${schema.$ref}" is unsupported`);
    }
    resolving.add(schema.$ref);
    compile(resolveLocalRef(schema.$ref), `${path}/$ref(${schema.$ref})`, resolving);
    resolving.delete(schema.$ref);
  }
  if (schema.properties) {
    for (const [prop, sub] of Object.entries(schema.properties)) compile(sub, `${path}/properties/${prop}`, resolving);
  }
  if (schema.$defs) {
    for (const [name, sub] of Object.entries(schema.$defs)) compile(sub, `${path}/$defs/${name}`, resolving);
  }
  for (const keyword of ['oneOf', 'allOf']) {
    if (schema[keyword] !== undefined) {
      if (!Array.isArray(schema[keyword]) || schema[keyword].length === 0) {
        throw new Error(`${path}/${keyword}: expected a non-empty schema array`);
      }
      schema[keyword].forEach((sub, i) => compile(sub, `${path}/${keyword}/${i}`, resolving));
    }
  }
  for (const keyword of ['if', 'then', 'else', 'not']) {
    if (schema[keyword] !== undefined) compile(schema[keyword], `${path}/${keyword}`, resolving);
  }
  if (schema.items) compile(schema.items, `${path}/items`, resolving);
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== 'boolean') {
    compile(schema.additionalProperties, `${path}/additionalProperties`, resolving);
  }
  return schema;
}

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

function typeMatches(declared, actual) {
  if (declared === actual) return true;
  if (declared === 'number' && actual === 'integer') return true;
  return false;
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Returns an array of error strings; empty means valid. */
function validate(schema, value, path = '$', resolving = new Set()) {
  const errors = [];
  if (schema.$ref !== undefined) {
    if (resolving.has(schema.$ref)) {
      throw new Error(`${path}: cyclic $ref "${schema.$ref}" is unsupported`);
    }
    resolving.add(schema.$ref);
    errors.push(...validate(resolveLocalRef(schema.$ref), value, path, resolving));
    resolving.delete(schema.$ref);
  }
  if (schema.allOf !== undefined) {
    schema.allOf.forEach((sub) => errors.push(...validate(sub, value, path, resolving)));
  }
  if (schema.oneOf !== undefined) {
    const matched = schema.oneOf.filter((sub) => validate(sub, value, path, resolving).length === 0).length;
    if (matched !== 1) errors.push(`${path}: expected exactly one oneOf branch, matched ${matched}`);
  }
  if (schema.if !== undefined) {
    const conditionMatched = validate(schema.if, value, path, resolving).length === 0;
    if (conditionMatched && schema.then !== undefined) {
      errors.push(...validate(schema.then, value, path, resolving));
    } else if (!conditionMatched && schema.else !== undefined) {
      errors.push(...validate(schema.else, value, path, resolving));
    }
  }
  if (schema.not !== undefined && validate(schema.not, value, path, resolving).length === 0) {
    errors.push(`${path}: matched forbidden not schema`);
  }
  if (schema.type !== undefined) {
    const declared = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = typeOf(value);
    if (!declared.some((t) => typeMatches(t, actual))) {
      errors.push(`${path}: expected type ${declared.join('|')}, got ${actual}`);
      return errors; // no point checking deeper constraints on the wrong type
    }
  }
  if (schema.const !== undefined && !deepEqual(value, schema.const)) {
    errors.push(`${path}: expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);
  }
  if (schema.enum !== undefined && !schema.enum.some((member) => deepEqual(member, value))) {
    errors.push(`${path}: value ${JSON.stringify(value)} not in enum`);
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${path}: shorter than minLength ${schema.minLength}`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`${path}: longer than maxLength ${schema.maxLength}`);
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${path}: does not match pattern ${schema.pattern}`);
    }
    if (schema.format === 'date-time' && !Number.isFinite(Date.parse(value))) {
      errors.push(`${path}: invalid date-time`);
    }
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${path}: below minimum ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${path}: above maximum ${schema.maximum}`);
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${path}: fewer than minItems ${schema.minItems}`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${path}: more than maxItems ${schema.maxItems}`);
    }
    if (schema.items) {
      value.forEach((item, i) => errors.push(...validate(schema.items, item, `${path}[${i}]`, resolving)));
    }
  }
  if (typeOf(value) === 'object') {
    if (schema.required) {
      for (const key of schema.required) {
        if (!(key in value)) errors.push(`${path}: missing required property "${key}"`);
      }
    }
    if (schema.properties) {
      for (const [key, sub] of Object.entries(schema.properties)) {
        if (key in value) errors.push(...validate(sub, value[key], `${path}.${key}`, resolving));
      }
    }
    // `additionalProperties` — enforce BOTH forms compile() accepts: the
    // boolean `false` (reject undeclared keys) and the subschema form
    // (validate undeclared keys against it). Anything compile() passes must
    // be enforced here, or the fail-closed guarantee is a lie.
    if (schema.additionalProperties !== undefined && schema.additionalProperties !== true) {
      const declared = schema.properties ?? {};
      for (const key of Object.keys(value)) {
        if (key in declared) continue;
        if (schema.additionalProperties === false) {
          errors.push(`${path}: unexpected property "${key}"`);
        } else {
          errors.push(...validate(schema.additionalProperties, value[key], `${path}.${key}`, resolving));
        }
      }
    }
  }
  return errors;
}

function loadSchema(name) {
  return JSON.parse(readFileSync(join(schemaDir, `${name}.schema.json`), 'utf8'));
}

function loadFixture(name) {
  return JSON.parse(readFileSync(join(fixtureDir, `${name}.json`), 'utf8'));
}

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Cross-field Porthole invariants that portable JSON Schema cannot express
 * (dynamic equality, arithmetic, reference membership, and timestamp order).
 * Every language binding must implement the same checks before accepting a
 * manifest or receipt as authoritative.
 */
function validatePortholeSemantics(name, value) {
  const errors = [];
  const time = (field, candidate) => {
    const parsed = Date.parse(candidate);
    if (!Number.isFinite(parsed)) errors.push(`${field}: invalid timestamp`);
    return parsed;
  };

  if (name === 'porthole-perspective') {
    if (time('captureSchedule.committedAt', value.captureSchedule.committedAt) > time('startedAt', value.startedAt)) {
      errors.push('captureSchedule must be committed before capture starts');
    }
    if (value.retention.unitId !== value.perspectiveId) {
      errors.push('retention unitId must equal perspectiveId');
    }
    if (value.retention.channelId !== value.encryption.channelId) {
      errors.push('retention and encryption channelId must match');
    }
    if (value.actor.role === 'operator' && value.actor.kind !== 'person') {
      errors.push('the operator role belongs to a person actor');
    }
  }

  if (name === 'porthole-stage-event') {
    if (['action-intent', 'input-dispatch', 'observed-effect', 'unknown-effect'].includes(value.kind)
      && !value.causedByEventIds.includes(value.leaseGrantEventId)) {
      errors.push('input event must cite its lease grant in causedByEventIds');
    }
    if (['input-dispatch', 'observed-effect', 'unknown-effect', 'input-denied'].includes(value.kind)
      && !value.causedByEventIds.includes(value.actionIntentEventId)) {
      errors.push('input outcome must cite its action intent in causedByEventIds');
    }
    if (value.durability !== 'ephemeral') {
      if (value.issuer.participantId !== value.participantId) {
        errors.push('durable event issuer must match attributed participant');
      }
      if (value.signature.keyId !== value.issuer.signingKeyId) {
        errors.push('durable event signature key must match issuer signing key');
      }
      const sourceWall = time('timing.sourceWall.timestamp', value.timing.sourceWall.timestamp);
      const committed = time('timing.committedAt', value.timing.committedAt);
      if (committed + value.timing.sourceWall.uncertaintyMs < sourceWall) {
        errors.push('durable event commit precedes source wall time beyond uncertainty');
      }
      if (time('sealedContent.privacyReceipt.verifiedAt', value.sealedContent.privacyReceipt.verifiedAt) > committed) {
        errors.push('privacy receipt cannot be verified after durable commit');
      }
    }
  }

  if (name === 'porthole-control-lease') {
    const requested = time('timing.requestedAt', value.timing.requestedAt);
    const granted = value.timing.grantedAt === null ? null : time('timing.grantedAt', value.timing.grantedAt);
    const authorized = value.timing.authorizedAt === null ? null : time('timing.authorizedAt', value.timing.authorizedAt);
    const expires = value.timing.expiresAt === null ? null : time('timing.expiresAt', value.timing.expiresAt);
    const terminationRequested = value.timing.terminationRequestedAt === null
      ? null : time('timing.terminationRequestedAt', value.timing.terminationRequestedAt);
    const terminal = value.timing.terminalAt === null ? null : time('timing.terminalAt', value.timing.terminalAt);
    if (granted !== null && granted < requested) errors.push('grantedAt precedes requestedAt');
    if (authorized !== null && (granted === null || authorized < granted)) errors.push('authorizedAt precedes grantedAt');
    if (expires !== null && (authorized === null || expires <= authorized)) errors.push('expiresAt must follow authorizedAt');
    if (terminal !== null && terminal < requested) errors.push('terminalAt precedes requestedAt');
    if (value.status === 'expired' && terminal !== expires) errors.push('expired lease terminalAt must equal expiresAt');
    if (authorized !== null && expires !== null && expires - authorized > value.limits.maxTtlMs) {
      errors.push('lease TTL exceeds maxTtlMs');
    }
    if (terminationRequested !== null && terminal !== null
      && terminal - terminationRequested > value.limits.revokeEffectBoundMs) {
      errors.push('lease terminal effect exceeds revoke bound');
    }
    if (value.actionBudget.usedActions > value.actionBudget.maxActions) {
      errors.push('usedActions exceeds maxActions');
    }
    if (value.capabilities.includes('clipboard-read')
      && value.clipboardReadPolicy.authorizationReceiptRef === null) {
      errors.push('clipboard-read requires an explicit authorization receipt');
    }
    if (value.signature.keyId !== value.issuer.signingKeyId) {
      errors.push('lease signature key must match issuer signing key');
    }
    const expectedIssuer = value.status === 'requested'
      ? value.requestedByParticipantId
      : value.status === 'denied'
        ? value.decisionParticipantId
        : value.grantorParticipantId;
    if (value.issuer.participantId !== expectedIssuer) {
      errors.push('lease issuer must match the authoritative lifecycle participant');
    }
    if (value.status === 'active'
      && (value.atomicFocusRevalidation.checkedAt === null || value.atomicFocusRevalidation.receiptRef === null)) {
      errors.push('active lease requires atomic focus revalidation');
    }
  }

  if (name === 'porthole-completeness-receipt') {
    if (value.recordedSegmentCount !== value.verifiedSegmentCount + value.unreadableSegmentCount) {
      errors.push('recorded count must equal verified plus unreadable');
    }
    if (value.expectedCaptureCount
      !== value.recordedSegmentCount + value.declaredGapCount + value.missingCaptureCount) {
      errors.push('expected count must equal recorded plus declared gaps plus missing');
    }
    const first = value.streamBoundary.firstCaptureIndex;
    const last = value.streamBoundary.lastCaptureIndex;
    if (value.expectedCaptureCount === 0 && (first !== null || last !== null)) {
      errors.push('empty stream boundary must use null capture indexes');
    }
    if (value.expectedCaptureCount > 0
      && (first === null || last === null || last < first || last - first + 1 !== value.expectedCaptureCount)) {
      errors.push('stream capture-index boundary must span expected count');
    }
    if (value.signature.keyId !== value.issuer.signingKeyId) {
      errors.push('receipt signature key must match issuer signing key');
    }
    if (time('streamBoundary.closedAt', value.streamBoundary.closedAt) > time('issuedAt', value.issuedAt)) {
      errors.push('receipt cannot be issued before its stream closes');
    }
  }

  if (name === 'porthole-regression-receipt') {
    if (time('source.interval.startedAt', value.source.interval.startedAt)
      > time('source.interval.endedAt', value.source.interval.endedAt)) {
      errors.push('regression source interval is reversed');
    }
    const eventIds = value.source.events.map((event) => event.eventId);
    if (new Set(eventIds).size !== eventIds.length) errors.push('regression source event ids must be unique');
    const perspectiveIds = value.source.perspectives.map((perspective) => perspective.perspectiveId);
    if (new Set(perspectiveIds).size !== perspectiveIds.length) errors.push('regression source perspective ids must be unique');
    for (const boundaryId of [value.source.interval.startEventId, value.source.interval.endEventId]) {
      if (!eventIds.includes(boundaryId)) errors.push('regression interval boundary must cite a committed event');
    }
    const bugEvent = value.source.events.find((event) => event.eventId === value.source.bugReport.eventId);
    if (!bugEvent || bugEvent.commitment !== value.source.bugReport.commitment) {
      errors.push('bug report id and commitment must match the canonical event source');
    }
    if (value.privacy.scan.artifactManifestHash !== value.artifactManifest.manifestHash) {
      errors.push('privacy scan must bind the generated artifact manifest');
    }
    if (value.execution.targetBuildCommit !== value.environment.build.commitHash) {
      errors.push('execution target must match the attested build commit');
    }
    if (time('execution.startedAt', value.execution.startedAt) > time('execution.completedAt', value.execution.completedAt)) {
      errors.push('regression execution interval is reversed');
    }
    value.execution.attempts.forEach((attempt, index) => {
      if (attempt.attempt !== index + 1) errors.push('regression attempt ordinals must be contiguous');
      if (time(`execution.attempts[${index}].startedAt`, attempt.startedAt)
        > time(`execution.attempts[${index}].completedAt`, attempt.completedAt)) {
        errors.push('regression attempt interval is reversed');
      }
    });
    const attemptStatuses = value.execution.attempts.map((attempt) => attempt.status);
    if (attemptStatuses.at(-1) !== value.execution.status) errors.push('execution status must match the final attempt');
    if (value.execution.flakeAssessment === 'stable' && new Set(attemptStatuses).size !== 1) {
      errors.push('stable assessment requires identical attempt outcomes');
    }
    if (value.execution.flakeAssessment === 'flaky' && new Set(attemptStatuses).size < 2) {
      errors.push('flaky assessment requires differing attempt outcomes');
    }
    if (value.signature.keyId !== value.issuer.signingKeyId) {
      errors.push('regression signature key must match issuer signing key');
    }
  }

  if (name === 'porthole-disclosure-receipt') {
    if (time('source.interval.startedAt', value.source.interval.startedAt)
      > time('source.interval.endedAt', value.source.interval.endedAt)) {
      errors.push('disclosure source interval is reversed');
    }
    const sourceIds = value.source.items.map((item) => item.sourceId);
    if (new Set(sourceIds).size !== sourceIds.length) errors.push('disclosure source ids must be unique');
    const { canonicalManifest, reviewedPreview, delivery } = value.artifact;
    if (reviewedPreview.manifestId !== canonicalManifest.manifestId
      || delivery.manifestId !== canonicalManifest.manifestId
      || reviewedPreview.manifestHash !== canonicalManifest.manifestHash
      || delivery.manifestHash !== canonicalManifest.manifestHash) {
      errors.push('reviewed and delivered manifests must match the canonical manifest');
    }
    if (reviewedPreview.artifactHash !== delivery.artifactHash) {
      errors.push('delivered artifact hash must match the reviewed preview');
    }
    if (value.privacy.coverageVerifierKeyId === value.issuer.signingKeyId) {
      errors.push('coverage verification must not be self-attested by the disclosure issuer');
    }
    if (time('grant.issuedAt', value.grant.issuedAt) >= time('grant.expiresAt', value.grant.expiresAt)) {
      errors.push('disclosure grant must expire after issue');
    }
    if (value.grant.recipientKeyEnvelopeHash !== value.encryption.keyEnvelopeHash) {
      errors.push('key grant must bind the delivered encryption envelope');
    }
    if (value.grant.keyGrantReceiptRef !== value.accessLedger.grantReceipt.receiptRef) {
      errors.push('access ledger must begin with the key grant receipt');
    }
    const chain = [
      value.accessLedger.grantReceipt,
      ...value.accessLedger.accessReceipts,
      ...(value.accessLedger.revokeReceipt ? [value.accessLedger.revokeReceipt] : []),
      ...(value.accessLedger.expireReceipt ? [value.accessLedger.expireReceipt] : []),
    ];
    chain.forEach((receipt, index) => {
      if (receipt.sequence !== index) errors.push('disclosure access receipt sequence must be contiguous');
      if (index > 0 && receipt.prevHash !== chain[index - 1].contentHash) {
        errors.push('disclosure access receipt hash chain is broken');
      }
    });
    if (value.accessLedger.headHash !== chain.at(-1).contentHash) {
      errors.push('disclosure access head must match the final receipt');
    }
    if (time('artifact.reviewedPreview.reviewedAt', reviewedPreview.reviewedAt)
      > time('artifact.delivery.deliveredAt', delivery.deliveredAt)) {
      errors.push('disclosure cannot be delivered before preview review');
    }
    if (value.signature.keyId !== value.issuer.signingKeyId) {
      errors.push('disclosure signature key must match issuer signing key');
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// 1. Compilation and package shape
// ---------------------------------------------------------------------------

describe('agent-harbor v0 schema package', () => {
  it('ships exactly the frozen contracts plus fixtures', () => {
    const files = readdirSync(schemaDir).filter((f) => f.endsWith('.schema.json')).sort();
    expect(files).toEqual(SCHEMA_NAMES.map((n) => `${n}.schema.json`).sort());
  });

  for (const name of SCHEMA_NAMES) {
    describe(name, () => {
      const schema = loadSchema(name);

      it('compiles under the fail-closed keyword set', () => {
        expect(() => compile(schema)).not.toThrow();
      });

      it('carries $id, $schema, title, and its declared reader posture', () => {
        expect(schema.$id).toBe(`https://portdaddy.dev/schemas/agent-harbor/v0/${name}.schema.json`);
        expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
        expect(typeof schema.title).toBe('string');
        if (STRICT_SCHEMA_NAMES.has(name)) {
          expect(schema.additionalProperties).toBe(false);
        } else {
          // Tolerant reader (ADR-0095 §6): ordinary interop contracts accept future fields.
          expect(schema.additionalProperties).toBe(true);
        }
      });

      it('self-identifies its version', () => {
        if (name === 'transcript-event') {
          // TranscriptEvent is pinned by ch09's schemaVersion, not a schema const.
          expect(schema.properties.schemaVersion.const).toBe(1);
          expect(schema.required).toContain('schemaVersion');
        } else if (name in PORTHOLE_SCHEMA_CONSTS) {
          expect(schema.properties.schema.const).toBe(PORTHOLE_SCHEMA_CONSTS[name]);
          expect(schema.required).toContain('schema');
        } else {
          expect(schema.properties.schema.const).toBe(`pd.agent-harbor.${name}.v0`);
          expect(schema.required).toContain('schema');
        }
      });

      it('validates its fixture instance', () => {
        const errors = validate(schema, loadFixture(name));
        expect(errors).toEqual([]);
      });

      it('enforces its declared unknown-field posture', () => {
        const extended = { ...loadFixture(name), xFutureField: { anything: true } };
        if (STRICT_SCHEMA_NAMES.has(name)) {
          expect(validate(schema, extended).some((error) => error.includes('unexpected property'))).toBe(true);
        } else {
          expect(validate(schema, extended)).toEqual([]);
        }
      });

      it('rejects a fixture missing a required field', () => {
        const fixture = loadFixture(name);
        const anchor = schema.required.find((k) => k !== 'schema') ?? schema.required[0];
        const broken = { ...fixture };
        delete broken[anchor];
        expect(validate(schema, broken).length).toBeGreaterThan(0);
      });
    });
  }

  it('rejects wrong enum values (compliance level beyond the ladder)', () => {
    const schema = loadSchema('agent-node');
    const broken = { ...loadFixture('agent-node'), complianceLevel: 'C7' };
    expect(validate(schema, broken).some((e) => e.includes('complianceLevel'))).toBe(true);
  });

  it('rejects a wrong schema discriminator', () => {
    const schema = loadSchema('work-intent');
    const broken = { ...loadFixture('work-intent'), schema: 'pd.agent-harbor.work-intent.v1' };
    expect(validate(schema, broken).some((e) => e.includes('const'))).toBe(true);
  });

  it('validator drift lock: every additionalProperties form compile() accepts is enforced by validate()', () => {
    // The subschema form: undeclared keys are validated against it, not ignored.
    const sub = { type: 'object', properties: { a: { type: 'string' } }, additionalProperties: { type: 'integer' } };
    expect(() => compile(sub)).not.toThrow();
    expect(validate(sub, { a: 'x', extra: 3 })).toEqual([]);
    expect(validate(sub, { a: 'x', extra: 'not-an-int' }).some((e) => e.includes('extra'))).toBe(true);
    // The boolean-false form: undeclared keys are rejected even with no `properties` map.
    const closed = { type: 'object', additionalProperties: false };
    expect(validate(closed, { anything: 1 }).some((e) => e.includes('unexpected property'))).toBe(true);
  });
});

describe('Porthole v1 security and causality invariants', () => {
  it('separates a person/operator actor from the captured surface and seals target descriptors', () => {
    const schema = loadSchema('porthole-perspective');
    const fixture = loadFixture('porthole-perspective');
    expect(fixture.actor).toEqual({ kind: 'person', role: 'operator', personId: 'person_erich' });
    expect(fixture.agentNodeId).toBeNull();
    expect(validate(schema, fixture)).toEqual([]);
    expect(validatePortholeSemantics('porthole-perspective', fixture)).toEqual([]);

    const personClaimingAgentNode = copy(fixture);
    personClaimingAgentNode.agentNodeId = 'agent_node_forged';
    expect(validate(schema, personClaimingAgentNode).some((error) => error.includes('agentNodeId'))).toBe(true);

    const leakedTarget = copy(fixture);
    leakedTarget.surface.title = 'Secret customer checkout';
    expect(validate(schema, leakedTarget).some((error) => error.includes('unexpected property "title"'))).toBe(true);

    const disembodied = copy(fixture);
    disembodied.bodyId = null;
    expect(validate(schema, disembodied).some((error) => error.includes('bodyId'))).toBe(true);
  });

  it('requires an AgentNode for agent actors and enforces the pre-capture schedule shape', () => {
    const schema = loadSchema('porthole-perspective');
    const agent = copy(loadFixture('porthole-perspective'));
    agent.actor = { kind: 'agent', role: 'collaborator', personId: null };
    agent.participantId = 'agent_builder';
    agent.agentNodeId = 'agent_node_builder';
    agent.bodyId = 'body_chrome_tab_42';
    expect(validate(schema, agent)).toEqual([]);

    agent.agentNodeId = null;
    expect(validate(schema, agent).some((error) => error.includes('agentNodeId'))).toBe(true);

    const eventDrivenWithInterval = copy(loadFixture('porthole-perspective'));
    eventDrivenWithInterval.captureSchedule.mode = 'event-driven';
    expect(validate(schema, eventDrivenWithInterval).some((error) => error.includes('samplingIntervalMs'))).toBe(true);

    const committedLate = copy(loadFixture('porthole-perspective'));
    committedLate.captureSchedule.committedAt = '2026-08-30T18:00:01.000Z';
    expect(validatePortholeSemantics('porthole-perspective', committedLate)).toContain(
      'captureSchedule must be committed before capture starts',
    );
  });

  it('makes a perspective/channel one retention unit', () => {
    const fixture = loadFixture('porthole-perspective');
    const wrongUnit = copy(fixture);
    wrongUnit.retention.unitId = 'segment_42';
    expect(validatePortholeSemantics('porthole-perspective', wrongUnit)).toContain(
      'retention unitId must equal perspectiveId',
    );
    const wrongChannel = copy(fixture);
    wrongChannel.retention.channelId = 'porthole:another-perspective';
    expect(validatePortholeSemantics('porthole-perspective', wrongChannel)).toContain(
      'retention and encryption channelId must match',
    );
  });

  it('keeps the durable stage target opaque and rejects every raw descriptor field', () => {
    const schema = loadSchema('porthole-stage');
    const fixture = loadFixture('porthole-stage');
    const targetSchema = schema.properties.target;
    const forbidden = ['application', 'processId', 'windowId', 'bundleId', 'title', 'url'];

    expect(validate(schema, fixture)).toEqual([]);
    expect(targetSchema.additionalProperties).toBe(false);
    expect(Object.keys(fixture.target).sort()).toEqual(['descriptor', 'kind', 'platform', 'targetId']);
    for (const field of forbidden) {
      expect(targetSchema.properties).not.toHaveProperty(field);
      const leaked = copy(fixture);
      leaked.target[field] = field.endsWith('Id') ? 8842 : 'private descriptor';
      expect(validate(schema, leaked).some((error) => error.includes(`unexpected property "${field}"`))).toBe(true);
    }

    const leakedInsideEnvelope = copy(fixture);
    leakedInsideEnvelope.target.descriptor.title = 'Secret customer checkout';
    expect(validate(schema, leakedInsideEnvelope).some((error) => error.includes('unexpected property "title"'))).toBe(true);

    const revealingHandle = copy(fixture);
    revealingHandle.target.targetId = 'mac-window:8842';
    expect(validate(schema, revealingHandle).some((error) => error.includes('targetId'))).toBe(true);

    for (const [site, field] of [
      ['participants', 'email'],
      ['semanticAdapters', 'rawConfiguration'],
      ['transport', 'relayToken'],
      ['controlPolicy', 'operatorSecret'],
    ]) {
      const leaked = copy(fixture);
      if (site === 'participants' || site === 'semanticAdapters') leaked[site][0][field] = 'private';
      else leaked[site][field] = 'private';
      expect(validate(schema, leaked).some((error) => error.includes(`unexpected property "${field}"`))).toBe(true);
    }
  });

  it('requires consent, readiness, privacy policy, and E2EE device policy before a stage is live or remote', () => {
    const schema = loadSchema('porthole-stage');
    const fixture = loadFixture('porthole-stage');
    expect(validate(schema, fixture)).toEqual([]);
    expect(fixture.controlPolicy).toMatchObject({
      pointing: 'concurrent',
      commenting: 'concurrent',
      input: 'explicit-lease',
    });

    const unconsented = copy(fixture);
    unconsented.consent.state = 'pending';
    expect(validate(schema, unconsented).some((error) => error.includes('consent.state'))).toBe(true);

    const unready = copy(fixture);
    unready.readiness.state = 'degraded';
    expect(validate(schema, unready).some((error) => error.includes('readiness.state'))).toBe(true);

    for (const field of ['exactTargetOnly', 'backgroundMediaBlocked', 'secretStrippingRequired']) {
      const unsafe = copy(fixture);
      unsafe.privacyPolicy[field] = false;
      expect(validate(schema, unsafe).some((error) => error.includes(field))).toBe(true);
    }

    for (const field of ['pointing', 'commenting']) {
      const leasedCollaboration = copy(fixture);
      leasedCollaboration.controlPolicy[field] = 'lease';
      expect(validate(schema, leasedCollaboration).some((error) => error.includes(field))).toBe(true);
    }

    const remote = copy(fixture);
    remote.transport = {
      scope: 'remote',
      media: 'webrtc',
      events: 'data-channel',
      endToEndEncrypted: true,
      enrolledDevicePolicyRef: 'device-policy_porthole-team-1',
      rekeyPolicyRef: 'rekey-policy_porthole-hourly-1',
    };
    expect(validate(schema, remote)).toEqual([]);

    const unencryptedRemote = copy(remote);
    unencryptedRemote.transport.endToEndEncrypted = false;
    expect(validate(schema, unencryptedRemote).some((error) => error.includes('endToEndEncrypted'))).toBe(true);
    const unenrolledRemote = copy(remote);
    unenrolledRemote.transport.enrolledDevicePolicyRef = null;
    expect(validate(schema, unenrolledRemote).some((error) => error.includes('enrolledDevicePolicyRef'))).toBe(true);
    const remoteDisguisedAsLocal = copy(remote);
    remoteDisguisedAsLocal.transport.scope = 'local';
    expect(validate(schema, remoteDisguisedAsLocal).some((error) => error.includes('scope'))).toBe(true);
  });

  it('allows null hashes only for truly ephemeral pointer or presence events', () => {
    const schema = loadSchema('porthole-stage-event');
    const pointer = copy(loadFixture('porthole-stage-event'));
    Object.assign(pointer, {
      eventId: 'pointer_ephemeral_1',
      kind: 'pointer',
      durability: 'ephemeral',
      phase: 'observation',
      sequence: null,
      bodyId: 'body_pointer_client_1',
      timing: {
        ...pointer.timing,
        display: null,
        committedAt: null,
      },
      ephemeralState: {
        perspectiveId: 'pov_01JZPORT0001',
        geometry: { x: 0.71, y: 0.64 },
        presenceStatus: null,
        pointerStatus: 'visible',
      },
      sealedContent: null,
      causedByEventIds: [],
      controlLeaseId: null,
      leaseGrantEventId: null,
      authorizationReceiptId: null,
      actionIntentEventId: null,
      issuer: null,
      contentHash: null,
      prevHash: null,
      signature: null,
    });
    expect(validate(schema, pointer)).toEqual([]);

    const ephemeralComment = { ...pointer, kind: 'comment-created' };
    expect(validate(schema, ephemeralComment).some((error) => error.includes('kind'))).toBe(true);
    const unhashedCheckpoint = { ...pointer, durability: 'checkpoint', sequence: 8 };
    expect(validate(schema, unhashedCheckpoint).some((error) => error.includes('contentHash'))).toBe(true);

    const signedEphemeral = copy(pointer);
    signedEphemeral.signature = copy(loadFixture('porthole-stage-event').signature);
    expect(validate(schema, signedEphemeral).some((error) => error.includes('signature'))).toBe(true);
  });

  it('seals all durable event content and requires a verified privacy receipt plus attributable signature', () => {
    const schema = loadSchema('porthole-stage-event');
    const event = loadFixture('porthole-stage-event');
    expect(validate(schema, event)).toEqual([]);
    expect(schema.properties).not.toHaveProperty('payload');
    expect(schema.properties).not.toHaveProperty('anchor');

    for (const leakedField of ['payload', 'anchor']) {
      const leaked = copy(event);
      leaked[leakedField] = { text: 'secret', semantic: { name: 'Place order', path: '/Checkout' } };
      expect(validate(schema, leaked).some((error) => error.includes(`unexpected property "${leakedField}"`))).toBe(true);
    }
    const leakedEnvelope = copy(event);
    leakedEnvelope.sealedContent.semanticName = 'Place order';
    expect(validate(schema, leakedEnvelope).some((error) => error.includes('unexpected property "semanticName"'))).toBe(true);

    const unverifiedPrivacy = copy(event);
    unverifiedPrivacy.sealedContent.privacyReceipt.verification = 'pending';
    expect(validate(schema, unverifiedPrivacy).some((error) => error.includes('verification'))).toBe(true);
    const unsigned = copy(event);
    unsigned.signature = null;
    expect(validate(schema, unsigned).some((error) => error.includes('signature'))).toBe(true);
    const unattributed = copy(event);
    unattributed.issuer = null;
    expect(validate(schema, unattributed).some((error) => error.includes('issuer'))).toBe(true);

    const forgedSigner = copy(event);
    forgedSigner.signature.keyId = 'another-key';
    expect(validatePortholeSemantics('porthole-stage-event', forgedSigner)).toContain(
      'durable event signature key must match issuer signing key',
    );
    const forgedAttribution = copy(event);
    forgedAttribution.issuer.participantId = 'person_someone_else';
    expect(validatePortholeSemantics('porthole-stage-event', forgedAttribution)).toContain(
      'durable event issuer must match attributed participant',
    );
  });

  it('requires append-only input effects to cite body, lease grant, authorization, and intent', () => {
    const schema = loadSchema('porthole-stage-event');
    const effect = loadFixture('porthole-stage-event');
    expect(validate(schema, effect)).toEqual([]);
    expect(validatePortholeSemantics('porthole-stage-event', effect)).toEqual([]);

    for (const field of ['bodyId', 'controlLeaseId', 'leaseGrantEventId', 'authorizationReceiptId', 'actionIntentEventId']) {
      const broken = copy(effect);
      broken[field] = null;
      expect(validate(schema, broken).some((error) => error.includes(field))).toBe(true);
    }

    const disconnected = copy(effect);
    disconnected.causedByEventIds = ['some_other_event', disconnected.leaseGrantEventId];
    expect(validatePortholeSemantics('porthole-stage-event', disconnected)).toContain(
      'input outcome must cite its action intent in causedByEventIds',
    );
  });

  it('enforces coherent control-lease states and receipt transitions', () => {
    const schema = loadSchema('porthole-control-lease');
    const active = loadFixture('porthole-control-lease');
    expect(validate(schema, active)).toEqual([]);
    expect(validatePortholeSemantics('porthole-control-lease', active)).toEqual([]);

    const activeWithoutAuthorization = copy(active);
    activeWithoutAuthorization.receipts.authorization = null;
    expect(validate(schema, activeWithoutAuthorization).some((error) => error.includes('authorization'))).toBe(true);

    const requestedWithGrant = copy(active);
    Object.assign(requestedWithGrant, {
      status: 'requested',
      decisionParticipantId: null,
      grantorParticipantId: null,
    });
    Object.assign(requestedWithGrant.timing, {
      grantedAt: null, authorizedAt: null, expiresAt: null,
      terminationRequestedAt: null, terminalAt: null,
    });
    Object.assign(requestedWithGrant.atomicFocusRevalidation, { checkedAt: null, receiptRef: null });
    requestedWithGrant.receipts.authorization = null;
    requestedWithGrant.receipts.terminal = null;
    requestedWithGrant.issuer.participantId = requestedWithGrant.requestedByParticipantId;
    expect(validate(schema, requestedWithGrant).some((error) => error.includes('receipts.grant'))).toBe(true);

    const reversed = copy(active);
    reversed.timing.expiresAt = '2026-08-30T18:00:14.500Z';
    expect(validatePortholeSemantics('porthole-control-lease', reversed)).toContain(
      'expiresAt must follow authorizedAt',
    );

    for (const forbidden of ['pointer', 'clipboard']) {
      const legacy = copy(active);
      legacy.capabilities = [forbidden];
      expect(validate(schema, legacy).some((error) => error.includes('capabilities'))).toBe(true);
    }
    const overlong = copy(active);
    overlong.timing.expiresAt = '2026-08-30T18:00:46.000Z';
    expect(validatePortholeSemantics('porthole-control-lease', overlong)).toContain('lease TTL exceeds maxTtlMs');

    const overBudget = copy(active);
    overBudget.actionBudget = { maxActions: 1, usedActions: 2 };
    expect(validatePortholeSemantics('porthole-control-lease', overBudget)).toContain('usedActions exceeds maxActions');

    const clipboardRead = copy(active);
    clipboardRead.capabilities = ['clipboard-read'];
    expect(validatePortholeSemantics('porthole-control-lease', clipboardRead)).toContain(
      'clipboard-read requires an explicit authorization receipt',
    );

    const forgedSigner = copy(active);
    forgedSigner.signature.keyId = 'another-key';
    expect(validatePortholeSemantics('porthole-control-lease', forgedSigner)).toContain(
      'lease signature key must match issuer signing key',
    );
  });

  it('binds completeness to the committed schedule, exact stream boundary, verified counts, and issuer', () => {
    const schema = loadSchema('porthole-completeness-receipt');
    const receipt = loadFixture('porthole-completeness-receipt');
    expect(validate(schema, receipt)).toEqual([]);
    expect(validatePortholeSemantics('porthole-completeness-receipt', receipt)).toEqual([]);
    expect(schema.properties).not.toHaveProperty('plaintextByteCount');
    expect(schema.properties).not.toHaveProperty('ciphertextByteCount');

    const launderedCounts = copy(receipt);
    launderedCounts.verifiedSegmentCount = 11;
    expect(validatePortholeSemantics('porthole-completeness-receipt', launderedCounts)).toContain(
      'recorded count must equal verified plus unreadable',
    );

    const falselyComplete = copy(receipt);
    falselyComplete.status = 'complete';
    expect(validate(schema, falselyComplete).some((error) => error.includes('unreadableSegmentCount'))).toBe(true);

    const forgedSigner = copy(receipt);
    forgedSigner.signature.keyId = 'another-key';
    expect(validatePortholeSemantics('porthole-completeness-receipt', forgedSigner)).toContain(
      'receipt signature key must match issuer signing key',
    );

    const disembodiedIssuer = copy(receipt);
    disembodiedIssuer.issuer.bodyId = null;
    expect(validate(schema, disembodiedIssuer).some((error) => error.includes('issuer.bodyId'))).toBe(true);
  });

  it('requires signed, privacy-scanned regression evidence with attested execution and terminal review', () => {
    const schema = loadSchema('porthole-regression-receipt');
    const receipt = loadFixture('porthole-regression-receipt');
    expect(validate(schema, receipt)).toEqual([]);
    expect(validatePortholeSemantics('porthole-regression-receipt', receipt)).toEqual([]);
    for (const superseded of [
      'bugReportEventId', 'sourceEventIds', 'perspectiveIds', 'framework',
      'artifactRef', 'artifactHash', 'generatedAt',
    ]) {
      expect(schema.properties).not.toHaveProperty(superseded);
    }

    const duplicateSource = copy(receipt);
    duplicateSource.source.events[1].eventId = duplicateSource.source.events[0].eventId;
    expect(validatePortholeSemantics('porthole-regression-receipt', duplicateSource)).toContain(
      'regression source event ids must be unique',
    );
    const mismatchedBug = copy(receipt);
    mismatchedBug.source.bugReport.commitment = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
    expect(validatePortholeSemantics('porthole-regression-receipt', mismatchedBug)).toContain(
      'bug report id and commitment must match the canonical event source',
    );

    for (const [path, mutate] of [
      ['privacy.scan.status', (broken) => { broken.privacy.scan.status = 'failed'; }],
      ['environment.cleanProfile.state', (broken) => { broken.environment.cleanProfile.state = 'dirty'; }],
      ['artifactManifest.files[0].sha256', (broken) => { broken.artifactManifest.files[0].sha256 = 'not-a-hash'; }],
      ['signature', (broken) => { broken.signature = null; }],
    ]) {
      const broken = copy(receipt);
      mutate(broken);
      expect(validate(schema, broken).some((error) => error.includes(path.split('.')[0]))).toBe(true);
    }

    const noFlakeProof = copy(receipt);
    noFlakeProof.execution.attempts = [noFlakeProof.execution.attempts[0]];
    expect(validate(schema, noFlakeProof).some((error) => error.includes('attempts'))).toBe(true);
    const falseStable = copy(receipt);
    falseStable.execution.attempts[0].status = 'failed';
    expect(validatePortholeSemantics('porthole-regression-receipt', falseStable)).toContain(
      'stable assessment requires identical attempt outcomes',
    );

    const acceptedFailure = copy(receipt);
    acceptedFailure.execution.status = 'failed';
    acceptedFailure.execution.attempts[1].status = 'failed';
    expect(validate(schema, acceptedFailure).some((error) => error.includes('execution.status'))).toBe(true);
    const contradictoryRejection = copy(receipt);
    contradictoryRejection.review.decision = 'rejected';
    contradictoryRejection.review.rejectionReason = 'Generated selector was unstable.';
    expect(validate(schema, contradictoryRejection).some((error) => error.includes('acceptedCommit'))).toBe(true);

    const forgedSigner = copy(receipt);
    forgedSigner.signature.keyId = 'another-key';
    expect(validatePortholeSemantics('porthole-regression-receipt', forgedSigner)).toContain(
      'regression signature key must match issuer signing key',
    );
  });

  it('binds disclosure preview, delivery, source commitments, sealed metadata, grants, and access receipts', () => {
    const schema = loadSchema('porthole-disclosure-receipt');
    const receipt = loadFixture('porthole-disclosure-receipt');
    expect(validate(schema, receipt)).toEqual([]);
    expect(validatePortholeSemantics('porthole-disclosure-receipt', receipt)).toEqual([]);

    const declaredPropertyNames = [];
    const collectPropertyNames = (node) => {
      if (!node || typeof node !== 'object') return;
      if (node.properties) declaredPropertyNames.push(...Object.keys(node.properties));
      for (const child of Object.values(node)) collectPropertyNames(child);
    };
    collectPropertyNames(schema);
    for (const plaintextField of ['purpose', 'recipientId', 'workItemRef', 'reviewedBy']) {
      expect(declaredPropertyNames).not.toContain(plaintextField);
    }
    const leakedPurpose = copy(receipt);
    leakedPurpose.purpose = { statement: 'private bug report purpose' };
    expect(validate(schema, leakedPurpose).some((error) => error.includes('unexpected property "purpose"'))).toBe(true);
    const incompleteSealing = copy(receipt);
    incompleteSealing.sealedMetadata.protectedFields = ['recipient', 'purpose'];
    expect(validate(schema, incompleteSealing).some((error) => error.includes('protectedFields'))).toBe(true);

    const rawDerivative = copy(receipt);
    rawDerivative.artifact.canonicalManifest.rawEvidenceIncluded = true;
    expect(validate(schema, rawDerivative).some((error) => error.includes('rawEvidenceIncluded'))).toBe(true);

    const duplicateSource = copy(receipt);
    duplicateSource.source.items[1].sourceId = duplicateSource.source.items[0].sourceId;
    expect(validatePortholeSemantics('porthole-disclosure-receipt', duplicateSource)).toContain(
      'disclosure source ids must be unique',
    );
    const swappedDelivery = copy(receipt);
    swappedDelivery.artifact.delivery.artifactHash = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
    expect(validatePortholeSemantics('porthole-disclosure-receipt', swappedDelivery)).toContain(
      'delivered artifact hash must match the reviewed preview',
    );
    const differentManifest = copy(receipt);
    differentManifest.artifact.delivery.manifestHash = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
    expect(validatePortholeSemantics('porthole-disclosure-receipt', differentManifest)).toContain(
      'reviewed and delivered manifests must match the canonical manifest',
    );

    const selfAttestedCoverage = copy(receipt);
    selfAttestedCoverage.privacy.coverageVerifierKeyId = selfAttestedCoverage.issuer.signingKeyId;
    expect(validatePortholeSemantics('porthole-disclosure-receipt', selfAttestedCoverage)).toContain(
      'coverage verification must not be self-attested by the disclosure issuer',
    );
    const bareCoverage = copy(receipt);
    bareCoverage.privacy.coverage = 'complete';
    expect(validate(schema, bareCoverage).some((error) => error.includes('coverage'))).toBe(true);

    const brokenChain = copy(receipt);
    brokenChain.accessLedger.accessReceipts[0].prevHash = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
    expect(validatePortholeSemantics('porthole-disclosure-receipt', brokenChain)).toContain(
      'disclosure access receipt hash chain is broken',
    );
    const undeclaredAccessPayload = copy(receipt);
    undeclaredAccessPayload.accessLedger.accessReceipts[0].viewer = 'person_reviewer';
    expect(validate(schema, undeclaredAccessPayload).some((error) => error.includes('unexpected property "viewer"'))).toBe(true);

    const revokedWithoutReceipt = copy(receipt);
    revokedWithoutReceipt.grant.status = 'revoked';
    revokedWithoutReceipt.grant.terminalAt = '2026-08-30T18:08:00.000Z';
    expect(validate(schema, revokedWithoutReceipt).some((error) => error.includes('revokeReceipt'))).toBe(true);

    const forgedSigner = copy(receipt);
    forgedSigner.signature.keyId = 'another-key';
    expect(validatePortholeSemantics('porthole-disclosure-receipt', forgedSigner)).toContain(
      'disclosure signature key must match issuer signing key',
    );
  });
});

// ---------------------------------------------------------------------------
// 1b. Shared native Surface Gateway contract.
// ---------------------------------------------------------------------------

describe('Agent Harbor native Surface Gateway contract', () => {
  const gatewaySchema = loadSchema('surface-gateway');

  function gateway(overrides) {
    return {
      ...loadFixture('surface-gateway'),
      ...overrides,
    };
  }

  function capabilityDecision(overrides) {
    return {
      ...loadFixture('surface-gateway').capabilityDecision,
      ...overrides,
    };
  }

  it('freezes the shared surface set for pd-console, FleetBar, Scout, CLI, and MCP', () => {
    expect(gatewaySchema.properties.surface.enum).toEqual(['pd-console', 'fleetbar', 'scout', 'cli', 'mcp']);
    expect([...SURFACE_GATEWAY_SURFACES]).toEqual(gatewaySchema.properties.surface.enum);
  });

  it('freezes command/query/event modes over the runtime nouns without legacy verbs', () => {
    expect(gatewaySchema.properties.mode.enum).toEqual(['command', 'query', 'event']);
    expect([...SURFACE_GATEWAY_DIRECTIONS]).toEqual(gatewaySchema.properties.direction.enum);
    expect([...SURFACE_GATEWAY_MODES]).toEqual(gatewaySchema.properties.mode.enum);
    expect(gatewaySchema.properties.noun.enum).toEqual([
      'WorkIntent',
      'WorkPlan',
      'AgentNode',
      'AgentRun',
      'Body',
      'ControlCommand',
      'TranscriptEvent',
      'CapabilityDecision',
      'WorkReceipt',
      'BerthTarget',
    ]);
    expect([...SURFACE_GATEWAY_NOUNS]).toEqual(gatewaySchema.properties.noun.enum);
    for (const superseded of ['Spawn', 'Dispatch', 'Sortie', 'Nightshift']) {
      expect(gatewaySchema.properties.noun.enum).not.toContain(superseded);
    }
  });

  it('validates a command envelope from FleetBar to the daemon', () => {
    const command = loadFixture('surface-gateway');
    expect(command.mode).toBe('command');
    expect(command.noun).toBe('ControlCommand');
    expect(command.surface).toBe('fleetbar');
    expect(validate(gatewaySchema, command)).toEqual([]);
  });

  it('validates a query envelope from pd-console without inventing runtime routing', () => {
    const query = gateway({
      envelopeId: 'surface_gateway_query_01JZFIX0001',
      surface: 'pd-console',
      direction: 'surface-to-daemon',
      mode: 'query',
      noun: 'AgentRun',
      operation: 'agent-run.list',
      issuedBy: 'pd-console:operator:erich',
      idempotencyKey: null,
      capabilityDecision: capabilityDecision({
        decisionId: 'cap_decision_query_01JZFIX0001',
        surface: 'pd-console',
        operation: 'agent-run.list',
        capability: 'agent-run',
        reason: 'Query allowed against selected berth.',
        evidence: {
          berthTargetId: 'berth_target_stable',
        },
      }),
      payload: {
        filters: { status: 'running' },
      },
      projection: {
        stale: false,
        lastLedgerSeq: 42,
        headSeq: 42,
      },
    });
    expect(validate(gatewaySchema, query)).toEqual([]);
  });

  it('validates an event envelope from the daemon to Scout', () => {
    const event = gateway({
      envelopeId: 'surface_gateway_event_01JZFIX0001',
      surface: 'scout',
      direction: 'daemon-to-surface',
      mode: 'event',
      noun: 'TranscriptEvent',
      operation: 'transcript-event.appended',
      issuedBy: 'daemon:local',
      idempotencyKey: null,
      capabilityDecision: capabilityDecision({
        decisionId: 'cap_decision_event_01JZFIX0001',
        surface: 'scout',
        operation: 'transcript-event.appended',
        capability: 'transcript-event',
        reason: 'Subscribed surface may receive transcript event projection.',
        evidence: {
          berthTargetId: 'berth_target_stable',
          transcriptEventId: 'evt_01JZFIX0042',
        },
      }),
      payload: {
        eventId: 'evt_01JZFIX0042',
        sessionId: 'session_01JZFIX0001',
        agentNodeId: 'agent_node_01JZFIX0001',
        sequence: 42,
        occurredAt: '2026-07-05T12:04:01.000Z',
        schemaVersion: 1,
        kind: 'tool_result',
      },
      projection: {
        stale: false,
        lastLedgerSeq: 43,
        headSeq: 43,
      },
    });
    expect(validate(gatewaySchema, event)).toEqual([]);
  });

  it('requires target authority and freshness labeling on gateway envelopes', () => {
    expect(gatewaySchema.required).toEqual(expect.arrayContaining(['berthTarget', 'payload', 'projection']));
    expect(gatewaySchema.properties.berthTarget.required).toEqual(['targetId', 'tier', 'label', 'canonical', 'authority']);
    expect(gatewaySchema.properties.berthTarget.properties.authority.required).toEqual([
      'domain',
      'canCommand',
      'canQuery',
      'canSubscribeEvents',
    ]);
    expect(gatewaySchema.properties.capabilityDecision.required).toEqual(expect.arrayContaining([
      'schema',
      'surface',
      'operation',
      'capability',
      'authority',
      'issuedAt',
    ]));
    expect(gatewaySchema.properties.projection.required).toContain('stale');

    const missingTarget = { ...loadFixture('surface-gateway') };
    delete missingTarget.berthTarget;
    expect(validate(gatewaySchema, missingTarget).some((e) => e.includes('berthTarget'))).toBe(true);
  });
});

describe('Body, CapabilityDecision, and BerthTarget contract semantics', () => {
  it('Body is a first-class runtime noun and mirrors AgentRun.body adapter literals', () => {
    const body = loadSchema('body');
    const agentRunBody = loadSchema('agent-run').properties.body;

    expect(body.properties.kind.enum).toEqual(agentRunBody.properties.kind.enum);
    expect(body.properties.modelTier.enum).toEqual(agentRunBody.properties.modelTier.enum);
    expect(body.properties.launchMode.enum).toEqual(agentRunBody.properties.launchMode.enum);
    expect([...BODY_KINDS]).toEqual(body.properties.kind.enum);
    expect([...MODEL_TIERS]).toEqual(body.properties.modelTier.enum);
    expect([...LAUNCH_MODES]).toEqual(body.properties.launchMode.enum);
    expect(body.required).toEqual(expect.arrayContaining(['bodyId', 'agentNodeId', 'kind', 'provider', 'modelTier', 'launchMode', 'status']));
    expect(validate(body, loadFixture('body'))).toEqual([]);
  });

  it('CapabilityDecision requires a non-surface authority domain and an auditable reason', () => {
    const schema = loadSchema('capability-decision');
    const fixture = loadFixture('capability-decision');

    expect(schema.required).toEqual(expect.arrayContaining(['authority', 'reason', 'issuedAt']));
    expect(schema.properties.authority.required).toEqual(['domain', 'decidedBy']);
    expect(schema.properties.authority.properties.domain.enum).toEqual([
      'daemon-registry',
      'operator-selection',
      'policy',
      'lease',
      'read-only-import',
    ]);
    expect([...CAPABILITY_DECISION_SURFACES]).toEqual(schema.properties.surface.enum);
    expect([...CAPABILITY_NAMES]).toEqual(schema.properties.capability.enum);
    expect([...CAPABILITY_DECISIONS]).toEqual(schema.properties.decision.enum);
    expect([...CAPABILITY_DECISION_DOMAINS]).toEqual(schema.properties.authority.properties.domain.enum);
    expect(schema.properties.authority.properties.domain.enum).not.toContain('fleetbar');
    expect(schema.properties.capability.enum).toContain('capability-decision');
    expect(validate(schema, fixture)).toEqual([]);

    const surfaceClaimedAuthority = { ...fixture, authority: { ...fixture.authority, domain: 'fleetbar' } };
    expect(validate(schema, surfaceClaimedAuthority).some((e) => e.includes('authority.domain'))).toBe(true);
  });

  it('BerthTarget freezes canonical/dev/codebase/remote domain authority instead of letting a UI promote itself', () => {
    const schema = loadSchema('berth-target');
    const fixture = loadFixture('berth-target');

    expect(schema.required).toEqual(expect.arrayContaining(['tier', 'canonical', 'resolution', 'authority']));
    expect(schema.properties.tier.enum).toEqual(['stable', 'dev-latest', 'codebase', 'remote']);
    expect([...BERTH_TARGET_TIERS]).toEqual(schema.properties.tier.enum);
    expect([...BERTH_RESOLUTION_STATES]).toEqual(schema.properties.resolution.properties.state.enum);
    expect([...BERTH_RESOLUTION_SOURCES]).toEqual(schema.properties.resolution.properties.source.enum);
    expect(schema.properties.authority.properties.domain.enum).toEqual([
      'canonical-local',
      'dev-lane',
      'worktree-lane',
      'remote-harbor',
      'read-only-import',
    ]);
    expect([...BERTH_AUTHORITY_DOMAINS]).toEqual(schema.properties.authority.properties.domain.enum);
    expect([...BERTH_AUTHORITY_GRANTS]).toEqual(schema.properties.authority.properties.grantedBy.enum);
    expect(schema.properties.authority.required).toEqual([
      'domain',
      'grantedBy',
      'canCommand',
      'canQuery',
      'canSubscribeEvents',
    ]);
    expect(validate(schema, fixture)).toEqual([]);

    const uiPromoted = { ...fixture, authority: { ...fixture.authority, domain: 'fleetbar' } };
    expect(validate(schema, uiPromoted).some((e) => e.includes('authority.domain'))).toBe(true);

    const readOnlyImport = {
      ...fixture,
      targetId: 'berth_target_imported',
      tier: 'remote',
      label: 'imported-run',
      canonical: false,
      authority: {
        domain: 'read-only-import',
        grantedBy: 'read-only-import',
        canCommand: false,
        canQuery: true,
        canSubscribeEvents: true,
      },
    };
    expect(validate(schema, readOnlyImport)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. ADR-0095 fork resolutions cannot drift
// ---------------------------------------------------------------------------

describe('ADR-0095 fork resolutions', () => {
  it('fork 1: TranscriptEvent uses ch09 canonical field names, not the ch03 variant', () => {
    const props = loadSchema('transcript-event').properties;
    for (const canonical of ['agentNodeId', 'bodyId', 'payloadJson', 'payloadBlobRefs', 'redactionState', 'retentionPolicyId']) {
      expect(props).toHaveProperty(canonical);
    }
    // Superseded ch03 names must not reappear.
    for (const superseded of ['agentId', 'blobRefs', 'redaction', 'retention', 'body']) {
      expect(props).not.toHaveProperty(superseded);
    }
  });

  it('fork 2: the compliance ladder is exactly the 7 levels C0..C6 on every surface', () => {
    const ladder = ['C0', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6'];
    expect(loadSchema('agent-node').properties.complianceLevel.enum).toEqual(ladder);
    expect(loadSchema('compliance-probe-result').properties.complianceLevel.enum).toEqual(ladder);
    const fidelity = ['T0', 'T1', 'T2', 'T3', 'T4', 'T5'];
    expect(loadSchema('agent-node').properties.transcriptFidelity.enum).toEqual(fidelity);
    expect(loadSchema('compliance-probe-result').properties.transcriptFidelity.enum).toEqual(fidelity);
  });

  it('fork 2 corollary: probe checks must declare daemon witness — self-report is representable and detectable', () => {
    const checkSchema = loadSchema('compliance-probe-result').properties.checks.items;
    expect(checkSchema.required).toContain('daemonWitnessed');
  });

  it('fork 4: WorkPlan shape is exactly the seven topology archetypes', () => {
    expect(loadSchema('work-plan').properties.shape.enum).toEqual([
      'single-node', 'scout', 'chain', 'dag-workgroup', 'tournament', 'ambient-watcher', 'human-gate',
    ]);
  });

  it('fork 4: legacy verbs exist only as WorkIntent source metadata', () => {
    const source = loadSchema('work-intent').properties.source;
    expect(source.properties.legacyVerb.enum).toEqual(['spawn', 'dispatch', 'sortie', 'conjure', 'nightshift', null]);
    // The intake source kinds include compat, but no legacy verb is a kind itself.
    const kinds = source.properties.kind.enum;
    expect(kinds).toContain('compat');
    for (const verb of ['spawn', 'dispatch', 'sortie', 'conjure', 'nightshift']) {
      expect(kinds).not.toContain(verb);
    }
  });

  it('fork 2: negativeProbes and witnessedLevel are required on ComplianceProbeResult', () => {
    const probe = loadSchema('compliance-probe-result');
    expect(probe.required).toContain('negativeProbes');
    expect(probe.required).toContain('witnessedLevel');
    // Each negative probe can pin the level it forges — forged-level is per-level.
    expect(probe.properties.negativeProbes.items.properties.targetLevel.enum).toContain('C1');
    expect(probe.properties.negativeProbes.items.properties.observedLevel).toBeDefined();
    // AgentNode's level is linked to witnessing evidence, not free-standing.
    expect(loadSchema('agent-node').properties.complianceProbeId).toBeDefined();
  });

  it('receipt truth: the nine sections are required and validation is artifact-backed by construction', () => {
    const receipt = loadSchema('work-receipt');
    for (const section of ['identity', 'intent', 'risks', 'validation', 'actions', 'contextUsed', 'rollback', 'spend', 'provenance']) {
      expect(receipt.required).toContain(section);
    }
    expect(receipt.properties.validation.required).toContain('artifactBacked');
    expect(receipt.properties.provenance.required).toContain('transcriptHeadHash');
    // sessionId null is a failing receipt for official work — it is required here.
    expect(receipt.required).toContain('sessionId');
  });
});

// ---------------------------------------------------------------------------
// 3. The compliance witnessing invariant is enforced, not merely asserted.
//    (ADR-0095 §8 — closes the "self-attested level is contract-valid" blocker.)
// ---------------------------------------------------------------------------

const LADDER = ['C0', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6'];

/** A probe whose evidence chain honestly witnesses every level up to `level`. */
function buildWitnessedProbe(level) {
  const order = LADDER.indexOf(level);
  const checks = [];
  const negativeProbes = [];
  for (let i = 0; i <= order; i += 1) {
    checks.push({ name: `gate-${LADDER[i]}`, passed: true, daemonWitnessed: true, level: LADDER[i] });
    if (i >= 1) {
      negativeProbes.push({
        kind: 'forged-level', targetLevel: LADDER[i], present: true, fired: true, downgraded: true, observedLevel: LADDER[i - 1],
      });
    }
  }
  return {
    schema: 'pd.agent-harbor.compliance-probe-result.v0',
    probeId: `probe_${level}`,
    agentNodeId: 'agent_node_test',
    probedAt: '2026-07-05T12:00:00.000Z',
    complianceLevel: level,
    witnessedLevel: level,
    transcriptFidelity: 'T4',
    checks,
    negativeProbes,
  };
}

describe('ADR-0095 §8 compliance witnessing invariant', () => {
  it('the shipped fixture is witness-valid and its complianceLevel equals what evidence supports', () => {
    const probe = loadFixture('compliance-probe-result');
    const result = checkProbeWitnessing(probe);
    expect(result.valid).toBe(true);
    expect(result.witnessedLevel).toBe(probe.complianceLevel);
    expect(() => assertProbeWitnessing(probe)).not.toThrow();
  });

  it('BLOCKER regression: a self-attested C6 (no probes, all checks self-reported) is INVALID', () => {
    const forged = {
      ...loadFixture('compliance-probe-result'),
      complianceLevel: 'C6',
      witnessedLevel: 'C6',
      negativeProbes: [],
      checks: [
        { name: 'i-swear-im-c6', passed: true, daemonWitnessed: false, level: 'C6' },
      ],
    };
    const result = checkProbeWitnessing(forged);
    expect(result.valid).toBe(false);
    expect(result.witnessedLevel).toBe('C0'); // no witnessed evidence at all
    expect(() => assertProbeWitnessing(forged)).toThrow(/self-report|witnessing/i);
  });

  it('a level with a witnessed check but NO negative probe is not witnessed (missing-negative-probe)', () => {
    const probe = buildWitnessedProbe('C2');
    probe.negativeProbes = probe.negativeProbes.filter((n) => n.targetLevel !== 'C2');
    // C1 still witnessed, C2 loses its falsification probe -> caps at C1.
    expect(witnessedComplianceLevel(probe)).toBe('C1');
    probe.complianceLevel = 'C2';
    expect(checkProbeWitnessing(probe).valid).toBe(false);
  });

  it('every non-base level C1..C6 is daemon-witnessable via a forged-level probe (finding 6)', () => {
    for (const level of ['C1', 'C2', 'C3', 'C4', 'C5', 'C6']) {
      const probe = buildWitnessedProbe(level);
      expect(witnessedComplianceLevel(probe)).toBe(level);
      expect(checkProbeWitnessing(probe).valid).toBe(true);
    }
  });

  it('a hole beneath a high witness caps the level at the gap (no skip-grant)', () => {
    const probe = buildWitnessedProbe('C4');
    // Remove the C2 witnessed check: C3/C4 sit above a gap and must not be granted.
    probe.checks = probe.checks.filter((c) => c.level !== 'C2');
    expect(witnessedComplianceLevel(probe)).toBe('C1');
  });

  it('no-downgrade-on-forgery: a present+fired probe that did not downgrade is a violation', () => {
    const probe = buildWitnessedProbe('C2');
    probe.negativeProbes.push({ kind: 'direct-mcp-bypass', targetLevel: 'C2', present: true, fired: true, downgraded: false });
    expect(checkProbeWitnessing(probe).valid).toBe(false);
    expect(checkProbeWitnessing(probe).violations.join(' ')).toMatch(/no-downgrade-on-forgery/);
  });

  it('an AgentNode level cannot exceed its linked probe witnessedLevel', () => {
    const node = loadFixture('agent-node');
    const probe = loadFixture('compliance-probe-result');
    expect(() => assertNodeWitnessing(node, probe)).not.toThrow();

    const overclaim = { ...node, complianceLevel: 'C6' };
    expect(checkNodeWitnessing(overclaim, probe).valid).toBe(false);
    expect(() => assertNodeWitnessing(overclaim, probe)).toThrow(/exceeds|witness/i);
  });

  it('an AgentNode above C0 with no complianceProbeId is self-attested and invalid', () => {
    const node = { ...loadFixture('agent-node') };
    delete node.complianceProbeId;
    expect(checkNodeWitnessing(node, loadFixture('compliance-probe-result')).valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. ADR-0096 M5 F0-delta: the GuidanceEnvelope freeze and the sixth negative
//    probe. Verified guidance is the only operator-authority channel; the
//    contract must make an unsigned envelope unrepresentable and a forged one
//    falsifiable.
// ---------------------------------------------------------------------------

describe('ADR-0096 guidance-envelope freeze (M5 F0-delta)', () => {
  const schema = loadSchema('guidance-envelope');

  it('the signed binding tuple and the authority/sig blocks are required — no unsigned guidance is schema-valid', () => {
    for (const field of ['schema', 'envelopeId', 'agentNodeId', 'sessionId', 'turnSequence', 'issuedAt', 'notAfter', 'nonce', 'items', 'authority', 'sig']) {
      expect(schema.required).toContain(field);
    }
    expect(schema.properties.sig.required).toEqual(['alg', 'keyId', 'value']);
    expect(schema.properties.authority.required).toContain('mode');
    // An envelope with no sig block fails validation.
    const unsigned = { ...loadFixture('guidance-envelope') };
    delete unsigned.sig;
    expect(validate(schema, unsigned).some((e) => e.includes('sig'))).toBe(true);
  });

  it('freezes the authority modes, operator actions, and signature algorithms per the ADR-0096 sketch', () => {
    expect(schema.properties.authority.properties.mode.enum).toEqual(['loopback', 'macaroon']);
    expect(schema.properties.authority.properties.operatorAction.enum).toEqual([
      'fleetbar-gate-approval', 'pd-cli', 'console-click', 'daemon-policy', null,
    ]);
    expect(schema.properties.sig.properties.alg.enum).toEqual(['hmac-sha256', 'ed25519']);
  });

  it('tolerant reader on unknown item kinds: kind is an open string and a future kind validates', () => {
    // No enum on items[].kind — an old body must not silently discard a new
    // guidance kind (it renders it as unrecognized-but-verified instead).
    expect(schema.properties.items.items.properties.kind.enum).toBeUndefined();
    const fixture = loadFixture('guidance-envelope');
    const extended = { ...fixture, items: [...fixture.items, { kind: 'x-future-guidance-kind', ref: 'x_1' }] };
    expect(validate(schema, extended)).toEqual([]);
  });

  it('replay-binding fields are constrained: turnSequence is a non-negative integer and nonce/notAfter are non-empty', () => {
    const fixture = loadFixture('guidance-envelope');
    expect(validate(schema, { ...fixture, turnSequence: -1 }).some((e) => e.includes('turnSequence'))).toBe(true);
    expect(validate(schema, { ...fixture, turnSequence: 1.5 }).some((e) => e.includes('turnSequence'))).toBe(true);
    expect(validate(schema, { ...fixture, nonce: '' }).some((e) => e.includes('nonce'))).toBe(true);
    expect(validate(schema, { ...fixture, notAfter: '' }).some((e) => e.includes('notAfter'))).toBe(true);
  });

  it('drift lock: the GuidanceEnvelope is not the ContextEnvelope and superseded ch03 names must not reappear', () => {
    const props = schema.properties;
    // ContextEnvelope is context-pressure accounting with zero authority
    // fields (ADR-0096 context); its fields must not leak into this contract.
    for (const foreign of ['windowTokens', 'usedTokensEstimate', 'pressure', 'contextRefs', 'compactionNeeded']) {
      expect(props).not.toHaveProperty(foreign);
    }
    // Superseded ch03 names (fork 1) must not reappear on any new contract.
    for (const superseded of ['agentId', 'body', 'blobRefs', 'redaction', 'retention']) {
      expect(props).not.toHaveProperty(superseded);
    }
    // And ContextEnvelope stays authority-free in the other direction.
    const contextProps = loadSchema('context-envelope').properties;
    for (const authorityField of ['sig', 'authority', 'nonce']) {
      expect(contextProps).not.toHaveProperty(authorityField);
    }
  });

  it('the sixth negative probe forged-guidance is frozen into the compliance surface at the C3 gate', () => {
    const probeSchema = loadSchema('compliance-probe-result');
    const kinds = probeSchema.properties.negativeProbes.items.properties.kind.enum;
    expect(kinds).toContain('forged-guidance');
    expect(kinds).toHaveLength(6);
    // A concrete forged-guidance record (body acted on the unsigned envelope ->
    // fired:true, daemon caught it and downgraded) validates. Rejection is the
    // other shape: fired:false with downgraded/observedLevel omitted.
    const record = {
      kind: 'forged-guidance',
      targetLevel: 'C3',
      present: true,
      fired: true,
      downgraded: true,
      observedLevel: 'C0',
      details: 'unsigned envelope injected; body acted on it; daemon recorded the downgrade to C0',
    };
    expect(validate(probeSchema.properties.negativeProbes.items, record)).toEqual([]);
  });

  it('witnessing: forged-guidance can witness C3, and a fired-but-not-downgraded forged-guidance is a violation', () => {
    const probe = buildWitnessedProbe('C3');
    // Swap the generic C3 forged-level probe for the ADR-0096 specialized one.
    probe.negativeProbes = probe.negativeProbes.filter((n) => n.targetLevel !== 'C3');
    probe.negativeProbes.push({
      kind: 'forged-guidance', targetLevel: 'C3', present: true, fired: true, downgraded: true, observedLevel: 'C2',
    });
    expect(witnessedComplianceLevel(probe)).toBe('C3');
    expect(checkProbeWitnessing(probe).valid).toBe(true);

    // A body that acted on unsigned guidance without a recorded downgrade is
    // the no-downgrade-on-forgery worst case: proof the injection works.
    const bad = probe.negativeProbes.find((n) => n.kind === 'forged-guidance');
    bad.downgraded = false;
    expect(checkProbeWitnessing(probe).valid).toBe(false);
    expect(checkProbeWitnessing(probe).violations.join(' ')).toMatch(/forged-guidance.*no-downgrade-on-forgery/);
    expect(witnessedComplianceLevel(probe)).toBe('C2');
  });
});

// ---------------------------------------------------------------------------
// 5. ADR-0097 M6 F0-delta: context, memory, and search contracts.
//    CompactionPacket (cited continuation), MemoryEpisode (bi-temporal
//    validity), TranscriptSearchQuery/Result (budgeted, cited), and the
//    READ-ONLY BlackboardItem (ch05 defers write/parley semantics to M8).
// ---------------------------------------------------------------------------

describe('ADR-0097 M6 context/memory/search contracts (F0-delta)', () => {
  const M6_SCHEMAS = [
    'compaction-packet',
    'memory-episode',
    'transcript-search-query',
    'transcript-search-result',
    'blackboard-item',
  ];

  /** Every place a citation array lives across the five M6 contracts. */
  function citationSites() {
    const packet = loadSchema('compaction-packet');
    const episode = loadSchema('memory-episode');
    const result = loadSchema('transcript-search-result');
    const board = loadSchema('blackboard-item');
    return {
      'compaction-packet.factualClaims': packet.properties.factualClaims.items.properties.citations,
      'memory-episode.citations': episode.properties.citations,
      'transcript-search-result.hits': result.properties.hits.items.properties.citations,
      'transcript-search-result.answer': result.properties.answer.properties.citations,
      'blackboard-item.citations': board.properties.citations,
    };
  }

  it('drift lock (ch04-vs-frozen names): superseded ch03/ch04-sketch names never reappear on any M6 contract', () => {
    // ch04's pre-turn context envelope sketch uses `agentId`; ADR-0095 fork 1
    // froze `agentNodeId`. Same discipline as F0's ch03-vs-ch09 lock.
    for (const name of M6_SCHEMAS) {
      const props = loadSchema(name).properties;
      for (const superseded of ['agentId', 'body', 'blobRefs', 'redaction', 'retention']) {
        expect(props).not.toHaveProperty(superseded);
      }
    }
    // The frozen join keys are present where an agent join exists.
    for (const name of ['compaction-packet', 'memory-episode', 'blackboard-item']) {
      const props = loadSchema(name).properties;
      expect(props).toHaveProperty('agentNodeId');
      expect(props).toHaveProperty('sessionId');
      expect(props).toHaveProperty('runId');
    }
    expect(loadSchema('transcript-search-query').properties.issuedBy.properties).toHaveProperty('agentNodeId');
    expect(loadSchema('transcript-search-result').properties.hits.items.properties).toHaveProperty('agentNodeId');
  });

  it('citation discipline: one identical citation shape everywhere, kind frozen to the tri-union, kind required', () => {
    for (const [site, citations] of Object.entries(citationSites())) {
      expect(citations.items.properties.kind.enum).toEqual(['transcript-event', 'file', 'claim']);
      expect(citations.items.required).toEqual(['kind']);
      // The three ref fields of the union are all representable at every site.
      for (const ref of ['transcriptEventId', 'fileRef', 'claimRef']) {
        expect(citations.items.properties).toHaveProperty(ref);
      }
      // Every claim-bearing site demands at least one citation.
      expect(citations.minItems).toBe(1);
      // `site` keeps the assertion message useful on failure.
      expect(site.length).toBeGreaterThan(0);
    }
  });

  it('compaction packet: an uncited factual claim is schema-INVALID, and the ch04 validator block is required', () => {
    const schema = loadSchema('compaction-packet');
    expect(schema.properties.factualClaims.items.required).toContain('citations');
    for (const field of ['obligations', 'factualClaims', 'validator', 'sourceTranscript', 'nextAction']) {
      expect(schema.required).toContain(field);
    }
    expect(schema.properties.validator.required).toEqual(expect.arrayContaining(['passed', 'uncitedClaimCount']));

    const fixture = loadFixture('compaction-packet');
    expect(validate(schema, fixture)).toEqual([]);
    const uncited = JSON.parse(JSON.stringify(fixture));
    uncited.factualClaims[0].citations = [];
    expect(validate(schema, uncited).some((e) => e.includes('citations'))).toBe(true);
  });

  it('compaction packet: resume is verifiable — sourceTranscript pins headEventId + headHash (M6 gate: resume successor from packet and transcript)', () => {
    const schema = loadSchema('compaction-packet');
    expect(schema.properties.sourceTranscript.required).toEqual(expect.arrayContaining(['headEventId', 'headHash']));
    const fixture = loadFixture('compaction-packet');
    const broken = { ...fixture, sourceTranscript: { throughSequence: 42 } };
    expect(validate(schema, broken).some((e) => e.includes('headHash'))).toBe(true);
  });

  it('drift lock: the CompactionPacket is not the ContextEnvelope — pressure accounting fields must not leak in', () => {
    const props = loadSchema('compaction-packet').properties;
    for (const foreign of ['windowTokens', 'usedTokensEstimate', 'contextRefs', 'compactionNeeded', 'pressure']) {
      expect(props).not.toHaveProperty(foreign);
    }
    // The join is by reference instead: trigger.contextEnvelopeRef.
    expect(props.trigger.properties).toHaveProperty('contextEnvelopeRef');
  });

  it('memory episode: the bi-temporal validity interval is required — validFrom, required-but-nullable validUntil, and ingestedAt', () => {
    const schema = loadSchema('memory-episode');
    for (const field of ['validFrom', 'validUntil', 'ingestedAt']) {
      expect(schema.required).toContain(field);
    }
    expect(schema.properties.validUntil.type).toEqual(['string', 'null']);

    const fixture = loadFixture('memory-episode');
    expect(fixture.validUntil).toBeNull(); // open-ended validity is asserted, not omitted
    expect(validate(schema, fixture)).toEqual([]);
    const missing = { ...fixture };
    delete missing.validUntil;
    expect(validate(schema, missing).some((e) => e.includes('validUntil'))).toBe(true);
    // Naming drift-lock: the interval is validFrom/validUntil, never the variants.
    for (const variant of ['validTo', 'validityStart', 'validityEnd', 'expiry']) {
      expect(schema.properties).not.toHaveProperty(variant);
    }
  });

  it('memory episode: a memory without a source is a suggestion, not a fact — and the distilled-source states are frozen', () => {
    const schema = loadSchema('memory-episode');
    expect(schema.required).toContain('citations');
    const uncited = { ...loadFixture('memory-episode'), citations: [] };
    expect(validate(schema, uncited).some((e) => e.includes('citations'))).toBe(true);
    // ch04 deletion-and-derived-memory contract.
    expect(schema.properties.sourcePayloadState.enum).toEqual(['present', 'redacted', 'deleted', 'expired']);
    expect(schema.required).toContain('sourcePayloadState');
    // ch04 memory tiers (blackboard is its own contract, not a tier here).
    expect(schema.properties.tier.enum).toEqual(['core', 'recall', 'archival', 'graph']);
  });

  it('search query: the retrieval budget is required and positive (M6 gate: memory retrieval never exceeds configured budget)', () => {
    const schema = loadSchema('transcript-search-query');
    for (const field of ['budget', 'mode', 'sources', 'issuedBy', 'queryText']) {
      expect(schema.required).toContain(field);
    }
    expect(schema.properties.budget.required).toContain('maxResults');
    expect(schema.properties.budget.properties.maxResults.minimum).toBe(1);
    expect(schema.properties.mode.enum).toEqual(['hybrid', 'semantic', 'lexical']);

    const fixture = loadFixture('transcript-search-query');
    const unbudgeted = { ...fixture };
    delete unbudgeted.budget;
    expect(validate(schema, unbudgeted).some((e) => e.includes('budget'))).toBe(true);
    expect(validate(schema, { ...fixture, budget: { maxResults: 0 } }).some((e) => e.includes('maxResults'))).toBe(true);
  });

  it('search result: never a bare answer — every hit and the synthesized answer must carry citations', () => {
    const schema = loadSchema('transcript-search-result');
    expect(schema.properties.hits.items.required).toContain('citations');
    expect(schema.properties.answer.required).toEqual(['text', 'citations']);

    const fixture = loadFixture('transcript-search-result');
    expect(validate(schema, fixture)).toEqual([]);
    const bareHit = JSON.parse(JSON.stringify(fixture));
    bareHit.hits[0].citations = [];
    expect(validate(schema, bareHit).some((e) => e.includes('citations'))).toBe(true);
    const bareAnswer = JSON.parse(JSON.stringify(fixture));
    delete bareAnswer.answer.citations;
    expect(validate(schema, bareAnswer).some((e) => e.includes('citations'))).toBe(true);
  });

  it('search result: the budget echo (configured/used/truncated) is required, making the budget gate auditable per response', () => {
    const schema = loadSchema('transcript-search-result');
    expect(schema.required).toContain('budget');
    expect(schema.properties.budget.required).toEqual(['configured', 'used', 'truncated']);
    const fixture = loadFixture('transcript-search-result');
    const silent = { ...fixture, budget: { configured: fixture.budget.configured, used: fixture.budget.used } };
    expect(validate(schema, silent).some((e) => e.includes('truncated'))).toBe(true);
  });

  it('blackboard item is READ-ONLY in v0: no write/parley/ack/permission fields, and the M8 deferral is stated in the contract', () => {
    const schema = loadSchema('blackboard-item');
    // ch05: "Milestone 6 should ship a read-only/search blackboard ...; active
    // conflict/parley write semantics belong in Milestone 8." Scope creep lock:
    for (const writeField of [
      'writeToken', 'parleyState', 'parleyId', 'ackRequired', 'acknowledgements',
      'proposals', 'votes', 'writerPermissions', 'writeableBy', 'mutations', 'writePolicy',
    ]) {
      expect(schema.properties).not.toHaveProperty(writeField);
    }
    expect(schema.description).toMatch(/READ[- ]?ONLY/i);
    expect(schema.description).toMatch(/Milestone 8/);
    // assertedBy is provenance of the underlying fact, not a write API.
    expect(schema.properties.assertedBy.required).toEqual(['kind']);
    // ch05 item requirements: TTL, source links, confidence, supersession, status.
    for (const field of ['expiresAt', 'citations', 'confidence', 'supersededBy', 'status']) {
      expect(schema.properties).toHaveProperty(field);
    }
    for (const field of ['citations', 'status', 'postedAt', 'assertedBy']) {
      expect(schema.required).toContain(field);
    }
    const loose = { ...loadFixture('blackboard-item'), citations: [] };
    expect(validate(schema, loose).some((e) => e.includes('citations'))).toBe(true);
  });

  it('search result and blackboard REQUIRE the C-routes freshness envelope — stale projections are labeled, never hidden', () => {
    for (const name of ['transcript-search-result', 'blackboard-item']) {
      const schema = loadSchema(name);
      // Both objects ARE projections, so the envelope is required, not optional.
      expect(schema.required).toContain('projection');
      const projection = schema.properties.projection;
      expect(projection.required).toContain('stale');
      expect(projection.properties).toHaveProperty('lastLedgerSeq');
      expect(projection.properties).toHaveProperty('headSeq');
      const unlabeled = { ...loadFixture(name) };
      delete unlabeled.projection;
      expect(validate(schema, unlabeled).some((e) => e.includes('projection'))).toBe(true);
    }
  });
});
