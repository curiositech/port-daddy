/**
 * Agent Harbor C5 — governance and tool gates (binder ch18 Work Order C5,
 * ADR-0095 §5 "Tool preflight decision" row).
 *
 * The four ch18 acceptance gates, each proven here:
 *   1. destructive git fixture is blocked BEFORE side effects (scratch repo
 *      state proven byte-identical after denial);
 *   2. the denial is visible in transcript AND Work Receipt;
 *   3. remediation offers a safe alternative;
 *   4. same-UID / unmanaged bodies are never overclaimed as contained.
 *
 * Negative fixtures per the work order: destructive git, forged adapter,
 * missing hook.
 *
 * Grafts (cited per the wave directive): destructive-action-policy-matrix
 * (the audit script from that skill scores the shipped matrix in this suite),
 * sandboxed-adversarial-test-harness (fail-closed on ambiguity),
 * human-gate-designer (approve/reject/modify + computed blast radius),
 * fleet-event-spawn-trust (unwitnessed provenance never earns a trusted tier),
 * macos-host-security + agentic-zero-trust-security (same-UID honesty).
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync,
  rmSync, existsSync, statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DESTRUCTIVE_ACTION_POLICY_MATRIX,
  policyMatrixSpec,
  classifyCommand,
  splitCommandSegments,
  tokenize,
} from '../../lib/agent-harbor/governance/policy-matrix.js';
import {
  preToolGate,
  postToolGate,
  buildContainmentClaim,
  foldDenialsIntoReceipt,
  computeBlastRadius,
} from '../../lib/agent-harbor/governance/tool-gate.js';
import {
  checkEnvelope,
  assertEnvelope,
  checkDenialReceipt,
  assertDenialReceipt,
  checkContainmentClaim,
  assertContainmentClaim,
} from '../../schemas/agent-harbor/v0/governance/governance-invariants.mjs';
import {
  checkNodeWitnessing,
} from '../../schemas/agent-harbor/v0/compliance-invariants.mjs';
import {
  auditPolicyMatrix,
} from '../../skills/destructive-action-policy-matrix/scripts/policy_matrix_audit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const schemaDir = join(here, '..', '..', 'schemas', 'agent-harbor', 'v0');
const govDir = join(schemaDir, 'governance');
const govFixtureDir = join(govDir, 'fixtures');

const GOV_SCHEMAS = ['tool-gate-envelope', 'human-gate-payload', 'denial-receipt'];
const TOP_LEVEL_AGENT_HARBOR_SCHEMAS = [
  'agent-node',
  'agent-run',
  'berth-target',
  'blackboard-item',
  'body',
  'capability-decision',
  'compaction-packet',
  'compliance-probe-result',
  'context-envelope',
  'control-command',
  'cost-accrual-event',
  'guidance-envelope',
  'handoff-capsule',
  'handoff-successor-brief',
  'memory-episode',
  'skill-graft',
  'surface-gateway',
  'transcript-event',
  'transcript-search-query',
  'transcript-search-result',
  'work-intent',
  'work-plan',
  'work-receipt',
];

// ---------------------------------------------------------------------------
// Minimal fail-closed validator — same subset as agent-harbor-contracts.test.js
// (the contract package deliberately ships no ajv; see that file's rationale).
// ---------------------------------------------------------------------------

const ANNOTATION_KEYWORDS = new Set(['$schema', '$id', 'title', 'description', 'default', 'examples']);
const VALIDATION_KEYWORDS = new Set([
  'type', 'properties', 'required', 'additionalProperties', 'items',
  'enum', 'const', 'minLength', 'maxLength', 'minimum', 'maximum',
  'minItems', 'maxItems', 'pattern',
]);

function compile(schema, path = '#') {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) {
    throw new Error(`${path}: schema must be an object`);
  }
  for (const key of Object.keys(schema)) {
    if (ANNOTATION_KEYWORDS.has(key) || VALIDATION_KEYWORDS.has(key)) continue;
    throw new Error(`${path}: unsupported keyword "${key}"`);
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
  return declared === actual || (declared === 'number' && actual === 'integer');
}

function deepEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

function validate(schema, value, path = '$') {
  const errors = [];
  if (schema.type !== undefined) {
    const declared = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = typeOf(value);
    if (!declared.some((t) => typeMatches(t, actual))) {
      errors.push(`${path}: expected type ${declared.join('|')}, got ${actual}`);
      return errors;
    }
  }
  if (schema.const !== undefined && !deepEqual(value, schema.const)) {
    errors.push(`${path}: expected const ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum !== undefined && !schema.enum.some((m) => deepEqual(m, value))) {
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
    if (schema.items) value.forEach((item, i) => errors.push(...validate(schema.items, item, `${path}[${i}]`)));
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

function loadGovSchema(name) {
  return JSON.parse(readFileSync(join(govDir, `${name}.schema.json`), 'utf8'));
}
function loadGovFixture(name) {
  return JSON.parse(readFileSync(join(govFixtureDir, `${name}.json`), 'utf8'));
}
function loadV0Schema(name) {
  return JSON.parse(readFileSync(join(schemaDir, `${name}.schema.json`), 'utf8'));
}
function loadV0Fixture(name) {
  return JSON.parse(readFileSync(join(schemaDir, 'fixtures', `${name}.json`), 'utf8'));
}

// ---------------------------------------------------------------------------
// Scratch workspace: a real dirty git repo whose state we snapshot.
// ---------------------------------------------------------------------------

let scratch;       // root scratch dir
let repo;          // git repo with a dirty worktree
let outsideDir;    // a dir OUTSIDE the workspace root (rm -rf target)

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

/** Recursive listing + content snapshot of a directory (git internals included). */
function snapshotDir(root) {
  const out = new Map();
  const walk = (dir) => {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else out.set(full.slice(root.length + 1), readFileSync(full).toString('base64'));
    }
  };
  walk(root);
  return out;
}

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'pd-c5-governance-'));
  repo = join(scratch, 'workspace');
  outsideDir = join(scratch, 'outside-target');
  mkdirSync(repo, { recursive: true });
  mkdirSync(outsideDir, { recursive: true });
  writeFileSync(join(outsideDir, 'precious.txt'), 'do not delete me\n');

  git(repo, 'init', '--initial-branch=main');
  git(repo, 'config', 'user.email', 'c5@test.local');
  git(repo, 'config', 'user.name', 'C5 Fixture');
  writeFileSync(join(repo, 'committed.txt'), 'first version\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'first');
  writeFileSync(join(repo, 'committed.txt'), 'DIRTY uncommitted edit\n');
  writeFileSync(join(repo, 'untracked.txt'), 'untracked work\n');
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** A fully governed context: hook installed, witnessed compliance. */
function governedCtx(overrides = {}) {
  return {
    agentNodeId: 'agent_node_c5_test',
    sessionId: 'session_c5_test',
    toolCallId: `toolu_${Math.random().toString(36).slice(2)}`,
    workspaceRoot: repo,
    body: { bodyId: 'body_c5_test', preToolHookInstalled: true, sameUid: true, managed: true },
    complianceWitnessValid: true,
    destructiveActions: 'policy-default',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Governance schema package
// ---------------------------------------------------------------------------

describe('C5 governance schema package', () => {
  it('ships exactly the three governance contracts (plus fixtures + invariants)', () => {
    const files = readdirSync(govDir).filter((f) => f.endsWith('.schema.json')).sort();
    expect(files).toEqual(GOV_SCHEMAS.map((n) => `${n}.schema.json`).sort());
  });

  for (const name of GOV_SCHEMAS) {
    describe(name, () => {
      const schema = loadGovSchema(name);

      it('compiles under the fail-closed keyword set', () => {
        expect(() => compile(schema)).not.toThrow();
      });

      it('carries $id, tolerant-reader posture, and a v0 discriminator', () => {
        expect(schema.$id).toBe(`https://portdaddy.dev/schemas/agent-harbor/v0/governance/${name}.schema.json`);
        expect(schema.additionalProperties).toBe(true);
        expect(schema.properties.schema.const).toBe(`pd.agent-harbor.${name.replace(/-/g, '-')}.v0`);
        expect(schema.required).toContain('schema');
      });

      it('validates its fixture instance and tolerates unknown fields', () => {
        expect(validate(schema, loadGovFixture(name))).toEqual([]);
        expect(validate(schema, { ...loadGovFixture(name), xFutureField: 1 })).toEqual([]);
      });

      it('rejects a fixture missing a required field', () => {
        const fixture = loadGovFixture(name);
        const anchor = schema.required.find((k) => k !== 'schema');
        const broken = { ...fixture };
        delete broken[anchor];
        expect(validate(schema, broken).length).toBeGreaterThan(0);
      });
    });
  }

  it('the fixture denial receipt and envelope satisfy the frozen invariants', () => {
    expect(() => assertDenialReceipt(loadGovFixture('denial-receipt'))).not.toThrow();
    expect(() => assertEnvelope(loadGovFixture('tool-gate-envelope'))).not.toThrow();
  });

  it('the top-level frozen contract package is explicitly inventoried — governance adds only governance/ schemas', () => {
    const files = readdirSync(schemaDir).filter((f) => f.endsWith('.schema.json')).sort();
    expect(files).toEqual(TOP_LEVEL_AGENT_HARBOR_SCHEMAS.map((n) => `${n}.schema.json`).sort());
  });
});

// ---------------------------------------------------------------------------
// 2. The destructive-action policy matrix passes the skill audit
// ---------------------------------------------------------------------------

describe('destructive-action policy matrix (skill: destructive-action-policy-matrix)', () => {
  it('covers all five categories with at least one gated action each', () => {
    for (const category of ['git', 'filesystem', 'network', 'shell', 'github']) {
      expect(DESTRUCTIVE_ACTION_POLICY_MATRIX.some((r) => r.category === category)).toBe(true);
    }
  });

  it('passes scripts/policy_matrix_audit.mjs with zero findings', () => {
    const result = auditPolicyMatrix(policyMatrixSpec());
    expect(result.findings).toEqual([]);
    expect(result.pass).toBe(true);
    expect(result.score).toBe(100);
  });

  it('every block-tier row carries a concrete safe alternative and a fixture command', () => {
    for (const row of DESTRUCTIVE_ACTION_POLICY_MATRIX.filter((r) => r.tier === 'block')) {
      expect(row.safeAlternative?.trim().length).toBeGreaterThan(0);
      expect(row.exampleCommand?.trim().length).toBeGreaterThan(0);
    }
  });

  it('the matrix never marks a same-UID body contained', () => {
    expect(policyMatrixSpec().containmentClaim.sameUidBodyMarkedContained).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. NEGATIVE FIXTURE: destructive git blocked BEFORE side effects
//    (ch18 acceptance gates 1-3)
// ---------------------------------------------------------------------------

describe('negative fixture: destructive git in a dirty worktree', () => {
  it('git reset --hard is denied pre-tool and the dirty worktree is byte-identical', () => {
    const before = snapshotDir(repo);
    const headBefore = git(repo, 'rev-parse', 'HEAD').trim();

    const result = preToolGate('git reset --hard HEAD~1', governedCtx());

    // Gate 1: blocked before side effects.
    expect(result.verdict).toBe('deny');
    expect(result.envelope.phase).toBe('pre-tool');
    expect(result.envelope.decision).toBe('denied');
    expect(result.envelope.tier).toBe('block');
    expect(snapshotDir(repo)).toEqual(before);
    expect(git(repo, 'rev-parse', 'HEAD').trim()).toBe(headBefore);
    expect(readFileSync(join(repo, 'committed.txt'), 'utf8')).toBe('DIRTY uncommitted edit\n');
    expect(existsSync(join(repo, 'untracked.txt'))).toBe(true);

    // Gate 2: the denial is visible in the transcript...
    const denied = result.transcriptEvents.find((e) => e.kind === 'tool_denied');
    expect(denied).toBeDefined();
    expect(result.envelope.transcriptEventIds).toContain(denied.eventId);
    const teSchema = loadV0Schema('transcript-event');
    for (const event of result.transcriptEvents) {
      expect(validate(teSchema, event)).toEqual([]);
    }
    // ...and the receipt links the event, not a log nobody sees.
    expect(result.denialReceipt.transcriptEventId).toBe(denied.eventId);
    expect(result.denialReceipt.sideEffectFree).toBe(true);

    // Gate 3: remediation offers a concrete safe alternative.
    expect(result.denialReceipt.safeAlternative).toMatch(/git stash push/);

    // Contract shape: envelope and receipt validate against the frozen schemas
    // and the language-neutral invariants module agrees with the TS gate.
    expect(validate(loadGovSchema('tool-gate-envelope'), result.envelope)).toEqual([]);
    expect(validate(loadGovSchema('denial-receipt'), result.denialReceipt)).toEqual([]);
    expect(checkEnvelope(result.envelope).valid).toBe(true);
    expect(checkDenialReceipt(result.denialReceipt).valid).toBe(true);
  });

  it('EVERY block-tier matrix row is denied with zero side effects (sideEffectFreeOnBlockFixture is earned, not asserted)', () => {
    const before = snapshotDir(scratch);
    for (const row of DESTRUCTIVE_ACTION_POLICY_MATRIX.filter((r) => r.tier === 'block')) {
      const cmd = row.name === 'rm -rf outside workspace root'
        ? `rm -rf ${outsideDir}`
        : row.exampleCommand;
      const result = preToolGate(cmd, governedCtx());
      expect({ row: row.name, verdict: result.verdict }).toEqual({ row: row.name, verdict: 'deny' });
      expect(result.envelope.tier).toBe('block');
      expect(result.denialReceipt).not.toBeNull();
      expect(result.denialReceipt.safeAlternative?.trim().length).toBeGreaterThan(0);
      expect(checkDenialReceipt(result.denialReceipt).valid).toBe(true);
    }
    // Zero side effects across the whole scratch tree, for every denial.
    expect(snapshotDir(scratch)).toEqual(before);
    expect(readFileSync(join(outsideDir, 'precious.txt'), 'utf8')).toBe('do not delete me\n');
  });

  it('a destructive tail cannot hide behind a benign head (worst segment wins)', () => {
    const result = preToolGate('echo fine && git push --force origin main', governedCtx());
    expect(result.verdict).toBe('deny');
    expect(result.envelope.actionName).toBe('git push --force');
  });

  it('WorkIntent constraints.destructiveActions "deny" escalates approve-tier to denial', () => {
    const result = preToolGate('git push --force-with-lease origin feature', governedCtx({ destructiveActions: 'deny' }));
    expect(result.verdict).toBe('deny');
    expect(result.denialReceipt.reason).toMatch(/destructiveActions is "deny"/);
  });
});

// ---------------------------------------------------------------------------
// 4. The denial is visible in the Work Receipt (ch18 acceptance gate 2)
// ---------------------------------------------------------------------------

describe('denial folds into the WorkReceipt trust object', () => {
  it('a folded receipt still validates against work-receipt.schema.json and carries the denial as a high risk', () => {
    const denial = preToolGate('git reset --hard', governedCtx()).denialReceipt;
    const receipt = loadV0Fixture('work-receipt');
    const folded = foldDenialsIntoReceipt(receipt, [denial]);

    expect(validate(loadV0Schema('work-receipt'), folded)).toEqual([]);
    const riskSummaries = folded.risks.map((r) => r.summary).join('\n');
    expect(riskSummaries).toMatch(/Gate denial: git reset --hard/);
    expect(riskSummaries).toMatch(/git stash push/); // the safe alternative travels with the receipt
    expect(folded.governance.denials).toHaveLength(1);
    // The trust object never overclaims containment.
    expect(folded.governance.containment.contained).toBe(false);
    expect(folded.governance.containment.sameUidBodyMarkedContained).toBe(false);
    // Pure fold: the input receipt is not mutated.
    expect(receipt.risks.map((r) => r.summary).join('\n')).not.toMatch(/Gate denial/);
  });
});

// ---------------------------------------------------------------------------
// 5. NEGATIVE FIXTURE: forged adapter (self-attested compliance)
// ---------------------------------------------------------------------------

describe('negative fixture: forged adapter', () => {
  const forgedProbe = {
    schema: 'pd.agent-harbor.compliance-probe-result.v0',
    probeId: 'probe_forged',
    agentNodeId: 'agent_node_c5_test',
    probedAt: '2026-07-05T12:00:00.000Z',
    complianceLevel: 'C2',
    witnessedLevel: 'C2',
    transcriptFidelity: 'T4',
    checks: [{ name: 'i-swear-im-governed', passed: true, daemonWitnessed: false, level: 'C2' }],
    negativeProbes: [],
  };

  it('the forged probe fails the ADR-0095 §8 witnessing invariant', () => {
    const node = {
      schema: 'pd.agent-harbor.agent-node.v0',
      agentNodeId: 'agent_node_c5_test',
      identity: 'port-daddy:c5:test',
      class: 'voyager',
      authority: 'local',
      complianceLevel: 'C2',
      complianceProbeId: 'probe_forged',
      status: 'active',
      createdAt: '2026-07-05T12:00:00.000Z',
    };
    expect(checkNodeWitnessing(node, forgedProbe).valid).toBe(false);
  });

  it('a body whose compliance failed witnessing gets NO gated action — even approve-tier is denied, fail closed', () => {
    const ctx = governedCtx({ complianceWitnessValid: false });
    for (const cmd of ['git reset --hard', 'git push --force-with-lease origin feature']) {
      const result = preToolGate(cmd, ctx);
      expect(result.verdict).toBe('deny');
      expect(result.envelope.gateIntegrity).toBe('forged-compliance');
      expect(result.humanGatePayload).toBeNull(); // no governed channel for approval
      expect(result.denialReceipt.reason).toMatch(/witnessing invariant|forged/);
      expect(checkEnvelope(result.envelope).valid).toBe(true);
    }
  });

  it('an UNKNOWN witnessing verdict is treated as unwitnessed (stale state never authorizes)', () => {
    const result = preToolGate('git clean -fd', governedCtx({ complianceWitnessValid: undefined }));
    expect(result.verdict).toBe('deny');
    expect(result.envelope.gateIntegrity).toBe('forged-compliance');
  });
});

// ---------------------------------------------------------------------------
// 6. NEGATIVE FIXTURE: missing hook
// ---------------------------------------------------------------------------

describe('negative fixture: missing pre-tool hook', () => {
  it('a body without a verified pre-tool hook has every gated action denied, never held', () => {
    const ctx = governedCtx({ body: { bodyId: 'body_unhooked', preToolHookInstalled: false } });
    const result = preToolGate('git reset --hard', ctx);
    expect(result.verdict).toBe('deny');
    expect(result.envelope.gateIntegrity).toBe('missing-hook');
    expect(result.denialReceipt.reason).toMatch(/pre-tool hook is not installed/);
    expect(checkEnvelope(result.envelope).valid).toBe(true);
  });

  it('a block-tier action observed post-tool as executed is a recorded integrity violation, not a clean proceed', () => {
    const { envelope, violation, denialReceipt, transcriptEvents } = postToolGate(
      'git reset --hard',
      { executed: true, exitCode: 0 },
      governedCtx(),
    );
    expect(violation).toMatch(/without a pre-tool gate/);
    expect(envelope.gateIntegrity).toBe('post-hoc-observation');
    expect(envelope.decision).not.toBe('proceeded');
    // The violation is VISIBLE: it emits its own transcript event and a
    // denial receipt that honestly refuses to claim side-effect-freedom.
    expect(transcriptEvents.some((e) => e.kind === 'tool_denied')).toBe(true);
    expect(envelope.transcriptEventIds).toEqual(transcriptEvents.map((e) => e.eventId));
    expect(denialReceipt.sideEffectFree).toBe(false); // the action ran
    expect(denialReceipt.transcriptEventId).toBe(transcriptEvents[0].eventId);
    expect(checkEnvelope(envelope).valid).toBe(true);
    expect(validate(loadGovSchema('denial-receipt'), denialReceipt)).toEqual([]);
  });

  it('an ordinary post-tool result proceeds cleanly with no violation', () => {
    const { envelope, violation, denialReceipt } = postToolGate(
      'npm test',
      { executed: true, exitCode: 0 },
      governedCtx(),
    );
    expect(violation).toBeNull();
    expect(denialReceipt).toBeNull();
    expect(envelope.decision).toBe('proceeded');
    expect(checkEnvelope(envelope).valid).toBe(true);
  });

  it('a missing-hook/forged-compliance denial never claims fixture-proven side-effect-freedom', () => {
    const unhooked = preToolGate('git reset --hard', governedCtx({
      body: { bodyId: 'body_unhooked', preToolHookInstalled: false },
    }));
    expect(unhooked.denialReceipt.sideEffectFree).toBe(false);
    const forged = preToolGate('git reset --hard', governedCtx({ complianceWitnessValid: false }));
    expect(forged.denialReceipt.sideEffectFree).toBe(false);
    // An enforced denial of a fixture-proven block row DOES claim it.
    const enforced = preToolGate('git reset --hard', governedCtx());
    expect(enforced.denialReceipt.sideEffectFree).toBe(true);
  });

  it('the invariants module rejects the contradiction envelopes a bypassed hook would produce', () => {
    const base = loadGovFixture('tool-gate-envelope');
    // The blocker that still ran (pre-tool).
    const ranAnyway = { ...base, decision: 'proceeded', verdict: 'allow' };
    expect(checkEnvelope(ranAnyway).valid).toBe(false);
    expect(() => assertEnvelope(ranAnyway)).toThrow(/did not block/);
    // Block-tier side effects observed post-tool.
    const postHoc = { ...base, phase: 'post-tool', decision: 'proceeded' };
    expect(checkEnvelope(postHoc).violations.join(' ')).toMatch(/missing-hook/);
    // The silent denial: denied with no transcript events.
    const silent = { ...base, transcriptEventIds: [] };
    expect(checkEnvelope(silent).violations.join(' ')).toMatch(/silent denial/);
    // Denied with no receipt.
    const noReceipt = { ...base, denialReceiptId: null };
    expect(checkEnvelope(noReceipt).violations.join(' ')).toMatch(/denial-without-receipt/);
  });

  it('the invariants module rejects a block-tier denial with no safe alternative', () => {
    const receipt = { ...loadGovFixture('denial-receipt'), safeAlternative: null };
    expect(checkDenialReceipt(receipt).valid).toBe(false);
    expect(() => assertDenialReceipt(receipt)).toThrow(/safeAlternative|route around/);
  });

  it('the invariants module rejects an un-linkable receipt and the sideEffectFree inverse lie', () => {
    // No envelopeId: the receipt cannot be joined to its tool call.
    const orphaned = { ...loadGovFixture('denial-receipt') };
    delete orphaned.envelopeId;
    expect(checkDenialReceipt(orphaned).violations.join(' ')).toMatch(/envelopeId/);
    expect(validate(loadGovSchema('denial-receipt'), orphaned).length).toBeGreaterThan(0);
    // sideEffectFree true on a non-denied decision: nothing has been proven.
    const heldLie = { ...loadGovFixture('denial-receipt'), decision: 'held', sideEffectFree: true };
    expect(checkDenialReceipt(heldLie).violations.join(' ')).toMatch(/sideEffectFree/);
  });
});

// ---------------------------------------------------------------------------
// 7. Human gate payload (approve tier)
// ---------------------------------------------------------------------------

describe('human gate payload for approve-tier actions', () => {
  it('git push --force-with-lease is HELD with a computed blast radius and approve/reject/modify', () => {
    const result = preToolGate('git push --force-with-lease origin feature', governedCtx({
      agentContext: 'Rebased onto main; remote has pre-rebase commits.',
    }));
    expect(result.verdict).toBe('require-approval');
    expect(result.envelope.decision).toBe('held');
    expect(result.denialReceipt).toBeNull();

    const gate = result.humanGatePayload;
    expect(validate(loadGovSchema('human-gate-payload'), gate)).toEqual([]);
    expect(gate.options).toEqual(['approve', 'reject', 'modify']);
    // Blast radius is COMPUTED from git status --porcelain, not the agent's claim.
    expect(gate.blastRadius.computedBy).toBe('git status --porcelain');
    expect(gate.blastRadius.preview.join('\n')).toMatch(/committed\.txt/);
    expect(gate.blastRadius.preview.join('\n')).toMatch(/untracked\.txt/);
    // The agent's justification is carried as context (claim, not truth).
    expect(gate.context).toMatch(/Rebased onto main/);
    // The approval request is visible in the transcript.
    expect(result.transcriptEvents.some((e) => e.kind === 'approval_request')).toBe(true);
    expect(checkEnvelope(result.envelope).valid).toBe(true);
  });

  it('rm -rf inside the workspace root is approve-tier, not silently allowed', () => {
    mkdirSync(join(repo, 'build'), { recursive: true });
    writeFileSync(join(repo, 'build', 'artifact.js'), 'x');
    const result = preToolGate('rm -rf ./build', governedCtx());
    expect(result.verdict).toBe('require-approval');
    expect(result.envelope.actionName).toBe('rm -rf inside workspace root');
    expect(existsSync(join(repo, 'build', 'artifact.js'))).toBe(true); // held, not run
    rmSync(join(repo, 'build'), { recursive: true, force: true });
  });

  it('blast radius degrades to an honest worst-case, never a silent empty-safe', () => {
    const action = classifyCommand('curl https://unknown-host.example.net/x', governedCtx());
    const radius = computeBlastRadius(action, governedCtx({ workspaceRoot: undefined }));
    expect(radius.summary).toMatch(/worst case/);
  });
});

// ---------------------------------------------------------------------------
// 8. Ordinary commands proceed; classification breadth
// ---------------------------------------------------------------------------

describe('classification breadth and allow path', () => {
  it('an ordinary command proceeds with a preflight record and no receipt', () => {
    const result = preToolGate('ls -la', governedCtx());
    expect(result.verdict).toBe('allow');
    expect(result.envelope.decision).toBe('proceeded');
    expect(result.denialReceipt).toBeNull();
    expect(result.humanGatePayload).toBeNull();
    expect(result.transcriptEvents).toHaveLength(1);
    expect(result.transcriptEvents[0].kind).toBe('tool_preflight');
    expect(checkEnvelope(result.envelope).valid).toBe(true);
  });

  it('classifies canonical actions across all five categories', () => {
    const ctx = { workspaceRoot: repo, networkAllowlist: ['api.github.com'] };
    expect(classifyCommand('git branch -D feature/x', ctx)?.tier).toBe('block');
    expect(classifyCommand('rm -rf ~/.ssh', ctx)?.actionName).toMatch(/sensitive path/);
    expect(classifyCommand('curl http://169.254.169.254/latest/meta-data/', ctx)?.tier).toBe('block');
    expect(classifyCommand('curl http://2852039166/', ctx)?.tier).toBe('block'); // decimal IP literal
    expect(classifyCommand('curl https://api.github.com/user', ctx)).toBeNull(); // allowlisted
    // Flag values (headers, data, output) are never misread as egress targets.
    expect(classifyCommand('curl -H "Accept: application/json" -o out.json https://api.github.com/user', ctx)).toBeNull();
    expect(classifyCommand('curl -X POST -d "k=v" https://api.github.com/gists', ctx)).toBeNull();
    expect(classifyCommand('curl https://new-host.example.org/', ctx)?.tier).toBe('approve');
    expect(classifyCommand('sh -c "rm -rf $TARGET"', ctx)?.tier).toBe('block');
    expect(classifyCommand('gh repo delete owner/repo --yes', ctx)?.tier).toBe('block');
    expect(classifyCommand('gh pr merge 42 --admin', ctx)?.tier).toBe('block');
    expect(classifyCommand('gh pr merge 42 --squash', ctx)?.tier).toBe('approve');
    expect(classifyCommand('git stash clear', ctx)?.tier).toBe('approve');
    expect(classifyCommand('git status', ctx)).toBeNull();
    expect(classifyCommand('npm test', ctx)).toBeNull();
  });

  it('wrappers and env prefixes cannot smuggle a destructive action past the gate', () => {
    const ctx = { workspaceRoot: repo };
    expect(classifyCommand('sudo git reset --hard', ctx)?.tier).toBe('block');
    expect(classifyCommand('GIT_DIR=.git git reset --hard', ctx)?.tier).toBe('block');
    expect(classifyCommand('env FOO=bar nohup git push --force origin main', ctx)?.tier).toBe('block');
    expect(classifyCommand('git -C /some/where reset --hard', ctx)?.tier).toBe('block');
  });

  it('an unparseable egress target fails closed to approval, never allow', () => {
    const match = classifyCommand('curl http://[bad-bracket-host', { workspaceRoot: repo });
    expect(match?.tier).toBe('approve');
    expect(match?.reason).toMatch(/fail closed/);
  });

  it('rm -rf with NO known workspace root is worst-cased as outside (block)', () => {
    const match = classifyCommand('rm -rf ./anything', {});
    expect(match?.actionName).toBe('rm -rf outside workspace root');
  });

  it('tokenizer and segment splitter handle quotes and chains', () => {
    expect(splitCommandSegments('echo "a && b" && ls; true')).toEqual(['echo "a && b"', 'ls', 'true']);
    expect(tokenize('git commit -m "hello world"')).toEqual(['git', 'commit', '-m', 'hello world']);
  });
});

// ---------------------------------------------------------------------------
// 9. Containment honesty (ch18 acceptance gate 4)
// ---------------------------------------------------------------------------

describe('same-UID / unmanaged bodies are never overclaimed as contained', () => {
  it('every gate result carries an honest containment claim', () => {
    const result = preToolGate('git reset --hard', governedCtx());
    expect(result.containmentClaim.contained).toBe(false);
    expect(result.containmentClaim.sameUidBodyMarkedContained).toBe(false);
    expect(result.containmentClaim.reason).toMatch(/not a wall|governed, not contained|read around/);
  });

  it('even a separate-UID body is not marked contained without harness evidence', () => {
    const claim = buildContainmentClaim({ sameUid: false, managed: true });
    expect(claim.contained).toBe(false);
    expect(claim.reason).toMatch(/no adversarial containment harness/);
  });

  it('the invariants module rejects an overclaimed containment (same-uid-marked-contained)', () => {
    expect(checkContainmentClaim({ sameUidBodyMarkedContained: true }).valid).toBe(false);
    expect(() => assertContainmentClaim({ sameUidBodyMarkedContained: true })).toThrow(/never be truthfully marked contained/);
    expect(checkContainmentClaim({ contained: true, sameUidBodyMarkedContained: false }, { sameUid: true }).valid).toBe(false);
    // Unknown isolation is fail-closed to same-UID.
    expect(checkContainmentClaim({ contained: true, sameUidBodyMarkedContained: false }, {}).valid).toBe(false);
    // The honest claim passes.
    expect(checkContainmentClaim(buildContainmentClaim({}), {}).valid).toBe(true);
  });

  it('the skill audit flags a matrix that overclaims containment', () => {
    const spec = policyMatrixSpec();
    const overclaimed = { ...spec, containmentClaim: { sameUidBodyMarkedContained: true } };
    const result = auditPolicyMatrix(overclaimed);
    expect(result.pass).toBe(false);
    expect(result.findings.some((f) => f.id === 'same-uid-marked-contained')).toBe(true);
  });
});
