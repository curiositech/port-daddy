import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const BYPASS_NAME = ['PD', 'SHIM', 'OFF'].join('_');

function read(path) {
  return readFileSync(join(ROOT, path), 'utf8');
}

describe('Guard refusal copy keeps operator recovery out of agent instructions', () => {
  const agentFacingDocs = [
    'AGENTS.md',
    'skills/port-daddy-agent-skill/decisions/skip-coordination-when.md',
    'skills/port-daddy-agent-skill/references/git-discipline.md',
    'skills/port-daddy-internal-dev/SKILL.md',
  ];

  test.each(agentFacingDocs)('%s does not teach the operator escape', (path) => {
    expect(read(path)).not.toContain(BYPASS_NAME);
  });

  test('live Guard and pre-push refusal output name corrective action only', () => {
    const guardOutput = read('cli/commands/guard.ts')
      .split('\n')
      .filter((line) => /ui\.(?:info|warn|error|success)\(/.test(line))
      .join('\n');
    const prePushOutput = read('scripts/install-pre-push-hook.sh')
      .split('\n')
      .filter((line) => /echo /.test(line))
      .join('\n');

    expect(guardOutput).not.toContain(BYPASS_NAME);
    expect(prePushOutput).not.toContain(BYPASS_NAME);
    expect(guardOutput).toMatch(/repair the active session, claims, or notes/i);
    expect(prePushOutput).toMatch(/protected merge path/i);
  });

  test('audited operator recovery remains implemented outside refusal copy', () => {
    expect(read('cli/utils/git-shim.ts')).toContain(`${BYPASS_NAME}:-`);
    expect(read('cli/utils/git-shim.ts')).toContain('destructive-ops.log');
    expect(read('scripts/install-pre-push-hook.sh')).toContain(`${BYPASS_NAME}:-`);
  });
});
