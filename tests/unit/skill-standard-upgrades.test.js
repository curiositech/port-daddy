import { describe, expect, test } from '@jest/globals';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');

// Each entry: [skillId, scriptFile, exportedFn]. gpui-rust-console is intentionally absent
// (it ships its own Python domain scripts; the upgrade was frontmatter-only).
const audited = [
  ['vello-parley-rendering', 'render_plan_audit', 'auditRenderPlan'],
  ['episodic-memory-algorithms', 'memory_readiness', 'auditMemoryDesign'],
  ['rust-gpui-motion', 'motion_audit', 'auditMotionPlan'],
  ['rust-debugging-mastery', 'debug_plan_audit', 'auditDebugPlan'],
  ['agentic-infrastructure-2026', 'infra_readiness', 'auditInfraReadiness'],
  ['gpui-shaders', 'shader_budget_audit', 'auditShaderPlan'],
  ['metal-text-pipeline', 'rung_decision_audit', 'auditRungDecision'],
  ['build-coop-ide-gpui', 'coop_ide_audit', 'auditCoopIdeArchitecture'],
  ['rust-data-structures-advanced', 'structure_choice_audit', 'auditStructureChoice'],
  ['cooperative-vibe-coding', 'session_readiness', 'auditCoopSession'],
];

const allSkills = [...audited.map((a) => a[0]), 'gpui-rust-console'];

function sample(skillId) {
  return JSON.parse(readFileSync(join(repo, 'skills', skillId, 'examples', 'sample-input.json'), 'utf8'));
}

describe('skill-standard-upgrade auditors pass their sample and reject malformed input', () => {
  test.each(audited)('%s/%s.mjs: sample passes, malformed throws', async (skillId, scriptFile, fnName) => {
    const mod = await import(join(repo, 'skills', skillId, 'scripts', `${scriptFile}.mjs`));
    const fn = mod[fnName];
    expect(typeof fn).toBe('function');

    const report = fn(sample(skillId));
    expect(report.pass).toBe(true);
    expect(Array.isArray(report.findings)).toBe(true);
    expect(report.findings).toHaveLength(0);

    expect(() => fn(null)).toThrow();
    expect(() => fn('not-an-object')).toThrow();
  });
});

describe('upgraded skills are first-party with io-contract and intact references', () => {
  test.each(allSkills)('%s frontmatter + reference integrity', (skillId) => {
    const skillDir = join(repo, 'skills', skillId);
    const skillText = readFileSync(join(skillDir, 'SKILL.md'), 'utf8');
    expect(skillText).toContain('io-contract');
    expect(skillText).toContain('provenance');
    expect(existsSync(join(skillDir, 'CHANGELOG.md'))).toBe(true);
    for (const relativePath of [...skillText.matchAll(/`((?:references|examples|templates|schemas|scripts|agents)\/[^`\s]+)`/g)].map((m) => m[1])) {
      expect(existsSync(join(skillDir, relativePath))).toBe(true);
    }
  });
});
