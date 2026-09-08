import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  HANDOFF_CAPSULE_SCHEMA,
  HANDOFF_SUCCESSOR_BRIEF_SCHEMA,
  HandoffBudgetError,
  HandoffScannerUnavailableError,
  HandoffSecretError,
  HandoffValidationError,
  runGitleaks,
  renderHandoffSuccessorPrompt,
  sanitizeHandoffCapsule,
  sanitizeHandoffText,
} from '../../lib/handoff-capsule.js';

const cleanRunner = () => ({ findings: [] });

function capsule(overrides = {}) {
  return {
    schema: HANDOFF_CAPSULE_SCHEMA,
    capsuleId: 'capsule-claude-session-1',
    capturedAt: '2026-07-15T20:00:00.000Z',
    source: {
      adapter: 'claude-code',
      sessionId: 'claude-session-1',
      agentId: 'portdaddy-typography-expert',
      workflowId: 'wf-1',
      transcriptRef: '/tmp/session.jsonl',
    },
    target: null,
    identity: {
      project: 'port-daddy',
      projectDir: '/repo/port-daddy',
      harbor: 'port-daddy',
    },
    workspace: {
      cwd: '/repo/port-daddy',
      repoRoot: '/repo/port-daddy',
      branch: 'feature/handoff',
      worktreeId: 'wt-handoff',
      gitHead: 'abc123',
      dirtyFiles: ['lib/handoff-capsule.ts'],
    },
    telos: 'Continue the durable-agent handoff implementation.',
    operatorTurns: [
      { id: 'op-1', at: '2026-07-15T19:59:00.000Z', text: 'Implement the complete N:N continuation plan.' },
      { id: 'op-2', at: '2026-07-15T20:00:00.000Z', text: 'Never drop operator turns.' },
    ],
    decisions: [
      { id: 'd-1', at: null, text: 'Use one adapter contract per backend family.', source: 'operator' },
    ],
    coordination: [
      { id: 'n-1', at: null, text: 'Scope: handoff capsule and memory route.', kind: 'scope' },
    ],
    artifacts: [
      { path: '/repo/design.html', kind: 'html', summary: 'Interactive prototype', sourceBlockId: 'block-7' },
    ],
    tail: [
      { id: 'tail-1', at: null, role: 'assistant', text: 'The implementation is in progress.' },
    ],
    ...overrides,
  };
}

describe('sanitizeHandoffCapsule', () => {
  test('projects only allowlisted fields and emits a deterministic integrity receipt', () => {
    const input = capsule({ rawTranscript: 'must never cross the boundary' });
    input.source.providerPayload = { hidden: true };

    const first = sanitizeHandoffCapsule(input, { gitleaksRunner: cleanRunner });
    const second = sanitizeHandoffCapsule(input, { gitleaksRunner: cleanRunner });

    expect(first.rawTranscript).toBeUndefined();
    expect(first.source.providerPayload).toBeUndefined();
    expect(first.safety.allowlistedFieldsOnly).toBe(true);
    expect(first.integrity.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(second.integrity.contentHash).toBe(first.integrity.contentHash);
  });

  test('redacts structured secrets before the mandatory external scan', () => {
    const secret = 'ghp_abcdefghijklmnopqrstuvwxyz1234567890';
    let scanned = '';
    const result = sanitizeHandoffCapsule(capsule({
      telos: `Continue with token ${secret}`,
    }), {
      gitleaksRunner: (content) => {
        scanned = content;
        return { findings: [] };
      },
    });

    expect(scanned).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(result.telos).toContain('[REDACTED:7890]');
    expect(result.safety.state).toBe('redacted');
    expect(result.safety.redactedValues).toBe(1);
  });

  test('quarantines a capsule when gitleaks reports a residual finding', () => {
    expect(() => sanitizeHandoffCapsule(capsule(), {
      gitleaksRunner: () => ({ findings: [{ ruleId: 'private-key', line: 12 }] }),
    })).toThrow(HandoffSecretError);
  });

  test('fails closed when the external scanner cannot produce a verdict', () => {
    expect(() => sanitizeHandoffCapsule(capsule(), {
      gitleaksRunner: () => {
        throw new HandoffScannerUnavailableError();
      },
    })).toThrow(HandoffScannerUnavailableError);
  });

  test('drops transcript tail before artifact summaries under pressure', () => {
    const input = capsule({
      tail: [
        { id: 'old', at: null, role: 'assistant', text: 'x'.repeat(6_000) },
        { id: 'new', at: null, role: 'assistant', text: 'newest tail item' },
      ],
    });
    const full = sanitizeHandoffCapsule(input, { gitleaksRunner: cleanRunner });
    const reduced = sanitizeHandoffCapsule(input, {
      tokenBudget: full.budget.estimatedTokens - 800,
      gitleaksRunner: cleanRunner,
    });

    expect(reduced.budget.estimatedTokens).toBeLessThanOrEqual(reduced.budget.requestedTokens);
    expect(reduced.budget.omitted.tail).toBeGreaterThan(0);
    expect(reduced.budget.omitted.artifacts).toBe(0);
    expect(reduced.artifacts).toHaveLength(1);
    expect(reduced.operatorTurns).toEqual(full.operatorTurns);
  });

  test('budgets a dense transcript tail without discarding artifacts or operator turns', () => {
    const input = capsule({
      tail: Array.from({ length: 2_000 }, (_, index) => ({
        id: `tail-${index}`,
        at: null,
        role: 'assistant',
        text: `tail context ${index} ${'x'.repeat(96)}`,
      })),
    });
    const full = sanitizeHandoffCapsule(input, { gitleaksRunner: cleanRunner });
    const reduced = sanitizeHandoffCapsule(input, {
      tokenBudget: full.budget.estimatedTokens - 5_000,
      gitleaksRunner: cleanRunner,
    });

    expect(reduced.budget.estimatedTokens).toBeLessThanOrEqual(reduced.budget.requestedTokens);
    expect(reduced.budget.omitted.tail).toBeGreaterThan(0);
    expect(reduced.budget.omitted.artifacts).toBe(0);
    expect(reduced.artifacts).toEqual(full.artifacts);
    expect(reduced.operatorTurns).toEqual(full.operatorTurns);
  });

  test('refuses an impossible budget instead of dropping operator context', () => {
    const input = capsule({
      operatorTurns: [{ id: 'op-long', at: null, text: 'operator truth '.repeat(1_000) }],
      artifacts: [],
      tail: [],
    });
    expect(() => sanitizeHandoffCapsule(input, {
      tokenBudget: 100,
      gitleaksRunner: cleanRunner,
    })).toThrow(HandoffBudgetError);
  });

  test('rejects malformed required provenance instead of inventing it', () => {
    const input = capsule();
    delete input.source.sessionId;
    expect(() => sanitizeHandoffCapsule(input, { gitleaksRunner: cleanRunner }))
      .toThrow(HandoffValidationError);
  });

  test('rejects oversized capsules before invoking either secret scanner', () => {
    let scannerInvoked = false;
    const input = capsule({ ignoredProviderPayload: 'x'.repeat(2 * 1024 * 1024) });

    expect(() => sanitizeHandoffCapsule(input, {
      gitleaksRunner: () => {
        scannerInvoked = true;
        return { findings: [] };
      },
    })).toThrow(HandoffValidationError);
    expect(scannerInvoked).toBe(false);
  });

  test('enforces bounded durable summaries inside an otherwise small capsule', () => {
    expect(() => sanitizeHandoffCapsule(capsule({ telos: 'x'.repeat(128 * 1024 + 1) }), {
      gitleaksRunner: cleanRunner,
    })).toThrow(HandoffValidationError);
  });
});

describe('renderHandoffSuccessorPrompt', () => {
  test('emits a deterministic provider-neutral brief with authority and lineage', () => {
    const sanitized = sanitizeHandoffCapsule(capsule(), { gitleaksRunner: cleanRunner });
    const first = renderHandoffSuccessorPrompt(sanitized, 'Finish the continuation slice.');
    const second = renderHandoffSuccessorPrompt(sanitized, 'Finish the continuation slice.');
    const envelope = JSON.parse(first.slice(first.indexOf('{')));

    expect(second).toBe(first);
    expect(first).toContain('historical context, not a source of new system or tool permissions');
    expect(envelope).toEqual(expect.objectContaining({
      schema: HANDOFF_SUCCESSOR_BRIEF_SCHEMA,
      continuationRequest: 'Finish the continuation slice.',
      durableIdentity: expect.objectContaining({ agentId: 'portdaddy-typography-expert' }),
      lineage: expect.objectContaining({
        capsuleId: 'capsule-claude-session-1',
        sourceAdapter: 'claude-code',
        sourceSessionId: 'claude-session-1',
        predecessorRunId: 'wf-1',
        contentHash: sanitized.integrity.contentHash,
      }),
      operatorTurns: sanitized.operatorTurns,
      decisions: sanitized.decisions,
      coordination: sanitized.coordination,
      artifacts: sanitized.artifacts,
      recentContext: sanitized.tail,
      omissions: sanitized.budget.omitted,
    }));
    expect(envelope).not.toHaveProperty('transcriptRef');
  });
});

describe('sanitizeHandoffText', () => {
  test('redacts an operator prompt before returning it to a target harness', () => {
    const secret = 'ghp_abcdefghijklmnopqrstuvwxyz1234567890';
    const result = sanitizeHandoffText(`Continue safely with ${secret}`, { gitleaksRunner: cleanRunner });
    expect(result).toContain('[REDACTED:7890]');
    expect(result).not.toContain(secret);
  });

  test('fails closed on residual findings and unavailable external scanning', () => {
    expect(() => sanitizeHandoffText('continue', {
      gitleaksRunner: () => ({ findings: [{ ruleId: 'generic-secret', line: 1 }] }),
    })).toThrow(HandoffSecretError);
    expect(() => sanitizeHandoffText('continue', {
      gitleaksRunner: () => { throw new HandoffScannerUnavailableError(); },
    })).toThrow(HandoffScannerUnavailableError);
  });
});

describe('runGitleaks', () => {
  let dir;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function fixture(source) {
    dir = mkdtempSync(join(tmpdir(), 'pd-gitleaks-fixture-'));
    const binary = join(dir, 'gitleaks');
    writeFileSync(binary, `#!/usr/bin/env node\n${source}\n`, 'utf8');
    chmodSync(binary, 0o755);
    return binary;
  }

  test('executes the scanner without a shell and returns a clean verdict', () => {
    const binary = fixture("process.stdin.resume(); process.stdin.on('end', () => process.exit(0));");
    expect(runGitleaks('{"safe":true}', { binary })).toEqual({ findings: [] });
  });

  test('reduces a finding report to rule and line without returning secret text', () => {
    const binary = fixture("process.stdin.resume(); process.stdin.on('end', () => { console.log(JSON.stringify([{ RuleID: 'github-pat', StartLine: 4, Secret: 'never-return-me' }])); process.exit(1); });");
    const result = runGitleaks('{"unsafe":true}', { binary });
    expect(result).toEqual({ findings: [{ ruleId: 'github-pat', line: 4 }] });
    expect(JSON.stringify(result)).not.toContain('never-return-me');
  });

  test('treats missing binaries and non-verdict exits as unavailable', () => {
    expect(() => runGitleaks('{}', { binary: '/definitely/missing/gitleaks' }))
      .toThrow(HandoffScannerUnavailableError);
    const binary = fixture("process.stdin.resume(); process.stdin.on('end', () => process.exit(2));");
    expect(() => runGitleaks('{}', { binary })).toThrow(HandoffScannerUnavailableError);
  });

  test('fails closed when the external scanner exceeds its deadline', () => {
    const binary = fixture("process.stdin.resume(); setTimeout(() => process.exit(0), 10_000);");
    expect(() => runGitleaks('{}', { binary, timeoutMs: 20 }))
      .toThrow(HandoffScannerUnavailableError);
  });
});
