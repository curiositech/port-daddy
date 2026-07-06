/**
 * Agent Harbor v0 contract freeze tests (ADR-0095, binder ch18 Work Order F0;
 * extended by the ADR-0096 M5 F0-delta: GuidanceEnvelope + forged-guidance).
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

const here = dirname(fileURLToPath(import.meta.url));
const schemaDir = join(here, '..', '..', 'schemas', 'agent-harbor', 'v0');
const fixtureDir = join(schemaDir, 'fixtures');

const SCHEMA_NAMES = [
  'work-intent',
  'work-plan',
  'agent-node',
  'agent-run',
  'transcript-event',
  'control-command',
  'compliance-probe-result',
  'cost-accrual-event',
  'context-envelope',
  'skill-graft',
  'work-receipt',
  'guidance-envelope',
];

// ---------------------------------------------------------------------------
// Minimal fail-closed JSON Schema (draft 2020-12 subset) validator.
// ---------------------------------------------------------------------------

const ANNOTATION_KEYWORDS = new Set(['$schema', '$id', 'title', 'description', 'default', 'examples']);
const VALIDATION_KEYWORDS = new Set([
  'type', 'properties', 'required', 'additionalProperties', 'items',
  'enum', 'const', 'minLength', 'maxLength', 'minimum', 'maximum',
  'minItems', 'maxItems', 'pattern',
]);

/** Throws if the schema uses any keyword this validator does not implement. */
function compile(schema, path = '#') {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) {
    throw new Error(`${path}: schema must be an object`);
  }
  for (const key of Object.keys(schema)) {
    if (ANNOTATION_KEYWORDS.has(key) || VALIDATION_KEYWORDS.has(key)) continue;
    throw new Error(`${path}: unsupported keyword "${key}" — extend the validator or simplify the schema`);
  }
  if (schema.properties) {
    for (const [prop, sub] of Object.entries(schema.properties)) compile(sub, `${path}/properties/${prop}`);
  }
  if (schema.items) compile(schema.items, `${path}/items`);
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== 'boolean') {
    compile(schema.additionalProperties, `${path}/additionalProperties`);
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
function validate(schema, value, path = '$') {
  const errors = [];
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
      value.forEach((item, i) => errors.push(...validate(schema.items, item, `${path}[${i}]`)));
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
        if (key in value) errors.push(...validate(sub, value[key], `${path}.${key}`));
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
          errors.push(...validate(schema.additionalProperties, value[key], `${path}.${key}`));
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

// ---------------------------------------------------------------------------
// 1. Compilation and package shape
// ---------------------------------------------------------------------------

describe('agent-harbor v0 schema package', () => {
  it('ships exactly the twelve frozen contracts (plus fixtures) — eleven from F0 plus the ADR-0096 GuidanceEnvelope', () => {
    const files = readdirSync(schemaDir).filter((f) => f.endsWith('.schema.json')).sort();
    expect(files).toEqual(SCHEMA_NAMES.map((n) => `${n}.schema.json`).sort());
  });

  for (const name of SCHEMA_NAMES) {
    describe(name, () => {
      const schema = loadSchema(name);

      it('compiles under the fail-closed keyword set', () => {
        expect(() => compile(schema)).not.toThrow();
      });

      it('carries $id, $schema, title, and tolerant-reader posture', () => {
        expect(schema.$id).toBe(`https://portdaddy.dev/schemas/agent-harbor/v0/${name}.schema.json`);
        expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
        expect(typeof schema.title).toBe('string');
        // Tolerant reader (ADR-0095 §6): unknown fields must be tolerated.
        expect(schema.additionalProperties).toBe(true);
      });

      it('self-identifies its version', () => {
        if (name === 'transcript-event') {
          // TranscriptEvent is pinned by ch09's schemaVersion, not a schema const.
          expect(schema.properties.schemaVersion.const).toBe(1);
          expect(schema.required).toContain('schemaVersion');
        } else {
          expect(schema.properties.schema.const).toBe(`pd.agent-harbor.${name}.v0`);
          expect(schema.required).toContain('schema');
        }
      });

      it('validates its fixture instance', () => {
        const errors = validate(schema, loadFixture(name));
        expect(errors).toEqual([]);
      });

      it('tolerates unknown extra fields on the fixture (tolerant reader)', () => {
        const extended = { ...loadFixture(name), xFutureField: { anything: true } };
        expect(validate(schema, extended)).toEqual([]);
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
    // A concrete forged-guidance record (unsigned envelope rejected -> downgraded) validates.
    const record = {
      kind: 'forged-guidance',
      targetLevel: 'C3',
      present: true,
      fired: true,
      downgraded: true,
      observedLevel: 'C0',
      details: 'unsigned envelope injected; body rejected it and recorded the downgrade',
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
