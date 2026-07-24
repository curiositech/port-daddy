// ADR-0119 red-team fixture: the git-guard has NO agent-mintable, agent-
// documented in-band escape. These assertions keep the removed PD_SHIM_OFF
// bypass removed — a future re-introduction (in the shim body, the pre-push
// hook, the guard denial path, or any agent-facing skill doc) fails CI.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

// Every surface an agent can READ (skill docs) or that must ENFORCE without
// standing down on an env flag (shim body, pre-push hook, guard denial path).
const NO_ESCAPE_SURFACES = [
  'cli/utils/git-shim.ts',
  'scripts/install-pre-push-hook.sh',
  'skills/port-daddy-agent-skill/references/git-discipline.md',
  'skills/port-daddy-agent-skill/decisions/skip-coordination-when.md',
  'skills/port-daddy-internal-dev/SKILL.md',
];

describe('ADR-0119: no agent-mintable git-guard escape', () => {
  test.each(NO_ESCAPE_SURFACES)('%s names no in-band bypass', (rel) => {
    // The escape env var must appear NOWHERE on these surfaces — not as a
    // mechanism, not as documentation, not as an example.
    expect(read(rel)).not.toMatch(/PD_SHIM_OFF/);
  });

  test('the shim body has no env-flag short-circuit', () => {
    const shim = read('cli/utils/git-shim.ts');
    // No branch of the form: if [ <env SHIM test> ] — the shim may only exec
    // real git AFTER the destructive-verb + guard consultation, never on a
    // caller-supplied environment flag.
    expect(shim).not.toMatch(/if\s*\[[^\]]*SHIM/);
  });

  test('the guard denial path advertises no disable flag', () => {
    const guard = read('cli/commands/guard.ts');
    expect(guard).not.toMatch(/Disable temporarily/i);
    expect(guard).not.toMatch(/PD_SHIM_OFF/);
  });

  test('the pre-push hook honors no env bypass (binary-agnostic wall)', () => {
    const hook = read('scripts/install-pre-push-hook.sh');
    // The old `if [ "${PD_SHIM_OFF:-}" = "1" ]; then exit 0; fi` must be gone.
    expect(hook).not.toMatch(/exit 0[\s\S]{0,40}SHIM/);
    expect(hook).not.toMatch(/SHIM[\s\S]{0,40}exit 0/);
  });
});
