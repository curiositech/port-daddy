/**
 * Permission Tiers — registry & wiring tests
 *
 * Invariants this enforces:
 *
 *  1. Every CLI command source file under cli/commands/ corresponds to at
 *     least one entry in TIER_REGISTRY or SUBCOMMAND_TIERS. New commands
 *     can't be added without tier classification.
 *  2. TIER_REGISTRY values are constrained to the four legal tiers.
 *  3. Every command listed in DESTRUCTIVE_COMMANDS lives in a source file
 *     that imports requireConfirmation from cli/utils/destructive-confirm.ts.
 *     (Verifies the helper is at least wired into the right module.)
 *  4. resolveTier() returns the right tier for the headline cases the audit
 *     was set up to catch — especially `pd salvage claim`.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const {
  TIER_REGISTRY,
  SUBCOMMAND_TIERS,
  ALL_TIERS,
  DESTRUCTIVE_COMMANDS,
  resolveTier,
  tierBadge,
  commandsByTier,
  TIER_LEGEND,
} = await import('../../cli/permission-tiers.js');

const COMMANDS_DIR = join(ROOT, 'cli', 'commands');

/**
 * Map command-file slug -> set of top-level CLI verbs we EXPECT the registry
 * to classify. We don't require 1:1 ; some files (e.g. resurrection.ts) only
 * implement subcommands under `pd salvage`. The expectation is that for each
 * source file in cli/commands/ that exports a handleX, at least one verb
 * tied to that handler appears in TIER_REGISTRY.
 *
 * Slug-to-verbs mapping below covers the non-obvious cases. Verbs that
 * literally equal the file slug are inferred automatically and need no
 * entry here.
 */
const SLUG_VERB_OVERRIDES = {
  resurrection: ['salvage', 'resurrection'],
  berths: ['dev', 'use'], // ADR-0084: pd dev up/down/list + pd use targeting
  daemon: ['start', 'stop', 'restart', 'install', 'uninstall', 'daemon', 'dev'],
  diagnostics: ['ports', 'health', 'metrics', 'config', 'dashboard', 'doctor', 'diagnose', 'status', 'version', 'hints'],
  services: ['claim', 'release', 'find', 'url', 'env', 'ports'],
  locks: ['lock', 'unlock', 'locks'],
  messaging: ['pub', 'publish', 'sub', 'subscribe', 'listen', 'channels', 'wait', 'broadcast'],
  sessions: ['session', 'sessions', 'note', 'notes'],
  agents: ['agent', 'agents', 'swarm'],
  actors: ['actor', 'actors'],
  changelog: ['changelog'],
  inbox: ['inbox'],
  tunnel: ['tunnel'],
  activity: ['log', 'activity'],
  webhooks: ['webhook', 'webhooks'],
  projects: ['scan', 'projects', 'p'],
  orchestration: ['up', 'down'],
  briefing: ['briefing', 'history'],
  integration: ['integration'],
  sugar: ['begin', 'done', 'whoami', 'with-lock'],
  spawn: ['spawn', 'spawned', 'watch'],
  harbors: ['harbor', 'harbors'],
  bench: ['bench'],
  'hooks-install': ['hooks'],
  demo: ['demo'],
  tuples: ['tuple'],
  setup: ['setup', 'init'],
  semantic: ['graph', 'memory', 'semantic'],
  ideas: ['ideas'],
  roadmap: ['roadmap'],
  quorum: ['quorum'],
  feedback: ['feedback'],
  sitrep: ['sitrep'],
  pheromone: ['pheromone', 'ph'],
  say: ['say'],
  look: ['look'],
  wallet: ['wallet'],
  bond: ['bond'],
  advisor: ['advise', 'preflight', 'compass'],
  guard: ['guard'],
  add: ['add'],
  snapshots: ['snapshots', 'snapshot'],
  shipwright: ['shipwright'],
  cockpit: ['cockpit'],
  tutorial: ['tutorial', 'learn'],
  fleet: ['fleet'],
  tube: ['tube'],
  dns: ['dns'],
  'mcp-install': ['mcp'],
};

function commandSourceFiles() {
  return readdirSync(COMMANDS_DIR)
    .filter((f) => f.endsWith('.ts'))
    .filter((f) => f !== 'index.ts');
}

describe('TIER_REGISTRY: structure', () => {
  test('every value is a legal tier', () => {
    for (const [cmd, tier] of Object.entries(TIER_REGISTRY)) {
      expect(ALL_TIERS).toContain(tier);
      expect(typeof cmd).toBe('string');
      expect(cmd.length).toBeGreaterThan(0);
    }
  });

  test('every SUBCOMMAND_TIERS value is a legal tier', () => {
    for (const [, tier] of Object.entries(SUBCOMMAND_TIERS)) {
      expect(ALL_TIERS).toContain(tier);
    }
  });

  test('SUBCOMMAND_TIERS keys are either bare-command overrides or multi-token forms', () => {
    // Bare-command keys (no space) are allowed for top-level verbs whose
    // "no subcommand" form is safer than the worst-case TIER_REGISTRY
    // classification (e.g. `pd salvage` with no args is just listing).
    // Multi-token keys ("command subcommand" or "command --flag") are the
    // common case.
    for (const k of Object.keys(SUBCOMMAND_TIERS)) {
      const tokens = k.split(' ');
      expect(tokens.length).toBeGreaterThanOrEqual(1);
      expect(tokens.length).toBeLessThanOrEqual(3);
    }
  });

  test('ALL_TIERS contains exactly the four tiers', () => {
    expect([...ALL_TIERS].sort()).toEqual(['approval', 'destructive', 'notify', 'silent']);
  });

  test('tierBadge renders bracket-wrapped tier label', () => {
    expect(tierBadge('silent')).toBe('[silent]');
    expect(tierBadge('destructive')).toBe('[destructive]');
  });

  test('TIER_LEGEND mentions every tier name', () => {
    for (const tier of ALL_TIERS) {
      expect(TIER_LEGEND).toContain(`[${tier}]`);
    }
  });
});

describe('TIER_REGISTRY: coverage', () => {
  test('every cli/commands/*.ts source file has at least one classified verb', () => {
    const unclassified = [];
    for (const file of commandSourceFiles()) {
      const slug = file.replace(/\.ts$/, '');
      const expectedVerbs = SLUG_VERB_OVERRIDES[slug] ?? [slug];

      const haveAny = expectedVerbs.some(
        (verb) => TIER_REGISTRY[verb] || Object.keys(SUBCOMMAND_TIERS).some((k) => k.startsWith(`${verb} `))
      );
      if (!haveAny) unclassified.push({ file, expectedVerbs });
    }
    expect(unclassified).toEqual([]);
  });
});

describe('resolveTier', () => {
  test('headline bug: pd salvage claim is destructive', () => {
    expect(resolveTier('salvage', ['claim', 'agent-99'])).toBe('destructive');
  });

  test('pd salvage (bare list) is silent', () => {
    expect(resolveTier('salvage', [])).toBe('silent');
    expect(resolveTier('salvage', ['triage'])).toBe('silent');
    expect(resolveTier('salvage', ['next'])).toBe('silent');
  });

  test('pd salvage dismiss/abandon/complete are destructive', () => {
    expect(resolveTier('salvage', ['dismiss', 'a'])).toBe('destructive');
    expect(resolveTier('salvage', ['abandon', 'a'])).toBe('destructive');
    expect(resolveTier('salvage', ['complete', 'a', 'b'])).toBe('destructive');
  });

  test('pd release without --expired is notify; --expired is destructive', () => {
    expect(resolveTier('release', ['myapp:api'])).toBe('notify');
    expect(resolveTier('release', [], ['expired'])).toBe('destructive');
    expect(resolveTier('release', [], ['--expired'])).toBe('destructive');
  });

  test('pd unlock vs unlock --force', () => {
    expect(resolveTier('unlock', ['db-migrations'])).toBe('notify');
    expect(resolveTier('unlock', ['db-migrations'], ['force'])).toBe('destructive');
  });

  test('pd ports cleanup is destructive; bare pd ports is silent', () => {
    expect(resolveTier('ports', [])).toBe('silent');
    expect(resolveTier('ports', ['cleanup'])).toBe('destructive');
  });

  // pd suggest: only `approve` fires a ship run (it spends and spawns, the
  // dispatch posture). Bare `pd suggest` IS the listing — a read-only default
  // must never inherit the group's worst case and prompt like it is dangerous.
  test('pd suggest approve is approval; bare pd suggest (list) is silent', () => {
    expect(resolveTier('suggest', [])).toBe('silent');
    expect(resolveTier('suggest', ['list'])).toBe('silent');
    expect(resolveTier('suggest', ['dismiss', 'sug-1'])).toBe('notify');
    expect(resolveTier('suggest', ['approve', 'sug-1'])).toBe('approval');
  });

  // pd seamanship (alias pd skills): sync/index rewrite the on-disk catalog
  // under ~/.port-daddy/skills; the read verbs mutate nothing, including
  // `outcomes`, which GETs from the daemon but changes no state.
  test('pd seamanship sync/index are notify; the read verbs are silent', () => {
    expect(resolveTier('seamanship', [])).toBe('silent');
    expect(resolveTier('seamanship', ['search', 'rust'])).toBe('silent');
    expect(resolveTier('seamanship', ['outcomes'])).toBe('silent');
    expect(resolveTier('seamanship', ['sync'])).toBe('notify');
    expect(resolveTier('seamanship', ['index'])).toBe('notify');
  });

  // The alias dispatches to the same handler (bin/port-daddy-cli.ts:
  // `case 'seamanship': case 'skills':`), so it must never resolve to a
  // different prompt than the verb it aliases.
  test('pd skills resolves identically to pd seamanship at every subcommand', () => {
    for (const args of [[], ['list'], ['search', 'x'], ['show', 'y'], ['outcomes'], ['sync'], ['index']]) {
      expect(resolveTier('skills', args)).toBe(resolveTier('seamanship', args));
    }
  });

  test('pd agent inbox clear is destructive', () => {
    expect(resolveTier('agent', ['inbox', 'clear'])).toBe('destructive');
    expect(resolveTier('agent', ['inbox', 'list'])).toBe('silent');
    expect(resolveTier('agent', ['unregister'])).toBe('destructive');
    expect(resolveTier('agent', ['register'])).toBe('notify');
  });

  test('pd guard install / enable / disable are destructive', () => {
    expect(resolveTier('guard', ['install'])).toBe('destructive');
    expect(resolveTier('guard', ['enable'])).toBe('destructive');
    expect(resolveTier('guard', ['disable'])).toBe('destructive');
    expect(resolveTier('guard', ['status'])).toBe('silent');
    expect(resolveTier('guard', ['check'])).toBe('silent');
  });

  test('pd fleet down / panic are destructive; up is approval', () => {
    expect(resolveTier('fleet', ['down'])).toBe('destructive');
    expect(resolveTier('fleet', ['panic'])).toBe('destructive');
    expect(resolveTier('fleet', ['up'])).toBe('approval');
    expect(resolveTier('fleet', ['status'])).toBe('silent');
  });

  test('pd spawn cancel is destructive; bare spawn is approval', () => {
    expect(resolveTier('spawn', ['cancel', 'a'])).toBe('destructive');
    expect(resolveTier('spawn', [])).toBe('approval');
  });

  test('pd harbor destroy is destructive', () => {
    expect(resolveTier('harbor', ['destroy', 'x'])).toBe('destructive');
    expect(resolveTier('harbor', ['delete', 'x'])).toBe('destructive');
    expect(resolveTier('harbor', ['create', 'x'])).toBe('notify');
    expect(resolveTier('harbor', ['show', 'x'])).toBe('silent');
  });

  test('pd channels clear is destructive', () => {
    expect(resolveTier('channels', ['clear', 'x'])).toBe('destructive');
    expect(resolveTier('channels', ['discover'])).toBe('silent');
  });

  test('pd dns cleanup is destructive', () => {
    expect(resolveTier('dns', ['cleanup'])).toBe('destructive');
    expect(resolveTier('dns', ['list'])).toBe('silent');
  });

  test('pd session continuation launches work while archival session actions remain scoped', () => {
    expect(resolveTier('session', ['abandon'])).toBe('destructive');
    expect(resolveTier('session', ['continue'])).toBe('approval');
    expect(resolveTier('session', ['rm'])).toBe('notify');
    expect(resolveTier('session', ['start'])).toBe('notify');
    expect(resolveTier('session', ['end'])).toBe('notify');
    expect(resolveTier('session', ['files', 'add'])).toBe('notify');
  });

  test('daemon stop/restart/uninstall are destructive', () => {
    expect(resolveTier('daemon', ['stop'])).toBe('destructive');
    expect(resolveTier('daemon', ['restart'])).toBe('destructive');
    expect(resolveTier('daemon', ['uninstall'])).toBe('destructive');
    expect(resolveTier('daemon', ['start'])).toBe('notify');
    expect(resolveTier('daemon', ['list'])).toBe('silent');
  });

  test('pd attention default marks items read; peek/list forms are silent', () => {
    expect(resolveTier('attention', [])).toBe('notify');
    expect(resolveTier('attention', [], ['peek'])).toBe('silent');
    expect(resolveTier('attention', [], ['subscriptions'])).toBe('silent');
    expect(resolveTier('attention', [], ['subscribe'])).toBe('notify');
    expect(resolveTier('attention', [], ['unsubscribe'])).toBe('notify');
  });

  test('pd batten verify is read-only while imprint reports its local write', () => {
    expect(resolveTier('batten', [])).toBe('notify');
    expect(resolveTier('batten', ['verify'])).toBe('silent');
    expect(resolveTier('batten', ['imprint'])).toBe('notify');
  });

  test('unmapped command falls back to silent (read-friendly default)', () => {
    expect(resolveTier('this-command-does-not-exist', [])).toBe('silent');
  });

  test('pd down (top-level) is destructive', () => {
    expect(resolveTier('down', [])).toBe('destructive');
    expect(resolveTier('d', [])).toBe('destructive');
  });
});

describe('commandsByTier', () => {
  test('returns a key for every tier', () => {
    const buckets = commandsByTier();
    for (const tier of ALL_TIERS) {
      expect(buckets[tier]).toBeDefined();
      expect(Array.isArray(buckets[tier])).toBe(true);
    }
  });

  test('destructive bucket contains the headline commands', () => {
    const buckets = commandsByTier();
    const destSet = new Set(buckets.destructive);
    for (const cmd of [
      'salvage claim',
      'salvage dismiss',
      'session abandon',
      'ports cleanup',
      'channels clear',
      'agent unregister',
      'harbor destroy',
      'spawn cancel',
      'fleet down',
      'guard install',
      'daemon stop',
    ]) {
      expect(destSet.has(cmd)).toBe(true);
    }
  });
});

describe('DESTRUCTIVE_COMMANDS: handler wiring', () => {
  /**
   * For each destructive command we declared, verify the source file that
   * owns its handler imports requireConfirmation. This catches the "added a
   * new destructive command but forgot to gate it" regression.
   *
   * Map command -> source file(s) that should contain the import. A command
   * that lives in multiple files lists all of them; ANY hit counts.
   */
  const COMMAND_FILES = {
    'salvage claim': ['cli/commands/resurrection.ts'],
    'salvage complete': ['cli/commands/resurrection.ts'],
    'salvage abandon': ['cli/commands/resurrection.ts'],
    'salvage dismiss': ['cli/commands/resurrection.ts'],
    'session abandon': ['cli/commands/sessions.ts'],
    'release --expired': ['cli/commands/services.ts'],
    'unlock --force': ['cli/commands/locks.ts'],
    'ports cleanup': ['cli/commands/services.ts'],
    'projects rm': ['cli/commands/projects.ts'],
    'channels clear': ['cli/commands/messaging.ts'],
    'dns cleanup': ['cli/commands/dns.ts'],
    'agent unregister': ['cli/commands/agents.ts'],
    'agent inbox clear': ['cli/commands/agents.ts'],
    'harbor destroy': ['cli/commands/harbors.ts'],
    'spawn cancel': ['cli/commands/spawn.ts'],
    'fleet down': ['cli/commands/fleet.ts'],
    'fleet panic': ['cli/commands/fleet.ts'],
    'guard install': ['cli/commands/guard.ts'],
    'guard install-shim': ['cli/commands/guard.ts'],
    'guard uninstall-shim': ['cli/commands/guard.ts'],
    'guard enable': ['cli/commands/guard.ts'],
    'guard disable': ['cli/commands/guard.ts'],
    'dev stop': ['bin/port-daddy-cli.ts'],
    'daemon stop': ['cli/commands/daemon.ts'],
    'daemon restart': ['cli/commands/daemon.ts'],
    'daemon uninstall': ['cli/commands/daemon.ts'],
    restart: ['cli/commands/daemon.ts'],
    stop: ['cli/commands/daemon.ts'],
    uninstall: ['cli/commands/daemon.ts'],
    down: ['cli/commands/orchestration.ts'],
  };

  test.each(Object.entries(COMMAND_FILES))(
    '%s: at least one owning file imports requireConfirmation',
    (cmd, files) => {
      const hits = files.filter((rel) => {
        const path = join(ROOT, rel);
        const src = readFileSync(path, 'utf8');
        return /from\s+['"][^'"]*destructive-confirm(\.js)?['"]/.test(src)
          && /requireConfirmation/.test(src);
      });
      expect(hits.length).toBeGreaterThan(0);
    }
  );

  test('every entry in DESTRUCTIVE_COMMANDS is covered by COMMAND_FILES OR ends with a known top-level alias', () => {
    const covered = new Set(Object.keys(COMMAND_FILES));
    const missing = DESTRUCTIVE_COMMANDS.filter((cmd) => !covered.has(cmd));
    // Allow top-level aliases that map to a covered command (e.g. "stop" is
    // an alias for "daemon stop"). Anything else is a hole.
    const TOP_LEVEL_ALIASES = new Set(['stop', 'restart', 'uninstall', 'down']);
    const reallyMissing = missing.filter((cmd) => !TOP_LEVEL_ALIASES.has(cmd));
    expect(reallyMissing).toEqual([]);
  });
});
