import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = process.cwd();
import { CATALOG_PATH, MANIFEST_PATH, RETIRED_TOKEN, digest, eligibleAttributionPath,
  collectAttributionFiles, isContainedTarget, validateAttributionManifest } from '../../scripts/lib/skill-source-attribution.mjs';

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
    expect(text).toContain('pd jury-rig query');
    expect(text).toMatch(/provenance-labelled catalog input|catalog selection never authorizes/i);
    expect(text).toMatch(/scripts, hooks, MCP servers/);
    expect(text).toMatch(/Seamanship.*(?:not yet a shipped verb|not a currently shipped)/i);
  });

  test('the checked-in SessionStart hook injects Jury-rig, not legacy runtime authority', () => {
    const hook = read('hooks/sessionstart-pilot.mjs');
    expect(hook).toContain('Jury-rig skill discovery');
    expect(hook.toLowerCase()).not.toContain(RETIRED_TOKEN);
  });

  test('only exact reviewed source attribution may retain the upstream product name', () => {
    const manifest = JSON.parse(read(MANIFEST_PATH));
    const files = collectAttributionFiles(REPO, manifest);
    const names = new Set(read(CATALOG_PATH).trim().split('\n').slice(1).map((line) => line.split(',')[0]));
    expect(validateAttributionManifest(manifest, files, names)).toEqual([]);
  });
});

describe('source attribution cannot grant native authority', () => {
  const names = new Set(['example', 'port-daddy-agent-skill', 'jury-rig-custodian']);
  const path = 'skills/example/references/source.md';
  const bytes = Buffer.from(`Upstream ${RETIRED_TOKEN} source`);
  const receipt = () => ({ schemaVersion: 1, entries: [{ path, sha256: digest(bytes) }] });

  test.each(['AGENTS.md', 'hooks/sessionstart-pilot.mjs', 'cli/setup.ts',
    'skills/port-daddy-agent-skill/SKILL.md', 'skills/jury-rig-custodian/SKILL.md',
    'skills/example/../../hooks/start.md', '/skills/example/source.md',
    'skills/unrequested/SKILL.md', 'skills/example/AGENTS.md',
    'skills/example/.claude/settings.json', 'skills/example/hooks/start.sh',
    'docs/research/skills-reconciliation-20260923/AGENTS.md'])( '%s cannot become a source exception', (nativePath) => {
    expect(eligibleAttributionPath(nativePath, names)).toBe(false);
    const manifest = { schemaVersion: 1, entries: [{ path: nativePath, sha256: digest(bytes) }] };
    expect(validateAttributionManifest(manifest, new Map([[nativePath, bytes]]), names).length).toBeGreaterThan(0);
  });

  test('accepts reviewed bytes but rejects changed, unlisted, and removed files', () => {
    expect(validateAttributionManifest(receipt(), new Map([[path, bytes]]), names)).toEqual([]);
    expect(validateAttributionManifest(receipt(), new Map([[path, Buffer.from('changed')]]), names)).toContain(`stale attribution: ${path}`);
    expect(validateAttributionManifest({ schemaVersion: 1, entries: [] }, new Map([[path, bytes]]), names)).toContain(`unreviewed attribution: ${path}`);
    expect(validateAttributionManifest(receipt(), new Map(), names)).toContain(`stale attribution: ${path}`);
  });

  test('internal reference links stay in the repo and external or sibling targets fail', () => {
    expect(isContainedTarget('/repo', '/repo/skills/other/reference.md')).toBe(true);
    expect(isContainedTarget('/repo', '/repo-sibling/reference.md')).toBe(false);
    expect(isContainedTarget('/repo', '/private/reference.md')).toBe(false);
  });

  test('rejects duplicate entries and arbitrary manifest instructions', () => {
    const duplicate = receipt();
    duplicate.entries.push({ ...duplicate.entries[0] });
    expect(validateAttributionManifest(duplicate, new Map([[path, bytes]]), names)).toContain(`duplicate attribution: ${path}`);
    expect(validateAttributionManifest({ ...receipt(), execute: 'something' }, new Map(), names)).toEqual(['invalid manifest schema']);
  });
});
