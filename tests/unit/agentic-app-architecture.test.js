import { describe, expect, test } from '@jest/globals';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { auditAgenticAppArchitecture } from '../../skills/agentic-app-architecture/scripts/agentic_app_audit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const skillDir = join(repo, 'skills', 'agentic-app-architecture');

function sample() {
  return JSON.parse(readFileSync(join(skillDir, 'examples', 'sample-input.json'), 'utf8'));
}

describe('agentic-app-architecture audit', () => {
  test('passes its own committed sample spec with full per-axis coverage', () => {
    const report = auditAgenticAppArchitecture(sample());
    expect(report.pass).toBe(true);
    expect(report.findings).toHaveLength(0);
    expect(Object.keys(report.coverageByAxis)).toEqual(
      expect.arrayContaining(['transparency', 'stateModel', 'contextStrategy', 'capabilities', 'execution']),
    );
  });

  test('flags a hidden-hands, transcript-only, ungated coding-agent design', () => {
    const weak = {
      appName: 'Ungated code writer',
      transparency: { actionDisclosure: 'not-applicable', evidenceDisclosure: 'not-applicable', uncertaintyDisclosure: 'not-applicable', privateReasoningPolicy: 'redacted-summary-only', interruptMode: 'before-dispatch', rationale: 'The operator cannot inspect or steer the active run.' },
      stateModel: { conversationTranscript: 'used', durableTaskState: 'not-applicable', userMemory: 'not-applicable', provenanceEvidence: 'not-applicable', retention: 'Transcript is the only retained state.', restoreForkPolicy: 'No restore policy exists.', rationale: 'No state beyond the transcript is retained.' },
      contextStrategy: { strategies: ['bounded-input'], rationale: 'Only the current prompt is supplied.' },
      capabilities: { tools: 'used', skills: 'not-applicable', mcp: { status: 'used', coreSize: 40, perProjectSpecialists: false, rationale: 'Every server is always enabled.' }, secretCustody: { required: true, mode: 'argv', scope: 'Full shell invocation.', rationale: 'Secrets are passed with command arguments.' }, rationale: 'Tools are directly available to the agent.' },
      execution: { agentType: 'coding', effectClass: 'external-or-irreversible', isolation: 'not-applicable', control: { kind: 'not-applicable', rationale: 'No control is required.' }, authority: 'The agent decides.', receiptPolicy: 'No receipt is retained.', rationale: 'The code agent can act directly.' },
    };
    const report = auditAgenticAppArchitecture(weak);
    expect(report.pass).toBe(false);
    const codes = report.findings.map((f) => f.code ?? f.id ?? JSON.stringify(f)).join(' ');
    expect(codes).toMatch(/missing-action-disclosure/);
    expect(codes).toMatch(/missing-effect-task-state/);
    expect(codes).toMatch(/secret-exposure-path/);
    expect(report.findings.length).toBeGreaterThanOrEqual(5);
  });

  test('rejects non-object input and fails an empty spec instead of passing it', () => {
    expect(() => auditAgenticAppArchitecture(null)).toThrow();
    expect(() => auditAgenticAppArchitecture('nope')).toThrow();
    // An empty object is a valid-but-maximally-incomplete design: it must fail, not pass or throw.
    const empty = auditAgenticAppArchitecture({});
    expect(empty.pass).toBe(false);
    expect(empty.findings.length).toBeGreaterThan(0);
  });
});

describe('agentic-app-architecture contract', () => {
  test('declares IO contracts and every referenced resource exists', () => {
    const skillText = readFileSync(join(skillDir, 'SKILL.md'), 'utf8');
    expect(skillText).toContain('io-contract');
    expect(skillText).toContain('provenance');
    for (const relativePath of [...skillText.matchAll(/`((?:references|examples|templates|schemas|scripts|agents)\/[^`\s]+)`/g)].map((m) => m[1])) {
      expect(existsSync(join(skillDir, relativePath))).toBe(true);
    }
  });
});
