/**
 * Agent Harbor v0 contract freeze tests (ADR-0095, binder ch18 Work Order F0).
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
    if (schema.additionalProperties === false && schema.properties) {
      for (const key of Object.keys(value)) {
        if (!(key in schema.properties)) errors.push(`${path}: unexpected property "${key}"`);
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
  it('ships exactly the eleven frozen contracts (plus fixtures)', () => {
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
