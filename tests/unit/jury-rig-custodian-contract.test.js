import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const REPO = process.cwd();
const RETIRED_TOKEN = ['win', 'dags'].join('');

function read(relativePath) {
  return readFileSync(join(REPO, relativePath), 'utf8');
}

function prose(text) {
  return text.replace(/\s+/g, ' ').trim();
}

describe('Jury-rig Custodian sole-owner contract', () => {
  const contract = prose(read('fleet/ships/jury-rig-custodian.md'));

  test('defines one exclusive standing concern and matching authority', () => {
    expect(contract).toContain("This is the role's one exclusive concern");
    expect(contract).toContain('Exactly one actor may be Accountable');
    expect(contract).toContain('dispatches the repair to the responsible lane');
    expect(contract).toContain('does not silently implement every repair');
  });

  test('defines the typed ledger, private state, TTL signal, and full reconciliation', () => {
    expect(contract).toContain('**Ledger prefix:** `jury-rig-custodian:`');
    expect(contract).toContain('`~/.port-daddy/custodians/jury-rig/state.json`');
    expect(contract).toContain('["jury-rig-custodian", "state"');
    expect(contract).toContain('Use a four-hour TTL');
    expect(contract).toContain('Read the most recent `jury-rig-custodian:` ledger entry');
    expect(contract).toContain('Cover everything since that entry; never use a fixed recent window');
    expect(contract).toContain('Write `ALL QUIET` when there are no findings');
  });

  test('defines escalation, handover, and the honest enforcement gap', () => {
    for (const tier of ['Tier 1, ledger only', 'Tier 2, repair + roadmap/PR link', 'Tier 3, operator-visible warning']) {
      expect(contract).toContain(tier);
    }
    expect(contract).toContain('Handover is complete only after the successor appends');
    expect(contract).toContain("ADR-0041's obligation monitor and sanctions are not built");
    expect(contract).toContain('do not simulate the missing authority in prose');
  });

  test('requires attributable agent-authored GitHub transport', () => {
    expect(contract).toContain('operator account is transport only');
    expect(contract).toContain('Port Daddy agent id, session id');
    expect(contract).toContain('roadmap authority, exact head');
    expect(contract).toContain('durable receipt/note attribution');
  });
});

describe('tracked cross-harness authority', () => {
  test.each([
    ['AGENTS.md', ['Codex', 'Cursor', 'Cline', 'Aider']],
    ['.gemini/extensions/port-daddy/GEMINI.md', ['Gemini']],
  ])('%s delegates discovery to native Jury-rig without granting catalog execution', (path) => {
    const text = prose(read(path));
    expect(text).toContain('pd jury-rig search');
    expect(text).toContain('pd jury-rig graft');
    expect(text).toMatch(/provenance-labelled catalog input|catalog selection never authorizes/i);
    expect(text).toMatch(/scripts, hooks, MCP servers/);
    expect(text).toMatch(/Seamanship.*(?:not yet a shipped verb|not a currently shipped)/i);
  });

  test('the checked-in SessionStart hook injects Jury-rig, not legacy runtime authority', () => {
    const hook = read('hooks/sessionstart-pilot.mjs');
    expect(hook).toContain('Jury-rig skill discovery');
    expect(hook.toLowerCase()).not.toContain(RETIRED_TOKEN);
  });

  test('the tracked repository contains no retired product token in paths or text', () => {
    const files = execFileSync('git', ['ls-files', '-z'], { cwd: REPO })
      .toString('utf8').split('\0').filter(Boolean);
    expect(files.filter((path) => path.toLowerCase().includes(RETIRED_TOKEN))).toEqual([]);
    const offenders = files.filter((path) => {
      try {
        return read(path).toLowerCase().includes(RETIRED_TOKEN);
      } catch {
        return false;
      }
    });
    expect(offenders).toEqual([]);
  });
});
