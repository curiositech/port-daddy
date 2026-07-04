import { describe, expect, test } from '@jest/globals';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');

// [skillId, scriptFile, exportedFn] — make_copy_and_media_human keeps its Python
// humanize_review.py scorer (frontmatter-only upgrade), so it's not in this list.
const audited = [
  ['beautiful-gui-design', 'gui_design_audit', 'auditGuiDesign'],
  ['beautiful-cli-design', 'cli_design_audit', 'auditCliDesign'],
  ['color-contrast-auditor', 'contrast_audit', 'auditContrast'],
  ['native-app-designer', 'native_design_audit', 'auditNativeDesign'],
  ['prompt-engineer', 'prompt_audit', 'auditPrompt'],
  ['ai-engineer', 'ai_system_audit', 'auditAiSystem'],
];

const skillIds = [...audited.map((a) => a[0]), 'make_copy_and_media_human'];

function sample(skillId) {
  return JSON.parse(readFileSync(join(repo, 'skills', skillId, 'examples', 'sample-input.json'), 'utf8'));
}

describe('design/AI-skill auditors pass their sample and reject malformed input', () => {
  test.each(audited)('%s/%s.mjs', async (skillId, scriptFile, fnName) => {
    const mod = await import(pathToFileURL(join(repo, 'skills', skillId, 'scripts', `${scriptFile}.mjs`)).href);
    const fn = mod[fnName];
    expect(typeof fn).toBe('function');

    const report = fn(sample(skillId));
    expect(report.pass).toBe(true);
    expect(Array.isArray(report.findings)).toBe(true);
    expect(report.findings).toHaveLength(0);

    expect(() => fn(null)).toThrow();
    expect(() => fn('not-an-object')).toThrow();
  });

  test('color-contrast-auditor computes a real WCAG ratio and fails a near-miss gray', async () => {
    const mod = await import(pathToFileURL(join(repo, 'skills', 'color-contrast-auditor', 'scripts', 'contrast_audit.mjs')).href);
    // #777 on #fff is the classic ~4.48:1 near-miss below the 4.5:1 body-text floor.
    const report = mod.auditContrast({
      pairs: [{ name: 'body', foreground: '#777777', background: '#FFFFFF', usage: 'body-text' }],
    });
    expect(report.pass).toBe(false);
    expect(JSON.stringify(report.findings)).toMatch(/contrast-below-threshold/);
  });
});

describe('design/AI skills are first-party bundles with intact references', () => {
  test.each(skillIds)('%s frontmatter + reference integrity', (skillId) => {
    const skillDir = join(repo, 'skills', skillId);
    const skillText = readFileSync(join(skillDir, 'SKILL.md'), 'utf8');
    expect(skillText).toContain('io-contract');
    expect(skillText).toMatch(/kind:\s*first-party/);
    expect(existsSync(join(skillDir, 'CHANGELOG.md'))).toBe(true);
    // Require a file extension so prose shorthand like `references/01` (meaning the 01-* file) isn't
    // mistaken for a path; real bundle references always end in .md/.mjs/.json/.yaml/.sh/etc.
    for (const relativePath of [...skillText.matchAll(/`((?:references|examples|templates|schemas|scripts|agents)\/[^`\s]+\.[A-Za-z0-9]+)`/g)].map((m) => m[1])) {
      expect(existsSync(join(skillDir, relativePath)) || existsSync(join(repo, relativePath))).toBe(true);
    }
  });
});
