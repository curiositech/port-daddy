/**
 * Agent Harbor C2 — adapter compliance probe tests (binder ch18 Work Order C2,
 * ADR-0095). These are the ch18 acceptance gates as executable tests:
 *
 *   1. forged compliance is downgraded;
 *   2. observed agents cannot receive C2+ controls;
 *   3. model tier and provider-specific model name are both visible;
 *   4. partial cost survives abort or failed body start.
 *
 * Plus: the five negative probes are present-and-executable for every adapter
 * fixture (compliant/weak/broken/malicious), every emitted object validates
 * against the frozen F0 v0 schemas, and every probe result satisfies the
 * ADR-0095 §8 witnessing invariant (compliance-invariants.mjs is the normative
 * predicate — the engine consumes it, this suite cross-checks it).
 */
import { describe, it, expect } from '@jest/globals';
import {
  checkProbeWitnessing,
  checkNodeWitnessing,
} from '../../schemas/agent-harbor/v0/compliance-invariants.mjs';

const { ADAPTER_KINDS, COMPLIANCE_LADDER, NEGATIVE_PROBE_KINDS, complianceOrder } =
  await import('../../lib/agent-harbor/types.js');
const { CAPABILITY_MATRIX, getCapabilityProfile, clampToCeiling } =
  await import('../../lib/agent-harbor/capability-matrix.js');
const { resolveModelTier, requireResolvedModel, defaultModelFor, TIER_CAPABILITY, ADAPTER_REGISTRY_BACKEND, ADAPTER_PROVIDERS } =
  await import('../../lib/agent-harbor/model-tier-policy.js');
const { resolveModel } = await import('../../lib/model-registry.js');
const { runComplianceProbe } = await import('../../lib/agent-harbor/compliance-probe.js');
const { makeAdapterFixture, FIXTURE_PROFILES } = await import('../../lib/agent-harbor/adapter-fixtures.js');
const { CONTROL_MIN_LEVEL, authorizeControl, applyControlGate, makeControlCommand, effectiveComplianceLevel } =
  await import('../../lib/agent-harbor/control-gate.js');
const { CostAccrualLedger, withCostCapture } = await import('../../lib/agent-harbor/cost-accrual.js');
const { runWorkProbe, capabilityMatrixRows } = await import('../../lib/agent-harbor/probe-surface.js');
const { validateAgainstSchema } = await import('../../lib/agent-harbor/schema-validate.js');

function expectSchemaValid(name, instance) {
  const result = validateAgainstSchema(name, instance);
  expect(result.skipped).toBe(false); // schemas/ is present in the repo
  expect(result.errors).toEqual([]);
  expect(result.valid).toBe(true);
}

async function probeFixture(kind, profile) {
  const target = makeAdapterFixture(kind, profile);
  return runComplianceProbe(target, { agentNodeId: `anode_test_${kind}_${profile}` });
}

// ---------------------------------------------------------------------------
// Capability matrix
// ---------------------------------------------------------------------------

describe('capability matrix', () => {
  it('covers every probeable adapter kind from the frozen body.kind enum', () => {
    expect(Object.keys(CAPABILITY_MATRIX).sort()).toEqual([...ADAPTER_KINDS].sort());
  });

  it('every ceiling is consistent: official C1 requires T4 fidelity (ADR-0095 fork 2)', () => {
    for (const profile of Object.values(CAPABILITY_MATRIX)) {
      if (complianceOrder(profile.complianceCeiling) >= complianceOrder('C1')) {
        expect(['T4', 'T5']).toContain(profile.transcriptFidelityCeiling);
      }
      // C6 Resumable requires T5 (frozen ladder predicates).
      if (profile.complianceCeiling === 'C6') {
        expect(profile.transcriptFidelityCeiling).toBe('T5');
      }
      expect(profile.ceilingRationale.length).toBeGreaterThan(20);
      expect(profile.launchModes).toContain(profile.defaultLaunchMode);
      expect(profile.modelTiers.length).toBeGreaterThan(0);
    }
  });

  it('clampToCeiling caps a witnessed level at the mechanical ceiling', () => {
    expect(clampToCeiling('ollama', 'C6')).toBe('C2');
    expect(clampToCeiling('claude-code', 'C6')).toBe('C6');
    expect(clampToCeiling('cloudflare', 'C5')).toBe('C4');
  });

  it('matrix rows render for the roster surface', () => {
    const rows = capabilityMatrixRows();
    expect(rows).toHaveLength(ADAPTER_KINDS.length);
    for (const row of rows) {
      expect(row.complianceCeiling).toMatch(/^C[0-6]$/);
      expect(row.transcriptFidelityCeiling).toMatch(/^T[0-5]$/);
    }
  });
});

// ---------------------------------------------------------------------------
// Gate 3: model tier and provider-specific model name are both visible
// ---------------------------------------------------------------------------

describe('model-tier policy (ch18 C2 gate: tier AND resolved name visible)', () => {
  it('resolves defaults for hosted adapters with both fields populated', () => {
    for (const [kind, tiers] of [
      ['claude-code', ['fast', 'mid', 'strong']],
      ['codex-cli', ['fast', 'mid', 'strong']],
      ['cloudflare', ['fast', 'mid', 'strong']],
    ]) {
      for (const tier of tiers) {
        const resolved = resolveModelTier(kind, tier);
        expect(resolved.ok).toBe(true);
        expect(resolved.modelTier).toBe(tier);
        expect(typeof resolved.modelName).toBe('string');
        expect(resolved.modelName.length).toBeGreaterThan(0);
        expect(resolved.provider).toBe(ADAPTER_PROVIDERS[kind]);
      }
    }
  });

  it('drift tripwire: defaults resolve from the model registry (ADR-0057), never a local literal', () => {
    // Every hosted adapter's tier default is exactly what the registry says
    // for its mapped (backend, capability) — one source of truth for IDs.
    for (const [kind, backend] of Object.entries(ADAPTER_REGISTRY_BACKEND)) {
      for (const [tier, capability] of Object.entries(TIER_CAPABILITY)) {
        const expected = resolveModel({ backend, capability });
        expect(defaultModelFor(kind, tier)).toBe(expected);
        const resolved = resolveModelTier(kind, tier);
        if (resolved.ok) expect(resolved.modelName).toBe(expected);
      }
    }
    // Registry-less lanes have no default: null, never a guess.
    expect(defaultModelFor('ollama', 'local')).toBeNull();
    expect(defaultModelFor('custom-stdio', 'custom')).toBeNull();
  });

  it('local and custom tiers refuse to resolve without an explicit model name (fail-closed)', () => {
    expect(resolveModelTier('ollama', 'local').ok).toBe(false);
    expect(resolveModelTier('lmstudio', 'local').ok).toBe(false);
    expect(resolveModelTier('custom-stdio', 'custom').ok).toBe(false);
    expect(() => requireResolvedModel('ollama', 'local')).toThrow(/explicit model name/);
    const explicit = resolveModelTier('ollama', 'local', 'qwen3:30b-a3b');
    expect(explicit.ok).toBe(true);
    expect(explicit.modelName).toBe('qwen3:30b-a3b');
  });

  it('refuses a tier the adapter does not serve', () => {
    const refused = resolveModelTier('ollama', 'strong');
    expect(refused.ok).toBe(false);
    expect(refused.supportedTiers).toEqual(['local']);
  });

  it('the probe records model visibility as a daemon-witnessed check', async () => {
    const result = await probeFixture('claude-code', 'compliant');
    const check = result.checks.find((c) => c.name === 'model-tier-and-name-visible');
    expect(check).toBeDefined();
    expect(check.passed).toBe(true);
    expect(check.details).toMatch(/modelTier=mid/);
    // The resolved name is whatever the registry says for (claude-cli, balanced).
    const expected = resolveModel({ backend: 'claude-cli', capability: 'balanced' });
    expect(check.details).toContain(`modelName=${expected}`);
  });

  it('a body without a visible model name fails the visibility check with remediation', async () => {
    // custom-stdio has no registered defaults, so a broken install (modelName
    // lost) cannot fall back — the visibility gate must fail, not guess.
    const result = await probeFixture('custom-stdio', 'broken');
    const check = result.checks.find((c) => c.name === 'model-tier-and-name-visible');
    expect(check.passed).toBe(false);
    expect(result.remediation.some((r) => r.issue.includes('model tier'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The probe engine × all fixtures: schema truth + witnessing invariant
// ---------------------------------------------------------------------------

describe('conformance probe engine over every adapter × profile', () => {
  it('emits schema-valid, witness-valid results with all five negative probes present', async () => {
    for (const kind of ADAPTER_KINDS) {
      for (const profile of FIXTURE_PROFILES) {
        const result = await probeFixture(kind, profile);

        expectSchemaValid('compliance-probe-result', result);

        const witness = checkProbeWitnessing(result);
        expect(witness.violations).toEqual([]);
        expect(witness.valid).toBe(true);

        // The five required negative probe kinds are all present and executable.
        const kinds = new Set(result.negativeProbes.map((p) => p.kind));
        for (const required of NEGATIVE_PROBE_KINDS) expect(kinds.has(required)).toBe(true);

        // forged-level is instantiated per non-base level (per-level falsifiability).
        const forgedTargets = result.negativeProbes
          .filter((p) => p.kind === 'forged-level')
          .map((p) => p.targetLevel)
          .sort();
        expect(forgedTargets).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6']);
        for (const probe of result.negativeProbes) expect(probe.present).toBe(true);

        // Granted level never exceeds witnessed, and never exceeds the ceiling.
        expect(complianceOrder(result.complianceLevel))
          .toBeLessThanOrEqual(complianceOrder(result.witnessedLevel));
        expect(complianceOrder(result.witnessedLevel))
          .toBeLessThanOrEqual(complianceOrder(getCapabilityProfile(kind).complianceCeiling));
      }
    }
  });

  it('compliant claude-code is witnessed to its full C6/T5 ceiling as official', async () => {
    const result = await probeFixture('claude-code', 'compliant');
    expect(result.witnessedLevel).toBe('C6');
    expect(result.complianceLevel).toBe('C6');
    expect(result.transcriptFidelity).toBe('T5');
    expect(result.downgrade).toBeUndefined();
    expect(result.failedChecks).toEqual([]);
  });

  it('compliant ollama is honestly capped at its C2 gateway ceiling', async () => {
    const result = await probeFixture('ollama', 'compliant');
    expect(result.witnessedLevel).toBe('C2');
    expect(result.transcriptFidelity).toBe('T4');
    const c3 = result.checks.find((c) => c.level === 'C3');
    expect(c3.passed).toBe(false);
  });

  it('weak adapter: gateway leak fires direct-mcp-bypass and caps governance at C1', async () => {
    const result = await probeFixture('claude-code', 'weak');
    expect(result.witnessedLevel).toBe('C1');
    const bypass = result.negativeProbes.find((p) => p.kind === 'direct-mcp-bypass');
    expect(bypass.fired).toBe(true);
    expect(bypass.downgraded).toBe(true);
    expect(bypass.observedLevel).toBe('C1');
    // The weak adapter over-claimed C3; the downgrade is recorded.
    expect(result.downgrade).toMatchObject({ from: 'C3', to: 'C1' });
  });

  it('broken adapter: thrown exercises are failed checks, mode is run-log, remediation exists', async () => {
    const result = await probeFixture('claude-code', 'broken');
    expect(result.witnessedLevel).toBe('C0');
    expect(result.complianceLevel).toBe('C0');
    const transcript = result.checks.find((c) => c.name === 'transcript-verified');
    expect(transcript.passed).toBe(false);
    expect(transcript.details).toMatch(/threw/);
    expect(result.downgrade?.mode).toBe('run-log');
    expect(result.remediation.length).toBeGreaterThan(0);
    expect(result.remediation.some((r) => typeof r.action === 'string')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Gate 1: forged compliance is downgraded
// ---------------------------------------------------------------------------

describe('ch18 C2 gate: forged compliance is downgraded', () => {
  it('a malicious adapter claiming C6 ends at C0/unmanaged with every fired attack downgraded', async () => {
    const result = await probeFixture('claude-code', 'malicious');

    // The forged C6 claim did not survive.
    expect(result.witnessedLevel).toBe('C0');
    expect(result.complianceLevel).toBe('C0');
    expect(result.downgrade).toMatchObject({ from: 'C6', to: 'C0', mode: 'unmanaged' });
    expect(result.downgrade.reason).toMatch(/forged compliance is downgraded/);

    // Every attack that fired was caught: no-downgrade-on-forgery is impossible.
    const fired = result.negativeProbes.filter((p) => p.fired === true);
    expect(fired.length).toBeGreaterThanOrEqual(5);
    for (const probe of fired) {
      expect(probe.downgraded).toBe(true);
      expect(probe.observedLevel).toBe('C0');
    }
  });

  it('a fabricated transcript (invalid hash chain) cannot earn C1', async () => {
    const result = await probeFixture('codex-cli', 'malicious');
    const transcript = result.checks.find((c) => c.name === 'transcript-verified');
    expect(transcript.passed).toBe(false);
    expect(complianceOrder(result.witnessedLevel)).toBe(0);
  });

  it('the malicious probe result still satisfies the normative witnessing invariant', async () => {
    const result = await probeFixture('custom-http', 'malicious');
    const { valid, violations } = checkProbeWitnessing(result);
    expect(violations).toEqual([]);
    expect(valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Gate 2: observed agents cannot receive C2+ controls
// ---------------------------------------------------------------------------

describe('ch18 C2 gate: observed agents cannot receive C2+ controls', () => {
  const observedNode = {
    schema: 'pd.agent-harbor.agent-node.v0',
    agentNodeId: 'anode_observed_1',
    identity: 'demo:imported:legacy',
    class: 'voyager',
    authority: 'observed',
    complianceLevel: 'C0',
    officialMode: 'observed',
    status: 'active',
    createdAt: '2026-07-05T00:00:00Z',
  };

  it('denies every C2+ control kind for an observed node with an honest unsupported status', () => {
    const c2Plus = Object.entries(CONTROL_MIN_LEVEL)
      .filter(([, min]) => complianceOrder(min) >= complianceOrder('C2'))
      .map(([kind]) => kind);
    expect(c2Plus.sort()).toEqual(['checkpoint', 'fork', 'interrupt', 'kill', 'pause', 'resume', 'steer'].sort());

    for (const kind of c2Plus) {
      const auth = authorizeControl(observedNode, kind);
      expect(auth.allowed).toBe(false);
      expect(auth.denialStatus).toBe('unsupported');
      expect(auth.denialReason).toMatch(/observed agents cannot receive C2\+ controls/);
    }
  });

  it('even a forged high level on an observed node does not open the gate', async () => {
    // Attack: observed node record carries a (self-attested or stale) C6 and a
    // witness probe from a compliant body — the observed-authority rule still wins.
    const witness = await probeFixture('claude-code', 'compliant');
    const forged = { ...observedNode, complianceLevel: 'C6', complianceProbeId: witness.probeId };
    const auth = authorizeControl(forged, 'steer', witness);
    expect(auth.allowed).toBe(false);
    expect(auth.denialStatus).toBe('unsupported');
  });

  it('retire (a C0 registry operation) remains allowed for observed nodes', () => {
    const auth = authorizeControl(observedNode, 'retire');
    expect(auth.allowed).toBe(true);
  });

  it('the denial shape is a schema-valid ControlCommand with denialReason', () => {
    const command = makeControlCommand('anode_observed_1', 'pause', 'operator:erich');
    expectSchemaValid('control-command', command);
    const gated = applyControlGate(command, observedNode);
    expect(gated.status).toBe('unsupported');
    expect(typeof gated.denialReason).toBe('string');
    expectSchemaValid('control-command', gated);
  });

  it('self-reported levels never authorize: a node claiming C4 with no witness is treated as C0', () => {
    const selfReporter = {
      ...observedNode,
      agentNodeId: 'anode_selfreport_1',
      authority: 'local',
      officialMode: 'official',
      complianceLevel: 'C4',
      complianceProbeId: null,
    };
    expect(effectiveComplianceLevel(selfReporter, null)).toBe('C0');
    const auth = authorizeControl(selfReporter, 'pause');
    expect(auth.allowed).toBe(false);
    expect(auth.denialStatus).toBe('failed');
    expect(auth.denialReason).toMatch(/self-report never authorizes/);
  });

  it('a witness-backed local node at C4 receives pause; the same node cannot resume (C6)', async () => {
    const witness = await probeFixture('claude-code', 'compliant'); // witnessedLevel C6
    const node = {
      schema: 'pd.agent-harbor.agent-node.v0',
      agentNodeId: witness.agentNodeId,
      identity: 'demo:official:main',
      class: 'voyager',
      authority: 'local',
      complianceLevel: 'C4',
      complianceProbeId: witness.probeId,
      officialMode: 'official',
      status: 'active',
      createdAt: '2026-07-05T00:00:00Z',
    };
    expect(checkNodeWitnessing(node, witness).valid).toBe(true);
    expect(authorizeControl(node, 'pause', witness).allowed).toBe(true);
    expect(authorizeControl(node, 'interrupt', witness).allowed).toBe(true);
    // The node record grants C4; resume needs C6 — witness alone does not raise the grant.
    const resume = authorizeControl(node, 'resume', witness);
    expect(resume.allowed).toBe(false);
  });

  it('mechanically unsupported controls are honest unsupported, not silent no-ops', async () => {
    const witness = await probeFixture('ollama', 'compliant'); // witnessed C2
    const node = {
      agentNodeId: witness.agentNodeId,
      authority: 'local',
      complianceLevel: 'C2',
      complianceProbeId: witness.probeId,
      officialMode: 'official',
    };
    // ollama has no steer channel (capability matrix) even though C3 gating is the binding failure here.
    const steer = authorizeControl(node, 'steer', witness, 'ollama');
    expect(steer.allowed).toBe(false);
    expect(steer.denialStatus).toBe('unsupported');
  });
});

// ---------------------------------------------------------------------------
// Gate 4: partial cost survives abort or failed body start
// ---------------------------------------------------------------------------

describe('ch18 C2 gate: partial cost survives abort or failed body start', () => {
  const baseOpts = {
    agentNodeId: 'anode_cost_1',
    sessionId: 'session_cost_1',
    runId: 'run_cost_1',
    provider: 'anthropic',
    modelTier: 'mid',
    modelName: 'claude-sonnet-4-6',
  };

  it('emits schema-valid events for all five phases across a clean run', () => {
    const ledger = new CostAccrualLedger({ ...baseOpts });
    ledger.recordStart();
    ledger.recordStream({ quantity: 1200, unit: 'output-tokens', estimatedCostUsd: 0.02 });
    ledger.recordStream({ quantity: 900, unit: 'output-tokens', estimatedCostUsd: 0.015 });
    const final = ledger.finalize(0.034);
    for (const event of ledger.events()) expectSchemaValid('cost-accrual-event', event);
    expect(ledger.events().map((e) => e.phase)).toEqual(['start', 'stream', 'stream', 'finalization']);
    expect(final.quantity).toBe(2100);
    expect(final.actualCostUsd).toBe(0.034);
  });

  it('ABORT: the partial quantity and cost accrued before the abort survive as a durable fact', () => {
    const emitted = [];
    const ledger = new CostAccrualLedger({ ...baseOpts, onEvent: (e) => emitted.push(e) });
    ledger.recordStart();
    ledger.recordStream({ quantity: 500, estimatedCostUsd: 0.01 });
    ledger.recordStream({ quantity: 250, estimatedCostUsd: 0.005 });
    const abort = ledger.recordAbort('operator interrupt');
    expect(abort.phase).toBe('abort');
    expect(abort.quantity).toBe(750);
    expect(abort.estimatedCostUsd).toBeCloseTo(0.015, 10);
    expect(abort.stopReason).toBe('operator interrupt');
    expectSchemaValid('cost-accrual-event', abort);
    // The fact reached the C1 persistence sink before the abort propagated.
    expect(emitted.map((e) => e.phase)).toContain('abort');
    // Terminal idempotence: a duplicate abort or late finalize is a no-op returning the fact.
    expect(ledger.recordAbort()).toBe(abort);
    expect(ledger.finalize()).toBe(abort);
    // Stream accrual after terminal is a hard error, never silent corruption.
    expect(() => ledger.recordStream({ quantity: 1 })).toThrow(/terminal/);
  });

  it('FAILED BODY START: start + failure events exist with zero stream', () => {
    const ledger = new CostAccrualLedger({ ...baseOpts, runId: 'run_failed_start' });
    ledger.recordStart();
    const failure = ledger.recordFailure('adapter binary not found');
    expect(ledger.events().map((e) => e.phase)).toEqual(['start', 'failure']);
    expect(failure.quantity).toBe(0);
    expect(failure.stopReason).toBe('adapter binary not found');
    for (const event of ledger.events()) expectSchemaValid('cost-accrual-event', event);
  });

  it('withCostCapture records the abort fact BEFORE the abort propagates', async () => {
    const ledger = new CostAccrualLedger({ ...baseOpts, runId: 'run_capture' });
    const abortError = new Error('aborted mid-stream');
    abortError.name = 'AbortError';
    await expect(withCostCapture(ledger, async () => {
      ledger.recordStream({ quantity: 300, estimatedCostUsd: 0.006 });
      throw abortError;
    })).rejects.toThrow('aborted mid-stream');
    const abort = ledger.events().find((e) => e.phase === 'abort');
    expect(abort).toBeDefined();
    expect(abort.quantity).toBe(300);
  });

  it('budget thresholds annotate accrual facts: warning at 80%, pause at cap', () => {
    const ledger = new CostAccrualLedger({
      ...baseOpts,
      runId: 'run_budget',
      budget: { budgetId: 'budget_1', maxSpendUsd: 1.0 },
    });
    ledger.recordStart();
    const ok = ledger.recordStream({ quantity: 100, estimatedCostUsd: 0.5 });
    expect(ok.budgetAction).toBe('none');
    const warn = ledger.recordStream({ quantity: 100, estimatedCostUsd: 0.35 });
    expect(warn.budgetAction).toBe('warning');
    const exceeded = ledger.recordStream({ quantity: 100, estimatedCostUsd: 0.2 });
    expect(exceeded.budgetAction).toBe('pause');
    expect(exceeded.budgetId).toBe('budget_1');
  });

  it('idempotency keys are unique per fact and events carry the run linkage', () => {
    const ledger = new CostAccrualLedger({ ...baseOpts, runId: 'run_idem' });
    ledger.recordStart();
    ledger.recordStream({ quantity: 10 });
    ledger.finalize();
    const keys = ledger.events().map((e) => e.idempotencyKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const event of ledger.events()) {
      expect(event.runId).toBe('run_idem');
      expect(event.agentNodeId).toBe('anode_cost_1');
      expect(event.modelTier).toBe('mid');
      expect(event.modelName).toBe('claude-sonnet-4-6');
    }
  });
});

// ---------------------------------------------------------------------------
// The pd work probe surface
// ---------------------------------------------------------------------------

describe('pd work probe surface', () => {
  it('probes every adapter kind × every fixture profile with zero uncaught fired probes', async () => {
    const report = await runWorkProbe();
    expect(report.runs).toHaveLength(ADAPTER_KINDS.length * FIXTURE_PROFILES.length);
    expect(report.summary).toHaveLength(report.runs.length);
    const uncaught = report.runs.flatMap(({ result }) =>
      result.negativeProbes.filter((p) => p.fired === true && p.downgraded !== true),
    );
    expect(uncaught).toEqual([]);
  });

  it('narrows to one adapter and one profile on request', async () => {
    const report = await runWorkProbe({ adapterKind: 'codex-cli', profile: 'malicious' });
    expect(report.runs).toHaveLength(1);
    expect(report.runs[0].adapterKind).toBe('codex-cli');
    expect(report.summary[0]).toMatch(/codex-cli\/malicious/);
    expect(report.summary[0]).toMatch(/downgraded C6->C0/);
  });

  it('rejects unknown adapter kinds and profiles with a usage error', async () => {
    await expect(runWorkProbe({ adapterKind: 'skynet' })).rejects.toThrow(/unknown adapter kind/);
    await expect(runWorkProbe({ profile: 'sneaky' })).rejects.toThrow(/unknown fixture profile/);
  });
});

// ---------------------------------------------------------------------------
// Node linkage: probes feed AgentNode grants (ADR-0095 §8 node witnessing)
// ---------------------------------------------------------------------------

describe('probe → AgentNode linkage', () => {
  it('a node granted from a compliant probe passes node witnessing; an inflated node fails', async () => {
    const witness = await probeFixture('claude-code', 'compliant');
    const honest = {
      agentNodeId: witness.agentNodeId,
      complianceLevel: witness.witnessedLevel,
      complianceProbeId: witness.probeId,
    };
    expect(checkNodeWitnessing(honest, witness).valid).toBe(true);

    const inflatedWitness = await probeFixture('ollama', 'compliant'); // witnessed C2
    const inflated = {
      agentNodeId: inflatedWitness.agentNodeId,
      complianceLevel: 'C5',
      complianceProbeId: inflatedWitness.probeId,
    };
    const verdict = checkNodeWitnessing(inflated, inflatedWitness);
    expect(verdict.valid).toBe(false);
    expect(verdict.violations.join(' ')).toMatch(/exceeds linked probe witnessedLevel/);
  });

  it('the frozen ladder is the only ladder: engine constants match the schema enum', () => {
    expect([...COMPLIANCE_LADDER]).toEqual(['C0', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6']);
    expect([...NEGATIVE_PROBE_KINDS].sort()).toEqual([
      'direct-mcp-bypass',
      'disabled-hook-after-launch',
      'forged-heartbeat',
      'forged-level',
      'observed-to-controlled',
    ].sort());
  });
});
