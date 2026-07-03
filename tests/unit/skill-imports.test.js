import { describe, expect, test } from '@jest/globals';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');

// [skillId, scriptFile, exportedFn]
const audited = [
  ['rust-kernel-ffi', 'ffi_safety_audit', 'auditFfiExport'],
  ['rust-code-testing', 'test_plan_audit', 'auditTestPlan'],
  ['metal-shader-expert', 'shader_perf_audit', 'auditShaderPerf'],
  ['agent-identity-continuity-reputation', 'reputation_soundness_audit', 'auditReputationDesign'],
  ['ux-friction-analyzer', 'friction_audit', 'auditFrictionFlow'],
  ['product-appeal-analyzer', 'appeal_audit', 'auditDesirability'],
  ['web-design-expert', 'design_audit', 'auditWebDesign'],
  ['color-theory-palette-harmony-expert', 'palette_audit', 'auditPaletteSelection'],
];

const skillIds = audited.map((a) => a[0]);

function sample(skillId) {
  return JSON.parse(readFileSync(join(repo, 'skills', skillId, 'examples', 'sample-input.json'), 'utf8'));
}

describe('imported skill auditors pass their sample and reject malformed input', () => {
  test.each(audited)('%s/%s.mjs', async (skillId, scriptFile, fnName) => {
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

describe('imported skills are first-party bundles with intact references', () => {
  test.each(skillIds)('%s frontmatter + reference integrity', (skillId) => {
    const skillDir = join(repo, 'skills', skillId);
    const skillText = readFileSync(join(skillDir, 'SKILL.md'), 'utf8');
    expect(skillText).toContain('io-contract');
    expect(skillText).toContain('provenance');
    expect(skillText).toMatch(/kind:\s*first-party/);
    expect(existsSync(join(skillDir, 'README.md'))).toBe(true);
    expect(existsSync(join(skillDir, 'CHANGELOG.md'))).toBe(true);
    for (const relativePath of [...skillText.matchAll(/`((?:references|examples|templates|schemas|scripts|agents)\/[^`\s]+)`/g)].map((m) => m[1])) {
      // A backtick path resolves either inside the bundle (a real reference) or at the
      // repo root (a repo exemplar cited in prose, e.g. `scripts/build-core.sh`).
      const inBundle = existsSync(join(skillDir, relativePath));
      const inRepo = existsSync(join(repo, relativePath));
      expect(inBundle || inRepo).toBe(true);
    }
  });
});
