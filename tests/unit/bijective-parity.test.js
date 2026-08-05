/**
 * Bijective Parity Tests for Port Daddy
 *
 * PURPOSE: Prevent worktree agent regressions where parallel agents silently
 * delete shell completions, strip dashboard CSS, or add CLI commands without
 * updating all distribution surfaces.
 *
 * These tests extract the source of truth from actual source code (not hardcoded
 * lists that go stale) and enforce TRUE bijective parity across surfaces.
 *
 * HISTORY: Parallel worktree agents caused regressions in v3.7:
 *   - Bash completions lost 139 lines (1190 vs 1329 baseline)
 *   - Zsh completions lost 129 lines (937 vs 1066 baseline)
 *   - Fish completions lost 26 lines (396 vs 422 baseline)
 *   - Dashboard glassmorphism CSS properties were stripped
 *   - CLI commands were added without matching completions
 *
 * These tests are designed to FAIL against the regressed codebase, proving
 * they would have caught the problem. Do NOT weaken them to make them pass.
 *
 * Run with: NODE_OPTIONS="--experimental-vm-modules" npx jest tests/unit/bijective-parity.test.js --no-coverage
 */

import { describe, test, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// Helpers: read source files once, share across tests
// ---------------------------------------------------------------------------

function readSource(relativePath) {
  return readFileSync(join(ROOT, relativePath), 'utf8');
}

// Cache source files so we don't re-read in every test
const CLI_SOURCE = readSource('bin/port-daddy-cli.ts');
const BASH_COMPLETIONS = readSource('completions/port-daddy.bash');
const ZSH_COMPLETIONS = readSource('completions/port-daddy.zsh');
const FISH_COMPLETIONS = readSource('completions/port-daddy.fish');
const ROUTES_INDEX = readSource('routes/index.ts');
const DASHBOARD_HTML = readSource('public/index.html');

// ---------------------------------------------------------------------------
// Extract CLI commands from the main switch statement in bin/port-daddy-cli.ts
// ---------------------------------------------------------------------------

/**
 * Parse the main switch statement (the one after `try {`) in the CLI entry point.
 * This is the authoritative list of commands the CLI handles.
 *
 * We look for case statements in the main dispatch switch (lines ~1383-1612),
 * NOT the direct-DB mode switch (lines ~615-1273).
 *
 * Strategy: find the ALL_COMMANDS array which is the CLI's own canonical list.
 */
function extractCLICommands() {
  // The ALL_COMMANDS array is the most reliable source -- it's what the CLI
  // uses for fuzzy "did you mean?" suggestions, so it MUST be complete.
  const allCmdsMatch = CLI_SOURCE.match(
    /const ALL_COMMANDS\s*(?::\s*string\[\])?\s*=\s*\[([\s\S]*?)\]/
  );
  if (!allCmdsMatch) {
    throw new Error('Could not find ALL_COMMANDS array in bin/port-daddy-cli.ts');
  }

  const commands = allCmdsMatch[1]
    .match(/'([^']+)'/g)
    .map(s => s.replace(/'/g, ''));

  return commands;
}

/**
 * Extract the canonical (non-alias) commands from ALL_COMMANDS.
 * Single-letter entries are aliases -- we filter them out for
 * completions checking since completions may list them separately.
 */
function extractCanonicalCommands() {
  const all = extractCLICommands();

  // Filter out: single-letter aliases, 'help' (not a real command dispatched
  // in switch), and 'ps'/'services' which are aliases for 'find'/'list'.
  // We keep all multi-character commands since completions must mention them.
  return all.filter(cmd => cmd.length > 1);
}

/**
 * Extract route module categories from routes/index.ts.
 * Each createXxxRoutes() call represents an API surface area.
 */
function extractRouteCategories() {
  // Match both Express (createXxxRoutes) and Fastify (xxxPlugin) patterns
  const expressMatches = [...ROUTES_INDEX.matchAll(/create(\w+)Routes/g)].map(m => m[1].toLowerCase());
  const fastifyMatches = [...ROUTES_INDEX.matchAll(/(\w+)Plugin/g)]
    .map(m => m[1].toLowerCase())
    .filter(name => name !== 'fastify'); // exclude FastifyPluginAsync type references
  const matches = expressMatches.length > 0 ? expressMatches : fastifyMatches;
  return [...new Set(matches)]; // deduplicate
}

// ---------------------------------------------------------------------------
// Test Group 1: CLI -> Completions Parity
// ---------------------------------------------------------------------------

describe('Test Group 1: CLI -> Completions Parity', () => {
  const canonicalCommands = extractCanonicalCommands();

  // These commands are internal/meta and don't need shell completions:
  // - 'help' is handled by --help flag, not a real dispatch target
  // - 'activity' is an alias for 'log' (some shells may omit it)
  // We still test them but with a softer list of known exclusions.
  const COMPLETION_EXCLUSIONS = new Set([
    // No exclusions -- every command in ALL_COMMANDS should have completions.
    // If this test fails, the completions need fixing, not this list.
  ]);

  const commandsToCheck = canonicalCommands.filter(
    cmd => !COMPLETION_EXCLUSIONS.has(cmd)
  );

  describe('Bash completions must include every CLI command', () => {
    test.each(commandsToCheck)(
      'bash completions include "%s"',
      (command) => {
        // Check if command appears in the bash commands array or as a case target
        const inCommandsArray = BASH_COMPLETIONS.includes(command);
        expect(inCommandsArray).toBe(true);
      }
    );
  });

  describe('Zsh completions must include every CLI command', () => {
    test.each(commandsToCheck)(
      'zsh completions include "%s"',
      (command) => {
        const inCompletions = ZSH_COMPLETIONS.includes(command);
        expect(inCompletions).toBe(true);
      }
    );
  });

  describe('Fish completions must include every CLI command', () => {
    test.each(commandsToCheck)(
      'fish completions include "%s"',
      (command) => {
        const inCompletions = FISH_COMPLETIONS.includes(command);
        expect(inCompletions).toBe(true);
      }
    );
  });

  test('ALL_COMMANDS array has at least 40 entries (sanity check)', () => {
    const all = extractCLICommands();
    expect(all.length).toBeGreaterThanOrEqual(40);
  });

  test('every case in main switch has a corresponding ALL_COMMANDS entry', () => {
    // Extract case labels from the main dispatch switch (after `try {`)
    // The main switch starts around "try { switch (command) {"
    const tryBlock = CLI_SOURCE.slice(CLI_SOURCE.indexOf('try {'));
    const caseMatches = tryBlock.matchAll(/case '([^']+)':/g);
    const switchCases = new Set([...caseMatches].map(m => m[1]));

    const allCommands = new Set(extractCLICommands());

    // Sub-commands of `session` that appear as nested case labels in the
    // session handler — these are NOT top-level commands and don't belong
    // in ALL_COMMANDS.  Same for 'services' (alias handled in the switch
    // but the canonical names 'ps'/'find'/'list' are in ALL_COMMANDS).
    const NESTED_SUBCOMMANDS = new Set([
      'end', 'abandon', 'rm', 'files',           // session sub-commands
      'create', 'enter', 'leave', 'show', 'destroy', 'delete',  // harbor sub-commands
    ]);

    // Every case in the switch should be in ALL_COMMANDS or be a known
    // nested sub-command
    const missing = [...switchCases].filter(
      c => !allCommands.has(c) && !NESTED_SUBCOMMANDS.has(c)
    );
    expect(missing).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Test Group 2: Completion Baseline Enforcement
// ---------------------------------------------------------------------------

describe('Test Group 2: Completion Baseline Enforcement', () => {
  /**
   * Count substantive lines: non-empty and non-comment.
   * This catches deletions that remove actual completion logic.
   */
  function countSubstantiveLines(content) {
    return content
      .split('\n')
      .filter(line => {
        const trimmed = line.trim();
        return trimmed.length > 0 && !trimmed.startsWith('#');
      })
      .length;
  }

  /**
   * Count total lines (including blanks and comments).
   * This catches wholesale file truncation.
   */
  function countTotalLines(content) {
    return content.split('\n').length;
  }

  // v3.7 baselines (total lines) -- these represent the CORRECT state.
  // Current regressed values are lower, so these tests SHOULD fail.
  const BASH_TOTAL_BASELINE = 1300;
  const ZSH_TOTAL_BASELINE = 1150;
  const FISH_TOTAL_BASELINE = 480;

  // v3.7 baselines (substantive lines) -- non-empty, non-comment
  const BASH_SUBSTANTIVE_BASELINE = 900;
  const ZSH_SUBSTANTIVE_BASELINE = 780;
  const FISH_SUBSTANTIVE_BASELINE = 300;

  test(`bash completions total lines >= ${BASH_TOTAL_BASELINE} (v3.7 baseline)`, () => {
    const lines = countTotalLines(BASH_COMPLETIONS);
    expect(lines).toBeGreaterThanOrEqual(BASH_TOTAL_BASELINE);
  });

  test(`zsh completions total lines >= ${ZSH_TOTAL_BASELINE} (v3.7 baseline)`, () => {
    const lines = countTotalLines(ZSH_COMPLETIONS);
    expect(lines).toBeGreaterThanOrEqual(ZSH_TOTAL_BASELINE);
  });

  test(`fish completions total lines >= ${FISH_TOTAL_BASELINE} (v3.7 baseline)`, () => {
    const lines = countTotalLines(FISH_COMPLETIONS);
    expect(lines).toBeGreaterThanOrEqual(FISH_TOTAL_BASELINE);
  });

  test(`bash completions substantive lines >= ${BASH_SUBSTANTIVE_BASELINE}`, () => {
    const lines = countSubstantiveLines(BASH_COMPLETIONS);
    expect(lines).toBeGreaterThanOrEqual(BASH_SUBSTANTIVE_BASELINE);
  });

  test(`zsh completions substantive lines >= ${ZSH_SUBSTANTIVE_BASELINE}`, () => {
    const lines = countSubstantiveLines(ZSH_COMPLETIONS);
    expect(lines).toBeGreaterThanOrEqual(ZSH_SUBSTANTIVE_BASELINE);
  });

  test(`fish completions substantive lines >= ${FISH_SUBSTANTIVE_BASELINE}`, () => {
    const lines = countSubstantiveLines(FISH_COMPLETIONS);
    expect(lines).toBeGreaterThanOrEqual(FISH_SUBSTANTIVE_BASELINE);
  });

  // Smoke test: each completion file should define completions for both
  // `port-daddy` and `pd` (the short alias).
  test('bash completions support both "port-daddy" and "pd" aliases', () => {
    expect(BASH_COMPLETIONS).toMatch(/port-daddy/);
    expect(BASH_COMPLETIONS).toMatch(/\bpd\b/);
  });

  test('zsh completions support both "port-daddy" and "pd" aliases', () => {
    expect(ZSH_COMPLETIONS).toMatch(/port-daddy/);
    expect(ZSH_COMPLETIONS).toMatch(/\bpd\b/);
  });

  test('fish completions support both "port-daddy" and "pd" aliases', () => {
    expect(FISH_COMPLETIONS).toMatch(/port-daddy/);
    expect(FISH_COMPLETIONS).toMatch(/\bpd\b/);
  });
});

// ---------------------------------------------------------------------------
// Test Group 3: API -> CLI Parity
// ---------------------------------------------------------------------------

describe('Test Group 3: API -> CLI Parity', () => {
  const routeCategories = extractRouteCategories();
  const cliCommands = new Set(extractCLICommands());

  // Map from route module category to expected CLI command(s).
  // Each API area should have at least one CLI entry point.
  const ROUTE_TO_CLI_MAP = {
    services: ['claim', 'release', 'find', 'list', 'url', 'env'],
    messaging: ['pub', 'sub', 'channels'],
    locks: ['lock', 'unlock', 'locks'],
    agents: ['agent', 'agents'],
    // agentroster: live aggregate over agents/sessions/claims.
    // CLI surface is `pd agents --live` / `pd agents --roster`.
    agentroster: ['agents'],
    actors: ['actor', 'actors'],
    // agentcockpit: "Watch + Grab the Wheel" SSE stream + soft interrupt
    // (routes/agent-cockpit.ts, agentCockpitPlugin). CLI surface is
    // `pd agent stream <id>` + `pd agent interrupt <id> [--reason]`.
    agentcockpit: ['agent'],
    // agentharbor: Agent Harbor read API (routes/agent-harbor.ts) — the binder
    // ch09 endpoint family over the C1 event-ledger projections. CLI surface
    // is `pd harbor-ledger ...` (append/read/verify/project/status), the C1
    // verb that drives the same ledger + projections these routes serve.
    agentharbor: ['harbor-ledger'],
    health: ['health'],
    activity: ['log', 'activity'],
    webhooks: ['webhook'],
    config: ['config'],
    projects: ['scan', 'projects'],
    sessions: ['session', 'sessions', 'note', 'notes'],
    info: ['version', 'status', 'metrics', 'config'],
    resurrection: ['salvage', 'resurrection'],
    changelog: ['changelog'],
    tunnel: ['tunnel'],
    dns: ['dns'],
    briefing: ['briefing'],
    sugar: ['begin', 'done', 'whoami'],
    attention: ['attention'],
    suggestions: ['nudge'],
    sitrep: ['sitrep'],
    advisor: ['advise', 'preflight', 'compass'],
    launch: ['hints'],
    // arbiter and pheromone are API-only (no CLI commands) — excluded from parity check
    attest: ['attest'],
    spawn: ['spawn', 'spawned'],
    fleet: ['fleet'],
    // fleethitlproposals: ship-submitted idea packets become operator
    // approve/reject decisions in FleetBar/pd-console; `pd fleet` remains the
    // CLI umbrella rather than adding a routine human-approval CLI flow.
    fleethitlproposals: ['fleet'],
    harbors: ['harbor', 'harbors'],
    whois: ['whois'],
    orchestrator: ['up', 'down'],
    tuples: ['tuple'],
    cockpit: ['cockpit'],
    graph: ['graph'],
    // booty: artifact harvest provenance over the blob store (slice S4a).
    // routes/booty.ts (POST/GET /booty); `pd booty <add|list>` is its CLI surface.
    booty: ['booty'],
    memory: ['memory'],
    cartographer: ['roadmap'],
    roadmap: ['roadmap'],
    commitments: ['commit', 'obligations'],
    secrets: ['secret', 'secrets'],
    quorum: ['quorum'],
    parley: ['parley'],
    feedback: ['feedback'],
    bonds: ['bond'],
    wallets: ['wallet'],
    panic: ['fleet'],
    budget: ['wallet'],
    shipwright: ['shipwright'],
    setup: ['setup'],
    cockpit: ['cockpit'],
    // popper: autonomous roadmap-to-dispatch task puller. routes/popper.ts is
    // registered in routes/index.ts (popperPlugin), so it shows up as a route
    // category; `pd popper <status|next|pop|enable|disable>` is its CLI surface.
    popper: ['popper'],
    // harbormaster: serialized merge-owner actor status API. `pd harbormaster`
    // and `pd hm` are the CLI surfaces for status, queue, start, and stop.
    harbormaster: ['harbormaster', 'hm'],
    // transcripts: ship-run records surface. routes/transcripts.ts is the
    // operator-facing read/delete API; `pd transcripts <list|show|cost|delete>`
    // is its CLI surface.
    transcripts: ['transcripts', 'transcript'],
    // dispatches: HTTP surface over the dispatch queue (POST /dispatches +
    // accept/reject/cancel). `pd dispatch` and the nightshift/review/morning
    // commands drive it from the CLI.
    dispatches: ['dispatch', 'nightshift', 'review', 'morning'],
    // relay: daemon-side cloud-relay management (ADR-0049). routes/relay.ts is
    // now registered in routes/index.ts (relayPlugin) — it was previously
    // shipped-dead (never registered), which is why this category did not
    // appear here before. `pd relay <url|status|exchange>` is its CLI surface.
    relay: ['relay'],
    // safe: host-safety posture audit (ADR-0088). routes/safe.ts (safePlugin)
    // exposes the read-only GET /safe/scan; `pd safe <scan|baseline|fix|corral|guard>`
    // is its CLI surface.
    safe: ['safe'],
    // fleetapprovals: trust-gate spawn approvals (ADR-0093 L2). CLI surface is
    // `pd fleet approvals` / `pd fleet approve <id>` / `pd fleet reject <id>`.
    fleetapprovals: ['fleet'],
    // fleetpush: Web Push registration for approval alerts. CLI surface is
    // `pd fleet push <status|test>`.
    fleetpush: ['fleet'],
    // durableagentroster: manage durable named AgentNode experts. routes/durable-agent-roster.ts
    // (GET /durable-agents, etc.); `pd roster <subcommand>` is its CLI surface.
    durableagentroster: ['roster'],
  };

  // API-only routes that have no CLI equivalent (accessed via curl or SDK).
  // githubwebhook: inbound GitHub webhook receiver (POST /webhooks/github),
  // driven by the receiver Worker / GitHub, not by a `pd` command — API-only by
  // design. See routes/github-webhook.ts.
  // context: agent context-window health + task ledger (ADR-0048 P1/P3) — MCP+HTTP only, no pd CLI command.
  // harvest: session note→episode promotion (ADR-0048 P2/P3) — MCP+HTTP only.
  // custodian: knowledge custodian status + approval resolution (ADR-0048 P3) — MCP+HTTP only.
  // cloudapptelemetry: inbound GitHub App / Cloudflare Worker telemetry ingestion + read API;
  // surfaced through fleet/agents/observability reporting, not a dedicated `pd` command.
  // sorties: legacy HTTP record compatibility for old spawned-run rows; new CLI launch is `pd spawn`.
  // galaxy: session-galaxy embedding map (GET /galaxy/map + /galaxy/session/:id, routes/galaxy.ts).
  // A visualization surface consumed by fleet-ui, pd-console, and the FleetBar webview —
  // a 2-D scatter of MiniLM/t-SNE points is not terminal-shaped, so no `pd galaxy` CLI by design.
  // (relay is NOT API-only: it has the `pd relay` CLI, mapped in ROUTE_TO_CLI_MAP above.)
  // fleetwebhooks: inbound fleet webhook receiver (POST /webhooks/fleet/:channel),
  // driven by external senders / the email-ingress Worker, never by a `pd`
  // command — API-only by design. See routes/fleet-webhooks.ts.
  const API_ONLY_ROUTES = new Set(['arbiter', 'pheromone', 'mergequeue', 'symbols', 'observability', 'metricsprom', 'operator', 'semantic', 'resources', 'usage', 'testhooks', 'blob', 'githubwebhook', 'context', 'harvest', 'custodian', 'cloudapptelemetry', 'visualtasks', 'sorties', 'galaxy', 'fleetwebhooks']);

  test('all route modules have at least one corresponding CLI command', () => {
    const missingCoverage = [];

    for (const category of routeCategories) {
      if (API_ONLY_ROUTES.has(category)) continue;
      const expectedCliCommands = ROUTE_TO_CLI_MAP[category];
      if (!expectedCliCommands) {
        missingCoverage.push(`Route category "${category}" has no CLI mapping defined`);
        continue;
      }

      const hasAnyCli = expectedCliCommands.some(cmd => cliCommands.has(cmd));
      if (!hasAnyCli) {
        missingCoverage.push(
          `Route category "${category}" expects CLI commands [${expectedCliCommands.join(', ')}] but none found`
        );
      }
    }

    expect(missingCoverage).toEqual([]);
  });

  test('route module count matches expectations (detects new untracked modules)', () => {
    // If someone adds a new route module, this test forces them to add CLI parity.
    // Current count: 17 route modules (services, messaging, locks, agents, health,
    // activity, webhooks, config, projects, sessions, info, resurrection, changelog,
    // tunnel, dns, briefing, sugar)
    expect(routeCategories.length).toBeGreaterThanOrEqual(17);
  });

  test.each(Object.entries(ROUTE_TO_CLI_MAP))(
    'route module "%s" has CLI coverage via %j',
    (category, expectedCommands) => {
      const hasAnyCli = expectedCommands.some(cmd => cliCommands.has(cmd));
      expect(hasAnyCli).toBe(true);
    }
  );

  test('every ROUTE_TO_CLI_MAP category corresponds to an actual route module', () => {
    const routeSet = new Set(routeCategories);
    const orphanedMappings = Object.keys(ROUTE_TO_CLI_MAP).filter(
      cat => !routeSet.has(cat)
    );
    expect(orphanedMappings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Test Group 4: Root Landing Page (dashboard retired)
//
// Surface consolidation (2026-07): the browser dashboard at `/` was retired
// in favor of the native surfaces (FleetBar Control Center, pd-console, and
// the `pd dashboard` terminal UI). The root page is now a minimal pointer.
// These tests enforce that it STAYS minimal and keeps pointing operators at
// the sanctioned surfaces — the inverse of the old visual-richness checks.
// ---------------------------------------------------------------------------

describe('Test Group 4: Root Landing Page (dashboard retired)', () => {
  test('landing page declares the web dashboard retired', () => {
    expect(DASHBOARD_HTML).toMatch(/retired/i);
  });

  test('landing page points to Control Center, Operator Console, and CLI', () => {
    expect(DASHBOARD_HTML).toMatch(/Control Center/);
    expect(DASHBOARD_HTML).toMatch(/Operator Console|pd-console/);
    expect(DASHBOARD_HTML).toMatch(/pd dashboard/);
  });

  test('landing page fetches only /health', () => {
    const fetched = [...DASHBOARD_HTML.matchAll(/fetch\(['"`]([^'"`]+)/g)].map(m => m[1]);
    expect(fetched).toEqual(['/health']);
  });

  test('landing page has no dashboard panels or embedded terminal', () => {
    expect(DASHBOARD_HTML).not.toMatch(/id="panel-/);
    expect(DASHBOARD_HTML).not.toMatch(/showPanel/);
    expect(DASHBOARD_HTML).not.toMatch(/var COMMANDS/);
  });

  test('landing page stays under 20KB (prevents the dashboard growing back)', () => {
    const sizeKB = Buffer.byteLength(DASHBOARD_HTML, 'utf8') / 1024;
    expect(sizeKB).toBeLessThanOrEqual(20);
  });

  test('landing page body text respects the 14px minimum font floor', () => {
    // Parse every declared font-size and enforce the floor NUMERICALLY:
    // px >= 14, rem/em >= 0.875 (1rem = 16px). The old regex denylist only
    // banned a couple of `0.x`rem prefixes and let `13px` and `0.87rem`
    // (13.9px) straight through — parse values, don't pattern-match them.
    const decls = [...DASHBOARD_HTML.matchAll(/font-size:\s*([\d.]+)(px|rem|em)\b/g)]
      .map(m => ({ raw: m[0], value: Number(m[1]), unit: m[2] }));
    expect(decls.length).toBeGreaterThan(0); // the page does declare sizes
    const violations = decls
      .map(d => ({ ...d, px: d.unit === 'px' ? d.value : d.value * 16 }))
      .filter(d => d.px < 14)
      .map(d => `${d.raw} (= ${d.px.toFixed(1)}px)`);
    expect(violations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Test Group 6: Cross-Surface Consistency Sanity Checks
// ---------------------------------------------------------------------------

describe('Test Group 6: Cross-Surface Consistency', () => {
  test('bash and zsh completions have same set of top-level commands', () => {
    // Extract command names from bash's local commands=(...) array
    // The array is between `local commands=(` and the closing `)` on its own line
    const bashBlock = BASH_COMPLETIONS.match(
      /local commands=\(\n([\s\S]*?)\n\s*\)/
    );
    expect(bashBlock).not.toBeNull();
    const bashCmds = bashBlock[1]
      .replace(/#[^\n]*/g, '') // strip comments
      .split(/\s+/)
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .sort();

    // Extract command names from zsh's commands=(...) array
    // Zsh uses 'command:description' format
    const zshBlock = ZSH_COMPLETIONS.match(
      /\bcommands=\(\n([\s\S]*?)\n\s*\)/
    );
    expect(zshBlock).not.toBeNull();
    const zshCmds = [];
    for (const line of zshBlock[1].split('\n')) {
      const m = line.match(/^\s*'([^':]+):/);
      if (m) zshCmds.push(m[1]);
    }
    zshCmds.sort();

    // Both should have the same commands
    const bashSet = new Set(bashCmds);
    const zshSet = new Set(zshCmds);

    const onlyInBash = bashCmds.filter(c => !zshSet.has(c));
    const onlyInZsh = zshCmds.filter(c => !bashSet.has(c));

    expect(onlyInBash).toEqual([]);
    expect(onlyInZsh).toEqual([]);
  });

  test('fish completions register all commands from the CLI', () => {
    // Fish uses `set -l __pd_commands` to list all commands
    const fishCmdsMatch = FISH_COMPLETIONS.match(
      /set -l __pd_commands\s*\\\s*([\s\S]*?)(?:\n\n|\n[^'\s])/
    );
    expect(fishCmdsMatch).not.toBeNull();

    const fishCmds = fishCmdsMatch[1]
      .match(/'([^']+)'/g)
      .map(s => s.replace(/'/g, ''))
      .sort();

    const cliCommands = extractCLICommands().sort();

    // Fish should have at least all the CLI commands
    const fishSet = new Set(fishCmds);
    const missingInFish = cliCommands.filter(cmd => !fishSet.has(cmd));

    expect(missingInFish).toEqual([]);
  });

  test('completion files have consistent subcommand handling for "session"', () => {
    // session subcommands: start, end, done, abandon, rm, files
    const sessionSubcmds = ['start', 'end', 'done', 'abandon', 'rm', 'files'];

    for (const subcmd of sessionSubcmds) {
      expect(BASH_COMPLETIONS).toContain(subcmd);
      expect(ZSH_COMPLETIONS).toContain(subcmd);
      expect(FISH_COMPLETIONS).toContain(subcmd);
    }
  });

  test('completion files have consistent subcommand handling for "agent"', () => {
    // agent subcommands: register, heartbeat, unregister
    const agentSubcmds = ['register', 'heartbeat', 'unregister'];

    for (const subcmd of agentSubcmds) {
      expect(BASH_COMPLETIONS).toContain(subcmd);
      expect(ZSH_COMPLETIONS).toContain(subcmd);
      expect(FISH_COMPLETIONS).toContain(subcmd);
    }
  });

  test('completion files handle --json and --quiet global flags', () => {
    // Bash and zsh use --json/--quiet directly
    for (const flag of ['--json', '--quiet']) {
      expect(BASH_COMPLETIONS).toContain(flag);
      expect(ZSH_COMPLETIONS).toContain(flag);
    }
    // Fish uses -l (long flag) syntax: `-l json` and `-l quiet`
    expect(FISH_COMPLETIONS).toMatch(/-l json/);
    expect(FISH_COMPLETIONS).toMatch(/-l quiet/);
  });
});
