/**
 * Work Order C8 — Setup and doctor remediation (binder ch18, ADR-0095 F0).
 *
 * Locks the four ch18 acceptance gates:
 *   1. ONE default install path — every from-zero repair routes through
 *      `pd setup` / the Homebrew tap; no stale npm instructions anywhere.
 *   2. ONE doctor repair per detected issue — a non-ok card carries exactly
 *      one repair command, never a menu of alternatives.
 *   3. Users can see what is local, what syncs, and what is disabled — every
 *      card and every registry area declares its sync posture.
 *   4. F0 consumption uses the frozen v0 contracts verbatim: the fixture
 *      ComplianceProbeResult / AgentNode from schemas/agent-harbor/v0/fixtures
 *      must flow through remediationCardsFromProbe and the first-value metric
 *      without adaptation, and a self-attested probe must surface CRITICAL.
 */
import { describe, expect, test } from '@jest/globals';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HARBOR_AREAS,
  DEFAULT_INSTALL_COMMAND,
  DEFAULT_SETUP_COMMAND,
  assessHarborReadiness,
  assessDaemon,
  assessApp,
  assessHooks,
  assessMcp,
  assessTranscriptPath,
  assessKeychain,
  assessProviderKeys,
  assessWorktreeRoot,
  assessRelayPairing,
  assessStaleVersions,
  remediationCardsFromProbe,
  transparentHookInventory,
  isOfficialAgentNode,
  firstOfficialAgentNode,
  computeFirstValue,
  emptyFirstValueRecord,
  loadFirstValueRecord,
  saveFirstValueRecord,
  formatDurationMs,
  renderRemediationCards,
} from '../../lib/agent-harbor/setup-doctor.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, '..', '..', 'schemas', 'agent-harbor', 'v0', 'fixtures');
const probeFixture = JSON.parse(readFileSync(join(fixtureDir, 'compliance-probe-result.json'), 'utf8'));
const nodeFixture = JSON.parse(readFileSync(join(fixtureDir, 'agent-node.json'), 'utf8'));

/** Facts where every area is broken — the worst honest machine. */
function brokenFacts() {
  return {
    daemon: { reachable: false, version: null, supervised: null },
    app: { platform: 'darwin', fleetBarInstalled: false },
    hooks: [
      { providerName: 'claude-code', binaryName: 'claude', configPath: '/x/.claude/settings.json', ok: false, detail: 'hook config missing', hint: 'Run: pd squid on' },
      { providerName: 'codex', binaryName: 'codex', configPath: '/x/.codex/config.toml', ok: false, detail: 'missing or stale Port Daddy hook TOML block/metadata', hint: 'Run: pd squid on' },
    ],
    mcp: { configured: false, detail: 'port-daddy MCP missing from 3 known agent config(s)' },
    transcriptPath: { path: '/x/port-registry.db', exists: true, writable: false },
    keychain: { platform: 'darwin', available: false },
    providerKeys: [
      { backend: 'cli:claude-code', status: 'needs_setup', nextStep: 'claude' },
      { backend: 'cli:codex', status: 'needs_setup', nextStep: 'codex login' },
    ],
    worktreeRoot: { path: '/x/coding/tmp', exists: false, writable: false },
    relay: { relayUrl: 'wss://relay.example', connected: false },
    versions: { cliVersion: '3.24.1', daemonVersion: '3.23.0', latestVersion: null },
  };
}

/** Facts where every area is healthy. */
function healthyFacts() {
  return {
    daemon: { reachable: true, version: '3.24.1', supervised: true },
    app: { platform: 'darwin', fleetBarInstalled: true },
    hooks: [
      { providerName: 'claude-code', binaryName: 'claude', configPath: '/x/.claude/settings.json', ok: true, detail: '3 local hooks installed with privacy metadata', hint: '' },
    ],
    mcp: { configured: true, detail: 'port-daddy MCP configured for Claude Code' },
    transcriptPath: { path: '/x/port-registry.db', exists: true, writable: true },
    keychain: { platform: 'darwin', available: true },
    providerKeys: [{ backend: 'cli:claude-code', status: 'manual_check', launchableUnverified: true }],
    worktreeRoot: { path: '/x/coding/tmp', exists: true, writable: true },
    relay: { relayUrl: null, connected: null },
    versions: { cliVersion: '3.24.1', daemonVersion: '3.24.1', latestVersion: '3.24.1' },
  };
}

describe('harbor area registry (ch18 gate: local/synced/disabled visibility)', () => {
  test('covers exactly the ten C8 areas', () => {
    expect(HARBOR_AREAS.map((a) => a.id).sort()).toEqual([
      'app', 'daemon', 'hooks', 'keychain', 'mcp', 'provider-keys',
      'relay-pairing', 'stale-versions', 'transcript-path', 'worktree-root',
    ]);
  });

  test('every area declares plain-language sync copy and a default posture', () => {
    for (const area of HARBOR_AREAS) {
      expect(area.syncCopy.length).toBeGreaterThan(10);
      expect(['local', 'synced', 'disabled']).toContain(area.defaultSyncState);
      expect(area.whatItIs.length).toBeGreaterThan(10);
    }
  });

  test('relay pairing defaults to disabled — unpaired is a mode, not an error', () => {
    const relay = HARBOR_AREAS.find((a) => a.id === 'relay-pairing');
    expect(relay.defaultSyncState).toBe('disabled');
  });
});

describe('one repair per detected issue (ch18 gate)', () => {
  test('every non-ok card carries exactly one repair with one command', () => {
    const cards = assessHarborReadiness(brokenFacts());
    const issues = cards.filter((c) => c.status !== 'ok');
    expect(issues.length).toBeGreaterThanOrEqual(8);
    for (const card of issues) {
      expect(card.repair).toBeDefined();
      expect(card.repair.command.length).toBeGreaterThan(0);
      expect(card.repair.description.length).toBeGreaterThan(0);
      // One command, not a menu: no " OR " / " or run " alternatives.
      expect(card.repair.command).not.toMatch(/\bOR\b/);
      expect(typeof card.repair.oneClick).toBe('boolean');
    }
  });

  test('ok cards carry no repair', () => {
    const cards = assessHarborReadiness(healthyFacts());
    for (const card of cards) {
      expect(card.status).toBe('ok');
      expect(card.severity).toBe('ok');
      expect(card.repair).toBeUndefined();
    }
  });

  test('always emits exactly one card per area, in registry order', () => {
    for (const facts of [brokenFacts(), healthyFacts()]) {
      const cards = assessHarborReadiness(facts);
      expect(cards.map((c) => c.area)).toEqual(HARBOR_AREAS.map((a) => a.id));
    }
  });
});

describe('one default install path, no stale npm instructions (ch18 gates)', () => {
  test('the blessed bootstrap is the Homebrew tap', () => {
    expect(DEFAULT_INSTALL_COMMAND).toBe('brew install curiositech/tap/port-daddy');
    expect(DEFAULT_SETUP_COMMAND).toBe('pd setup');
  });

  test('no repair anywhere mentions npm install', () => {
    const cards = assessHarborReadiness(brokenFacts());
    for (const card of cards) {
      const text = `${card.detail} ${card.repair?.command ?? ''} ${card.repair?.description ?? ''}`;
      expect(text).not.toMatch(/npm\s+install/i);
      expect(text).not.toMatch(/npm\s+i\s+-g/i);
    }
  });

  test('unreachable daemon routes through the default setup path', () => {
    const card = assessDaemon({ reachable: false });
    expect(card.severity).toBe('critical');
    expect(card.repair.command).toBe('pd setup');
  });
});

describe('per-area judgments', () => {
  test('reachable-but-unsupervised daemon is a warn (KeepAlive cannot verify its own absence)', () => {
    const card = assessDaemon({ reachable: true, version: '3.24.1', supervised: false });
    expect(card.severity).toBe('warn');
    expect(card.status).toBe('drifted');
    expect(card.detail).toMatch(/not be resurrected/i);
    expect(card.repair.command).toBe('port-daddy install');
  });

  test('supervision assessment detail + repair pass through verbatim (bootout/kickstart, not a blanket install)', () => {
    // Duplicate supervisors: the right repair is bootout, not port-daddy install.
    const card = assessDaemon({
      reachable: true,
      version: '3.24.1',
      supervised: false,
      supervisionDetail: '2 supervisors loaded (homebrew.mxcl.port-daddy, rogue.port-daddy-supervisor) — duplicate KeepAlive jobs race the listener',
      supervisionRepair: {
        command: 'launchctl bootout gui/$(id -u)/rogue.port-daddy-supervisor',
        description: 'Unloads the duplicate supervisor so exactly one KeepAlive job owns the daemon.',
      },
    });
    expect(card.severity).toBe('warn');
    expect(card.detail).toContain('duplicate KeepAlive jobs');
    expect(card.repair.command).toBe('launchctl bootout gui/$(id -u)/rogue.port-daddy-supervisor');
    expect(card.repair.command).not.toBe('port-daddy install');
  });

  test('supervised reachable daemon is ok', () => {
    const card = assessDaemon({ reachable: true, version: '3.24.1', supervised: true });
    expect(card.status).toBe('ok');
    expect(card.detail).toContain('supervised');
  });

  test('FleetBar is skipped honestly off macOS', () => {
    expect(assessApp({ platform: 'linux', fleetBarInstalled: false }).status).toBe('ok');
    expect(assessApp({ platform: 'darwin', fleetBarInstalled: false }).status).toBe('missing');
  });

  test('broken hooks name the providers and repair with pd squid on', () => {
    const card = assessHooks(brokenFacts().hooks);
    expect(card.detail).toContain('claude-code');
    expect(card.detail).toContain('codex');
    expect(card.repair.command).toBe('pd squid on');
    // Honest governance copy: vanished hooks downgrade, never overclaim.
    expect(card.detail).toMatch(/observed mode/);
  });

  test('MCP drift repairs with pd mcp install', () => {
    const card = assessMcp({ configured: false, detail: 'port-daddy MCP missing from 2 known agent config(s)' });
    expect(card.status).toBe('drifted');
    expect(card.repair.command).toBe('pd mcp install');
  });

  test('transcript absence is data: missing-but-creatable is ok with a named cause', () => {
    const ok = assessTranscriptPath({ path: '/x/db', exists: false, writable: true });
    expect(ok.status).toBe('ok');
    expect(ok.detail).toMatch(/first daemon start/);
    const bad = assessTranscriptPath({ path: '/x/db', exists: true, writable: false });
    expect(bad.severity).toBe('critical');
    expect(bad.repair.command).toContain('chmod');
  });

  test('keychain honesty: unsupported platform is ok, broken darwin keychain warns', () => {
    expect(assessKeychain({ platform: 'linux', available: false }).status).toBe('ok');
    expect(assessKeychain({ platform: 'darwin', available: false }).severity).toBe('warn');
    expect(assessKeychain({ platform: 'darwin', available: true }).status).toBe('ok');
  });

  test('zero launchable backends is a WARN (setup-incomplete, not broken) with the first concrete credential step', () => {
    const card = assessProviderKeys(brokenFacts().providerKeys);
    // WARN, not CRITICAL: a fresh machine / bare CI runner with no AI backend
    // installed is an incomplete setup, and `pd doctor`'s exit code gates CI
    // builds on CRITICAL (scripts/ci-doctor-gate.sh) — a healthy daemon must
    // not fail that gate for a missing optional backend.
    expect(card.severity).toBe('warn');
    expect(card.repair.command).toBe('claude');
  });

  test('launchableUnverified counts as launchable (matches spawn preflight)', () => {
    const card = assessProviderKeys([{ backend: 'cli:claude-code', status: 'manual_check', launchableUnverified: true }]);
    expect(card.status).toBe('ok');
  });

  test('missing worktree root repairs with a single mkdir (path shell-quoted)', () => {
    const card = assessWorktreeRoot({ path: '/x/coding/tmp', exists: false, writable: false });
    expect(card.repair.command).toBe("mkdir -p '/x/coding/tmp'");
    // Never recommend the OS-purged /tmp root itself as the worktree home.
    expect(card.repair.command).not.toMatch(/(^|\s)\/(private\/)?tmp\b/);
  });

  test('repair commands quote user-configurable paths (spaces + injection stay inert)', () => {
    const spaced = assessWorktreeRoot({ path: '/x/My Code/tmp', exists: false, writable: false });
    expect(spaced.repair.command).toBe("mkdir -p '/x/My Code/tmp'");

    // A hostile PORT_DADDY_WORKTREE_ROOT must not become command injection.
    const hostile = assessWorktreeRoot({ path: '/x; rm -rf $HOME', exists: true, writable: false });
    expect(hostile.repair.command).toBe("chmod u+rwx '/x; rm -rf $HOME'");

    const transcript = assessTranscriptPath({ path: "/x/it's here.db", exists: true, writable: false });
    expect(transcript.repair.command).toBe("chmod u+rw '/x/it'\\''s here.db'");
  });

  test('relay: unpaired is ok+disabled, paired is synced, configured-but-down warns', () => {
    const unpaired = assessRelayPairing({ relayUrl: null });
    expect(unpaired.status).toBe('ok');
    expect(unpaired.syncState).toBe('disabled');
    expect(unpaired.detail).toMatch(/Nothing leaves this machine/);

    const paired = assessRelayPairing({ relayUrl: 'wss://relay.example', connected: true });
    expect(paired.syncState).toBe('synced');

    const down = assessRelayPairing({ relayUrl: 'wss://relay.example', connected: false });
    expect(down.severity).toBe('warn');
    expect(down.repair.command).toBe('pd relay status');
    // Configured-but-disconnected is still a PAIRED (opt-in) posture — the
    // channel is down, not switched off; 'disabled' would contradict the detail.
    expect(down.syncState).toBe('synced');
  });

  test('cli/daemon version skew repairs with a restart; feed staleness with pd upgrade', () => {
    const skew = assessStaleVersions({ cliVersion: '3.24.1', daemonVersion: '3.23.0' });
    expect(skew.status).toBe('stale');
    expect(skew.repair.command).toBe('port-daddy restart');

    const feed = assessStaleVersions({ cliVersion: '3.24.1', daemonVersion: '3.24.1', latestVersion: '3.25.0' });
    expect(feed.repair.command).toBe('pd upgrade --apply');

    const fresh = assessStaleVersions({ cliVersion: '3.24.1', daemonVersion: '3.24.1' });
    expect(fresh.status).toBe('ok');
  });
});

describe('transparent hook inventory (ch18 output)', () => {
  test('every installed hook has a name, description, privacy note, and binary', () => {
    const inventory = transparentHookInventory();
    expect(inventory.map((h) => h.hookBinary).sort()).toEqual([
      'pd-hook-post-tool', 'pd-hook-pre-tool', 'pd-hook-prompt',
    ]);
    for (const hook of inventory) {
      expect(hook.displayName).toMatch(/Port Daddy/);
      expect(hook.displayName).toMatch(/\(local\)/);
      expect(hook.description.length).toBeGreaterThan(20);
      // Every privacy note states a negative guarantee, in whatever phrasing
      // (not / never / doesn't / stays local / nothing leaves) — assert the
      // family, not one literal word, so copy edits don't break the gate.
      expect(hook.privacy).toMatch(/\b(not|never|no|doesn'?t|stays? local|nothing leaves)\b/i);
    }
  });
});

describe('F0 consumption: ComplianceProbeResult (frozen fixture, verbatim)', () => {
  test('the v0 fixture produces one card per probe remediation entry', () => {
    const cards = remediationCardsFromProbe(probeFixture);
    const hookCards = cards.filter((c) => c.area === 'hooks');
    expect(hookCards).toHaveLength(probeFixture.remediation.length);
    expect(hookCards[0].detail).toContain(probeFixture.agentNodeId);
    expect(hookCards[0].detail).toContain('No turn-start guidance channel.');
    expect(hookCards[0].repair.command).toBe('Install or enable the Port Daddy hook pack.');
    expect(hookCards[0].repair.oneClick).toBe(true);
  });

  test('the witness-valid fixture emits no invariant-violation card', () => {
    const cards = remediationCardsFromProbe(probeFixture);
    expect(cards.filter((c) => c.severity === 'critical')).toHaveLength(0);
  });

  test('a self-attested level surfaces as a CRITICAL card (ADR-0095 §8)', () => {
    const forged = {
      ...probeFixture,
      complianceLevel: 'C5',
      witnessedLevel: 'C5',
    };
    const cards = remediationCardsFromProbe(forged);
    const critical = cards.filter((c) => c.severity === 'critical');
    expect(critical).toHaveLength(1);
    expect(critical[0].detail).toMatch(/witnessing invariant/);
    expect(critical[0].repair.command).toBe(`pd agent probe ${probeFixture.agentNodeId}`);
  });

  test('an honest downgrade becomes a visible card with a re-probe repair', () => {
    const downgraded = {
      ...probeFixture,
      downgrade: { from: 'C2', to: 'C1', mode: 'observed', reason: 'hook disabled after launch' },
    };
    const cards = remediationCardsFromProbe(downgraded);
    const dg = cards.find((c) => c.status === 'disabled');
    expect(dg).toBeDefined();
    expect(dg.detail).toContain("'observed'");
    expect(dg.detail).toContain('C2 → C1');
  });

  test('rejects a payload that is not the frozen v0 schema', () => {
    expect(() => remediationCardsFromProbe({ ...probeFixture, schema: 'pd.agent-harbor.compliance-probe-result.v1' }))
      .toThrow(/not a v0 ComplianceProbeResult/);
  });
});

describe('F0 consumption: AgentNode + first-value metric (time to first official Agent Node)', () => {
  test('the v0 AgentNode fixture qualifies as official', () => {
    expect(isOfficialAgentNode(nodeFixture)).toBe(true);
  });

  test('a probe-unbacked level above C0 is self-report and never counts', () => {
    expect(isOfficialAgentNode({ ...nodeFixture, complianceProbeId: null })).toBe(false);
  });

  test('non-official modes never count', () => {
    for (const mode of ['observed', 'run-log', 'unmanaged', undefined]) {
      expect(isOfficialAgentNode({ ...nodeFixture, officialMode: mode })).toBe(false);
    }
  });

  test('a C0 node needs no probe to be official', () => {
    expect(isOfficialAgentNode({ ...nodeFixture, complianceLevel: 'C0', complianceProbeId: null })).toBe(true);
  });

  test('firstOfficialAgentNode picks the earliest by createdAt', () => {
    const earlier = { ...nodeFixture, agentNodeId: 'agent_node_early', createdAt: '2026-07-05T11:00:00.000Z' };
    expect(firstOfficialAgentNode([nodeFixture, earlier]).agentNodeId).toBe('agent_node_early');
    expect(firstOfficialAgentNode([])).toBeNull();
  });

  test('metric = first official node createdAt - setupCompletedAt', () => {
    const record = { ...emptyFirstValueRecord(), setupCompletedAt: '2026-07-05T12:00:00.000Z' };
    const sealed = computeFirstValue(record, [nodeFixture]); // fixture createdAt 12:00:06
    expect(sealed.firstOfficialAgentNodeAt).toBe(nodeFixture.createdAt);
    expect(sealed.timeToFirstOfficialAgentNodeMs).toBe(6000);
  });

  test('nodes created before setup completed do not count (measures onboarding, not history)', () => {
    const record = { ...emptyFirstValueRecord(), setupCompletedAt: '2026-07-06T00:00:00.000Z' };
    expect(computeFirstValue(record, [nodeFixture]).timeToFirstOfficialAgentNodeMs).toBeNull();
  });

  test('the metric seals once and never re-computes', () => {
    const sealed = {
      setupCompletedAt: '2026-07-05T12:00:00.000Z',
      firstOfficialAgentNodeAt: '2026-07-05T12:00:06.000Z',
      timeToFirstOfficialAgentNodeMs: 6000,
    };
    const laterNode = { ...nodeFixture, createdAt: '2026-07-05T12:00:01.000Z' };
    expect(computeFirstValue(sealed, [laterNode])).toEqual(sealed);
  });

  test('no clock without setup: the metric requires the default install path to have run', () => {
    expect(computeFirstValue(emptyFirstValueRecord(), [nodeFixture]).timeToFirstOfficialAgentNodeMs).toBeNull();
  });

  test('record round-trips through disk and tolerates a missing/corrupt file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pd-c8-fv-'));
    try {
      const file = join(dir, 'harbor-first-value.json');
      expect(loadFirstValueRecord(file)).toEqual(emptyFirstValueRecord());
      const record = { setupCompletedAt: '2026-07-05T12:00:00.000Z', firstOfficialAgentNodeAt: null, timeToFirstOfficialAgentNodeMs: null };
      saveFirstValueRecord(record, file);
      expect(loadFirstValueRecord(file)).toEqual(record);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('formatDurationMs is human-honest across scales', () => {
    expect(formatDurationMs(420)).toBe('420ms');
    expect(formatDurationMs(6000)).toBe('6s');
    expect(formatDurationMs(90_000)).toBe('1m 30s');
    expect(formatDurationMs(3_720_000)).toBe('1h 2m');
  });
});

describe('rendering (beautiful-cli: every error surface is a next-action surface)', () => {
  test('issue lines carry glyph, sync posture, and the single repair as the next action', () => {
    const lines = renderRemediationCards(assessHarborReadiness(brokenFacts()));
    const joined = lines.join('\n');
    expect(joined).toMatch(/✗ .*\[CRITICAL\]/);
    expect(joined).toMatch(/⚠ /);
    expect(joined).toMatch(/local-only/);
    expect(joined).toMatch(/→ pd squid on/);
    // Every non-ok card contributed a "→" action line.
    const issueCount = assessHarborReadiness(brokenFacts()).filter((c) => c.repair).length;
    expect(lines.filter((l) => l.trimStart().startsWith('→')).length).toBe(issueCount);
  });
});
