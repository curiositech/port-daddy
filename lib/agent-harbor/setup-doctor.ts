/**
 * lib/agent-harbor/setup-doctor.ts — Work Order C8: Setup and doctor remediation.
 *
 * Binder ch18 ("Make the harness installable and repairable without command
 * walls") + F0 contract freeze (ADR-0095, schemas/agent-harbor/v0/).
 *
 * What this module is:
 *   The PURE core of the Agent Harbor readiness surface. Ten named areas —
 *   daemon, app, hooks, mcp, transcript-path, keychain, provider-keys,
 *   worktree-root, relay-pairing, stale-versions — each assessed from plain
 *   observed facts into a single RemediationCard. Every card that is not `ok`
 *   carries EXACTLY ONE repair (command + plain description + oneClick flag):
 *   the ch18 acceptance gate is "one doctor repair path per detected issue when
 *   possible", and a card with two competing commands is a command wall again.
 *
 * What it consumes (F0 v0 contracts, canonical field names only):
 *   - ComplianceProbeResult (pd.agent-harbor.compliance-probe-result.v0):
 *     `remediation[]` entries become cards; the witnessing invariant
 *     (compliance-invariants.mjs) is re-checked so a self-attested level
 *     surfaces as a CRITICAL card, never as silent trust.
 *   - AgentNode (pd.agent-harbor.agent-node.v0): the first-value metric —
 *     time to first OFFICIAL Agent Node — is computed from node records whose
 *     `officialMode === 'official'` and whose complianceLevel is probe-backed
 *     (complianceLevel > C0 requires a non-null complianceProbeId).
 *
 * Effects are injected: the CLI gathers facts (launchctl, fs, daemon HTTP) and
 * this module only judges them, so every branch is unit-testable — the same
 * separation `assessSupervisionIntegrity` uses in cli/commands/diagnostics.ts.
 *
 * Skill grafts applied (cited in the PR body):
 *   - macos-launchd-supervision: the daemon card leans on the EXTERNAL
 *     supervision-integrity precedent (PR #607) — KeepAlive cannot verify its
 *     own absence, so "daemon reachable" and "daemon supervised" are distinct.
 *   - daemon-development: three-tier severity, health-check-as-contract.
 *   - rust-app-distribution: one blessed install path (Homebrew tap), stale
 *     version drift as a first-class failure mode, no parallel npm-era copy.
 *   - beautiful-cli-design: every error surface is a next-action surface;
 *     semantic severities; machine-readable escape hatch left to the caller.
 *   - developer-surface-strategist: `pd setup` is THE default install surface;
 *     doctor cards are the CLI's repair contract, not a second install path.
 *   - checklist-discipline: ten killer items, not forty; DO-CONFIRM shape
 *     (the operator installed things; doctor confirms and names the one fix).
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PD_HOME } from '../../shared/paths.js';
import {
  SQUID_HOOK_METADATA,
  SQUID_HOOK_PRIVACY_NOTICE,
  type SquidProviderHookDiagnosis,
  type SquidHookPurpose,
} from '../squid/adapter.js';
import {
  checkProbeWitnessing,
  levelOrder,
} from '../../schemas/agent-harbor/v0/compliance-invariants.mjs';

// ─── The one blessed install path (ch18 gate: "one default install path") ───

/**
 * The single default install path. Everything in this module that tells a user
 * how to (re)install goes through `pd setup`, and the only from-zero
 * bootstrap copy is the Homebrew tap. There is deliberately NO npm-era
 * instruction anywhere in this file — ch18 gate: "no stale npm instructions".
 */
export const DEFAULT_INSTALL_COMMAND = 'brew install curiositech/tap/port-daddy';
export const DEFAULT_SETUP_COMMAND = 'pd setup';

// ─── Area registry ───────────────────────────────────────────────────────────

export type HarborAreaId =
  | 'daemon'
  | 'app'
  | 'hooks'
  | 'mcp'
  | 'transcript-path'
  | 'keychain'
  | 'provider-keys'
  | 'worktree-root'
  | 'relay-pairing'
  | 'stale-versions';

/**
 * Where an area's data lives, in words a user can act on (ch18 gate: "users
 * can see what is local, what syncs, and what is disabled").
 *   - 'local'    : lives on this machine only; nothing leaves it.
 *   - 'synced'   : an explicit opt-in cloud channel is active for this area.
 *   - 'disabled' : the area exists but is switched off / not paired.
 */
export type SyncState = 'local' | 'synced' | 'disabled';

export type CardStatus = 'ok' | 'missing' | 'disabled' | 'drifted' | 'stale' | 'error';
export type CardSeverity = 'ok' | 'warn' | 'critical';

export interface HarborArea {
  id: HarborAreaId;
  title: string;
  /** Plain-language answer to "what is this and why do I care?" */
  whatItIs: string;
  /** Honest default privacy posture for the area. */
  defaultSyncState: SyncState;
  /** The local-only vs cloud-sync status copy shown next to the card. */
  syncCopy: string;
}

export const HARBOR_AREAS: readonly HarborArea[] = [
  {
    id: 'daemon',
    title: 'Daemon',
    whatItIs: 'The Port Daddy daemon that witnesses every Agent Node. Nothing above C0 exists without it.',
    defaultSyncState: 'local',
    syncCopy: 'Local only. The daemon and its registry never leave this machine.',
  },
  {
    id: 'app',
    title: 'Operator app (FleetBar)',
    whatItIs: 'The menu-bar control surface: Control Center and the pd-console operator console.',
    defaultSyncState: 'local',
    syncCopy: 'Local only. The app reads daemon truth over loopback.',
  },
  {
    id: 'hooks',
    title: 'Agent lifecycle hooks',
    whatItIs: 'Named local hooks that brief agents pre-turn, gate risky edits, and record coordination facts.',
    defaultSyncState: 'local',
    syncCopy: 'Local only. Hooks read lifecycle JSON on this machine; transcripts are not retained or sent.',
  },
  {
    id: 'mcp',
    title: 'MCP wiring',
    whatItIs: 'The Port Daddy MCP server entry in each local agent runtime config (Claude, Codex, Gemini, ...).',
    defaultSyncState: 'local',
    syncCopy: 'Local only. MCP calls travel over loopback to the daemon.',
  },
  {
    id: 'transcript-path',
    title: 'Transcript path',
    whatItIs: 'Where transcript events are saved. Local transcripts are the default; absence of one is data, not emptiness.',
    defaultSyncState: 'local',
    syncCopy: 'Local by default. Cloud transcript sync is a separate, explicit opt-in that does not exist yet.',
  },
  {
    id: 'keychain',
    title: 'Keychain',
    whatItIs: 'OS keystore for daemon-held secrets (note-encryption master key, Harbor Card signing key).',
    defaultSyncState: 'local',
    syncCopy: 'Local OS keystore. Secrets are mediated by the OS, never written to plaintext when available.',
  },
  {
    id: 'provider-keys',
    title: 'Provider keys',
    whatItIs: 'Credentials for launchable model backends (claude, codex, cloud providers).',
    defaultSyncState: 'local',
    syncCopy: 'Local only. Keys stay in your environment/keychain; Port Daddy never uploads them.',
  },
  {
    id: 'worktree-root',
    title: 'Worktree root',
    whatItIs: 'The durable scratch root where agent worktrees are created (never /tmp — macOS purges it).',
    defaultSyncState: 'local',
    syncCopy: 'Local only. Worktrees are ordinary git checkouts on this machine.',
  },
  {
    id: 'relay-pairing',
    title: 'Relay pairing',
    whatItIs: 'Optional paired relay for remote visibility. Unpaired is a fully supported mode, not an error.',
    defaultSyncState: 'disabled',
    syncCopy: 'Synced ONLY when paired. Unpaired means nothing leaves this machine.',
  },
  {
    id: 'stale-versions',
    title: 'Version freshness',
    whatItIs: 'CLI, daemon, and release-feed versions agree; a stale daemon silently runs old contract code.',
    defaultSyncState: 'local',
    syncCopy: 'Local check. `pd upgrade` reads the public release feed; nothing is sent.',
  },
] as const;

export function harborArea(id: HarborAreaId): HarborArea {
  const area = HARBOR_AREAS.find((a) => a.id === id);
  if (!area) throw new Error(`unknown harbor area: ${id}`);
  return area;
}

// ─── Remediation cards ───────────────────────────────────────────────────────

export interface RemediationRepair {
  /** The one command that fixes this issue. Never two alternatives. */
  command: string;
  /** Plain-language description of what the repair does. */
  description: string;
  /** True when the repair is safe to run without further judgment. */
  oneClick: boolean;
}

export interface RemediationCard {
  area: HarborAreaId;
  title: string;
  status: CardStatus;
  severity: CardSeverity;
  detail: string;
  syncState: SyncState;
  /** Exactly one repair when status is not ok; absent when nothing to fix. */
  repair?: RemediationRepair;
}

function okCard(area: HarborAreaId, detail: string, syncState?: SyncState): RemediationCard {
  const a = harborArea(area);
  return { area, title: a.title, status: 'ok', severity: 'ok', detail, syncState: syncState ?? a.defaultSyncState };
}

function issueCard(
  area: HarborAreaId,
  status: Exclude<CardStatus, 'ok'>,
  severity: Exclude<CardSeverity, 'ok'>,
  detail: string,
  repair: RemediationRepair,
  syncState?: SyncState,
): RemediationCard {
  const a = harborArea(area);
  return { area, title: a.title, status, severity, detail, repair, syncState: syncState ?? a.defaultSyncState };
}

// ─── Facts (gathered by the CLI, judged here) ────────────────────────────────

export interface DaemonFacts {
  reachable: boolean;
  version?: string | null;
  /** From the external supervision-integrity check (PR #607 precedent). */
  supervised?: boolean | null;
  /**
   * The supervision assessment's own words when it is not ok — e.g. duplicate
   * supervisors racing the listener, or loaded-but-stopped. Passing these
   * through keeps the harbor card's ONE repair the RIGHT repair instead of
   * collapsing every non-ok state into "re-install the supervisor".
   */
  supervisionDetail?: string | null;
  supervisionRepair?: { command: string; description: string } | null;
}

export interface AppFacts {
  platform: NodeJS.Platform;
  fleetBarInstalled: boolean;
}

export interface McpFacts {
  configured: boolean;
  detail: string;
}

export interface TranscriptPathFacts {
  path: string;
  exists: boolean;
  writable: boolean;
}

export interface KeychainFacts {
  platform: NodeJS.Platform;
  available: boolean;
}

export interface ProviderKeyFact {
  backend: string;
  status: 'ready' | 'needs_setup' | 'manual_check' | 'unknown';
  launchableUnverified?: boolean;
  nextStep?: string;
}

export interface WorktreeRootFacts {
  path: string;
  exists: boolean;
  writable: boolean;
}

export interface RelayFacts {
  relayUrl: string | null;
  connected?: boolean | null;
}

export interface VersionFacts {
  cliVersion: string;
  daemonVersion: string | null;
  latestVersion?: string | null;
}

export interface HarborFacts {
  daemon: DaemonFacts;
  app: AppFacts;
  hooks: SquidProviderHookDiagnosis[];
  mcp: McpFacts;
  transcriptPath: TranscriptPathFacts;
  keychain: KeychainFacts;
  providerKeys: ProviderKeyFact[];
  worktreeRoot: WorktreeRootFacts;
  relay: RelayFacts;
  versions: VersionFacts;
}

/**
 * POSIX single-quote escaping for paths embedded in repair commands. Repair
 * commands are shown to humans and may be executed by a one-click surface
 * later — an unquoted path with spaces breaks, and an adversarial value
 * (e.g. via PORT_DADDY_WORKTREE_ROOT) would otherwise be an injection vector.
 * Single quotes are inert in POSIX shells (no $/backtick expansion).
 */
export function shellQuotePath(p: string): string {
  return `'${p.replace(/'/g, `'\\''`)}'`;
}

// ─── Per-area assessors (each returns exactly one card) ──────────────────────

export function assessDaemon(f: DaemonFacts): RemediationCard {
  if (!f.reachable) {
    return issueCard('daemon', 'missing', 'critical',
      'Daemon is not reachable — no Agent Node can be witnessed above C0 without it.',
      { command: DEFAULT_SETUP_COMMAND, description: 'Installs and starts the daemon under launchd supervision.', oneClick: true });
  }
  if (f.supervised === false) {
    // KeepAlive cannot verify its own absence (macos-launchd-supervision):
    // reachable-now but unsupervised means nothing resurrects it after a crash.
    // When the supervision-integrity assessment named the precise failure
    // (duplicate supervisors → bootout, loaded-but-stopped → kickstart), carry
    // its words and its repair verbatim so the one repair is the right one.
    return issueCard('daemon', 'drifted', 'warn',
      f.supervisionDetail
        ? `Daemon v${f.version ?? '?'} is reachable but supervision is unhealthy: ${f.supervisionDetail}.`
        : `Daemon v${f.version ?? '?'} is reachable but NOT supervised — it will not be resurrected if it dies.`,
      f.supervisionRepair
        ? { ...f.supervisionRepair, oneClick: false }
        : { command: 'port-daddy install', description: 'Re-installs the launchd supervisor for the running daemon.', oneClick: true });
  }
  return okCard('daemon', `Daemon v${f.version ?? '?'} reachable${f.supervised ? ' and supervised' : ''}.`);
}

export function assessApp(f: AppFacts): RemediationCard {
  if (f.platform !== 'darwin') {
    return okCard('app', `FleetBar is macOS-only; skipped on ${f.platform}.`);
  }
  if (!f.fleetBarInstalled) {
    return issueCard('app', 'missing', 'warn',
      'FleetBar app not installed — no menu-bar Control Center or pd-console entry point.',
      { command: DEFAULT_SETUP_COMMAND, description: 'Installs FleetBar as part of the default setup path.', oneClick: true });
  }
  return okCard('app', 'FleetBar installed (Control Center + pd-console entry points available).');
}

export function assessHooks(diagnoses: SquidProviderHookDiagnosis[]): RemediationCard {
  const broken = diagnoses.filter((d) => !d.ok);
  if (broken.length === 0) {
    return okCard('hooks',
      `${diagnoses.length} provider hook contract(s) installed with visible names and privacy metadata.`);
  }
  const names = broken.map((d) => d.providerName).join(', ');
  const status: CardStatus = broken.some((d) => /missing/i.test(d.detail)) ? 'missing' : 'drifted';
  return issueCard('hooks', status, 'warn',
    `${broken.length}/${diagnoses.length} provider hook contract(s) missing or stale (${names}). ` +
    'Hooks that vanish after launch drop the body to observed mode — the daemon will not overclaim governance.',
    { command: 'pd squid on', description: 'Stages the harness and wires daemon-gated hooks for every detected provider.', oneClick: true });
}

export function assessMcp(f: McpFacts): RemediationCard {
  if (f.configured) return okCard('mcp', f.detail);
  return issueCard('mcp', 'drifted', 'warn',
    `${f.detail} — agents in those runtimes cannot reach the daemon's tool surface.`,
    { command: 'pd mcp install', description: 'Writes the port-daddy MCP server entry into each detected agent runtime config.', oneClick: true });
}

export function assessTranscriptPath(f: TranscriptPathFacts): RemediationCard {
  if (f.exists && f.writable) {
    return okCard('transcript-path', `Transcript events save to ${f.path} (writable).`);
  }
  if (!f.exists) {
    // Transcript absence is data, not emptiness (binder ch18 shibboleth):
    // name the exact cause either way.
    if (f.writable) {
      return okCard('transcript-path',
        `No transcript store yet — it is created at ${f.path} on first daemon start.`);
    }
    return issueCard('transcript-path', 'missing', 'warn',
      `Transcript store ${f.path} does not exist and its directory is not writable — transcript events would be dropped.`,
      { command: DEFAULT_SETUP_COMMAND, description: 'Re-runs the default install path, which provisions a writable transcript store.', oneClick: true });
  }
  return issueCard('transcript-path', 'error', 'critical',
    `Transcript path ${f.path} exists but is not writable — new transcript events cannot be saved.`,
    { command: `chmod u+rw ${shellQuotePath(f.path)}`, description: 'Restores write permission on the transcript store.', oneClick: false });
}

export function assessKeychain(f: KeychainFacts): RemediationCard {
  if (f.available) {
    return okCard('keychain', 'OS keychain available — daemon secrets are keystore-mediated.');
  }
  if (f.platform === 'darwin') {
    return issueCard('keychain', 'error', 'warn',
      'macOS keychain not reachable (`/usr/bin/security` failed) — secrets fall back to on-disk files.',
      { command: 'pd doctor', description: 'Re-probes the keychain; if it stays unavailable, check Keychain Access login state.', oneClick: false });
  }
  return okCard('keychain',
    `OS keystore not supported on ${f.platform} yet — file fallback in use (a known, honest degradation).`);
}

export function assessProviderKeys(facts: ProviderKeyFact[]): RemediationCard {
  if (facts.length === 0) {
    return issueCard('provider-keys', 'missing', 'warn',
      'No model backends detected — nothing is launchable, so no Agent Node can do work.',
      { command: 'pd backend list', description: 'Shows every known backend and the exact credential/install step each one needs.', oneClick: false });
  }
  const launchable = facts.filter((f) => f.status === 'ready' || f.launchableUnverified);
  if (launchable.length > 0) {
    return okCard('provider-keys',
      `${launchable.length}/${facts.length} backend(s) launchable (${launchable.map((f) => f.backend).join(', ')}).`);
  }
  const first = facts.find((f) => f.nextStep);
  // WARN, not CRITICAL: zero launchable backends is an incomplete-setup state
  // (a fresh machine or bare CI runner before `claude`/`codex` exist), not a
  // broken Port Daddy installation. `pd doctor`'s exit code gates CI builds on
  // CRITICAL (scripts/ci-doctor-gate.sh), and a healthy daemon must not fail
  // that gate because no AI backend is installed yet. The card still names the
  // consequence and the one repair.
  return issueCard('provider-keys', 'missing', 'warn',
    `0/${facts.length} backends launchable — the fleet will arm but every spawn is policy-blocked.`,
    {
      command: first?.nextStep ?? 'pd backend list',
      description: 'Completes credential setup for the first blocked backend.',
      oneClick: false,
    });
}

export function assessWorktreeRoot(f: WorktreeRootFacts): RemediationCard {
  if (f.exists && f.writable) {
    return okCard('worktree-root', `Agent worktrees are created under ${f.path} (durable, not /tmp).`);
  }
  if (!f.exists) {
    return issueCard('worktree-root', 'missing', 'warn',
      `Worktree root ${f.path} does not exist — isolated agent spawns have nowhere durable to check out.`,
      { command: `mkdir -p ${shellQuotePath(f.path)}`, description: 'Creates the durable worktree root (macOS purges /tmp; this path survives).', oneClick: true });
  }
  return issueCard('worktree-root', 'error', 'critical',
    `Worktree root ${f.path} exists but is not writable — worktree spawns will fail.`,
    { command: `chmod u+rwx ${shellQuotePath(f.path)}`, description: 'Restores write permission on the worktree root.', oneClick: false });
}

export function assessRelayPairing(f: RelayFacts): RemediationCard {
  if (!f.relayUrl) {
    // Unpaired is a MODE, not a failure: local-only is the default posture.
    return okCard('relay-pairing',
      'Not paired — running local-only. Nothing leaves this machine. Pair later with: pd relay url <url>.',
      'disabled');
  }
  if (f.connected === false) {
    // Configured-but-disconnected is still a PAIRED posture: the operator has
    // opted this area into syncing, the channel is just down. Rendering it
    // 'disabled' would contradict the detail text and misstate where data goes.
    return issueCard('relay-pairing', 'drifted', 'warn',
      `Relay configured (${f.relayUrl}) but not connected — remote visibility is silently stale.`,
      { command: 'pd relay status', description: 'Shows the live relay connection state and the exact failure.', oneClick: false },
      'synced');
  }
  return okCard('relay-pairing', `Paired with ${f.relayUrl} — this area syncs.`, 'synced');
}

export function assessStaleVersions(f: VersionFacts): RemediationCard {
  if (f.daemonVersion && f.daemonVersion !== f.cliVersion) {
    return issueCard('stale-versions', 'stale', 'warn',
      `CLI v${f.cliVersion} but daemon v${f.daemonVersion} — the running daemon predates the code answering you.`,
      { command: 'port-daddy restart', description: 'Restarts the daemon so it picks up the installed version.', oneClick: true });
  }
  if (f.latestVersion && f.latestVersion !== f.cliVersion) {
    return issueCard('stale-versions', 'stale', 'warn',
      `Installed v${f.cliVersion}; latest release is v${f.latestVersion}.`,
      { command: 'pd upgrade --apply', description: 'Upgrades via the one blessed install path (Homebrew).', oneClick: true });
  }
  return okCard('stale-versions',
    f.daemonVersion
      ? `CLI and daemon agree at v${f.cliVersion}.`
      : `CLI v${f.cliVersion} (daemon not reachable to compare).`);
}

/** Assess all ten areas. Order is the registry order — stable for rendering. */
export function assessHarborReadiness(facts: HarborFacts): RemediationCard[] {
  return [
    assessDaemon(facts.daemon),
    assessApp(facts.app),
    assessHooks(facts.hooks),
    assessMcp(facts.mcp),
    assessTranscriptPath(facts.transcriptPath),
    assessKeychain(facts.keychain),
    assessProviderKeys(facts.providerKeys),
    assessWorktreeRoot(facts.worktreeRoot),
    assessRelayPairing(facts.relay),
    assessStaleVersions(facts.versions),
  ];
}

// ─── Transparent hook inventory (ch18 output: "transparent hook names") ──────

export interface HookInventoryEntry {
  hookBinary: string;
  displayName: string;
  description: string;
  privacy: string;
}

const HOOK_BINARY_FOR_PURPOSE: Record<SquidHookPurpose, string> = {
  prompt: 'pd-hook-prompt',
  preTool: 'pd-hook-pre-tool',
  postTool: 'pd-hook-post-tool',
  stop: 'pd-hook-stop',
  preCompact: 'pd-hook-precompact',
};

/**
 * The full inventory of hooks Port Daddy installs, with their user-facing
 * names, plain descriptions, and privacy notes — sourced from the SAME
 * metadata the installer writes into provider configs, so this list cannot
 * drift from what users actually see in their settings files.
 */
export function transparentHookInventory(): HookInventoryEntry[] {
  return (Object.keys(SQUID_HOOK_METADATA) as SquidHookPurpose[]).map((purpose) => {
    const meta = SQUID_HOOK_METADATA[purpose];
    return {
      hookBinary: HOOK_BINARY_FOR_PURPOSE[purpose],
      displayName: meta.displayName,
      description: meta.description,
      privacy: meta.privacy,
    };
  });
}

export { SQUID_HOOK_PRIVACY_NOTICE as HOOK_PRIVACY_NOTICE };

// ─── F0 contract consumption ─────────────────────────────────────────────────

export const COMPLIANCE_PROBE_RESULT_SCHEMA = 'pd.agent-harbor.compliance-probe-result.v0';
export const AGENT_NODE_SCHEMA = 'pd.agent-harbor.agent-node.v0';

export type ComplianceLadderLevel = 'C0' | 'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'C6';

/** Structural view of the frozen v0 ComplianceProbeResult (tolerant reader). */
export interface ComplianceProbeResultV0 {
  schema: typeof COMPLIANCE_PROBE_RESULT_SCHEMA;
  probeId: string;
  agentNodeId: string;
  bodyId?: string | null;
  adapterKind?: string;
  probedAt: string;
  complianceLevel: ComplianceLadderLevel;
  witnessedLevel: ComplianceLadderLevel;
  transcriptFidelity: string;
  checks: Array<{ name: string; passed: boolean; daemonWitnessed: boolean; level?: ComplianceLadderLevel | null; details?: string }>;
  negativeProbes: Array<{ kind: string; targetLevel?: ComplianceLadderLevel | null; present: boolean; fired?: boolean; downgraded?: boolean; observedLevel?: ComplianceLadderLevel | null; details?: string }>;
  failedChecks?: string[];
  remediation?: Array<{ issue: string; action?: string; oneClick?: boolean }>;
  downgrade?: { from?: ComplianceLadderLevel | null; to?: ComplianceLadderLevel | null; mode?: string | null; reason?: string };
  privacyImplications?: string[];
  [key: string]: unknown;
}

/** Structural view of the frozen v0 AgentNode (tolerant reader). */
export interface AgentNodeV0 {
  schema: typeof AGENT_NODE_SCHEMA;
  agentNodeId: string;
  identity: string;
  class: string;
  authority: string;
  complianceLevel: ComplianceLadderLevel;
  complianceProbeId?: string | null;
  transcriptFidelity?: string;
  officialMode?: string;
  status: string;
  createdAt: string;
  [key: string]: unknown;
}

/**
 * Turn a ComplianceProbeResult into remediation cards.
 *
 *  1. Every entry in `probe.remediation[]` becomes one card with one repair —
 *     the probe already knows the issue and the action; we surface it verbatim
 *     under the hooks area (probe remediation is adapter/hook wiring today).
 *  2. The witnessing invariant is re-checked (compliance-invariants.mjs). A
 *     probe whose granted level exceeds its witnessed evidence is a CRITICAL
 *     card: compliance is daemon-witnessed, never self-attested (ADR-0095 §8).
 *  3. An honest downgrade (downgrade.mode set) becomes an informational card so
 *     the operator sees WHY the node runs degraded and how to lift it.
 */
export function remediationCardsFromProbe(probe: ComplianceProbeResultV0): RemediationCard[] {
  if (probe.schema !== COMPLIANCE_PROBE_RESULT_SCHEMA) {
    throw new Error(`not a v0 ComplianceProbeResult: schema=${String(probe.schema)}`);
  }
  const cards: RemediationCard[] = [];

  const witnessing = checkProbeWitnessing(probe) as { valid: boolean; witnessedLevel: string; violations: string[] };
  if (!witnessing.valid) {
    cards.push(issueCard('daemon', 'drifted', 'critical',
      `Probe ${probe.probeId} for ${probe.agentNodeId} violates the witnessing invariant: ${witnessing.violations.join('; ')}`,
      { command: `pd agent probe ${probe.agentNodeId}`, description: 'Re-runs the daemon-witnessed compliance probe; the granted level must not exceed witnessed evidence.', oneClick: true }));
  }

  for (const entry of probe.remediation ?? []) {
    cards.push(issueCard('hooks', 'missing', 'warn',
      `${probe.agentNodeId}: ${entry.issue}`,
      {
        command: entry.action ?? 'pd setup',
        description: entry.action
          ? `Probe-suggested repair for ${probe.agentNodeId}.`
          : 'Re-runs the default setup path to restore the missing capability.',
        oneClick: entry.oneClick ?? false,
      }));
  }

  const dg = probe.downgrade;
  if (dg?.mode) {
    cards.push(issueCard('daemon', 'disabled', 'warn',
      `${probe.agentNodeId} runs in honest downgraded mode '${dg.mode}'` +
      (dg.from && dg.to ? ` (${dg.from} → ${dg.to})` : '') +
      (dg.reason ? `: ${dg.reason}` : ''),
      { command: `pd agent probe ${probe.agentNodeId}`, description: 'Re-probes after fixing the cause; the level lifts only when the daemon witnesses it.', oneClick: true }));
  }

  return cards;
}

// ─── First-value metric: time to first OFFICIAL Agent Node ──────────────────

export const FIRST_VALUE_FILE = join(PD_HOME, 'harbor-first-value.json');

export interface FirstValueRecord {
  /** ISO timestamp written by `pd setup` when the default install path completes. */
  setupCompletedAt: string | null;
  /** ISO createdAt of the first official Agent Node observed after setup. */
  firstOfficialAgentNodeAt: string | null;
  /** The metric: firstOfficialAgentNodeAt - setupCompletedAt, in ms. */
  timeToFirstOfficialAgentNodeMs: number | null;
}

export function emptyFirstValueRecord(): FirstValueRecord {
  return { setupCompletedAt: null, firstOfficialAgentNodeAt: null, timeToFirstOfficialAgentNodeMs: null };
}

export function loadFirstValueRecord(filePath: string = FIRST_VALUE_FILE): FirstValueRecord {
  try {
    if (!existsSync(filePath)) return emptyFirstValueRecord();
    const raw = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<FirstValueRecord>;
    return {
      setupCompletedAt: typeof raw.setupCompletedAt === 'string' ? raw.setupCompletedAt : null,
      firstOfficialAgentNodeAt: typeof raw.firstOfficialAgentNodeAt === 'string' ? raw.firstOfficialAgentNodeAt : null,
      timeToFirstOfficialAgentNodeMs: typeof raw.timeToFirstOfficialAgentNodeMs === 'number' ? raw.timeToFirstOfficialAgentNodeMs : null,
    };
  } catch {
    return emptyFirstValueRecord();
  }
}

export function saveFirstValueRecord(record: FirstValueRecord, filePath: string = FIRST_VALUE_FILE): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(record, null, 2) + '\n');
}

/**
 * An Agent Node counts as OFFICIAL for the first-value metric only when:
 *   - it is a v0 AgentNode record;
 *   - officialMode === 'official' (not observed / run-log / unmanaged);
 *   - its compliance level is probe-backed: any level above C0 must carry a
 *     non-null complianceProbeId (the F0 witnessing requirement — an unbacked
 *     level is self-report and does not count as value delivered).
 */
export function isOfficialAgentNode(node: AgentNodeV0): boolean {
  if (node.schema !== AGENT_NODE_SCHEMA) return false;
  if (node.officialMode !== 'official') return false;
  if ((levelOrder(node.complianceLevel) as number) > 0 && !node.complianceProbeId) return false;
  return true;
}

/** Earliest official node by createdAt, or null when none qualifies. */
export function firstOfficialAgentNode(nodes: AgentNodeV0[]): AgentNodeV0 | null {
  const official = nodes
    .filter(isOfficialAgentNode)
    .filter((n) => Number.isFinite(Date.parse(n.createdAt)));
  if (official.length === 0) return null;
  return official.reduce((a, b) => (Date.parse(a.createdAt) <= Date.parse(b.createdAt) ? a : b));
}

/**
 * Fold observed Agent Nodes into the first-value record. Idempotent: once the
 * metric is sealed it never changes (the FIRST official node is the metric).
 * Nodes created before setup completed do not count — the metric measures the
 * onboarding path, not pre-existing installs.
 */
export function computeFirstValue(record: FirstValueRecord, nodes: AgentNodeV0[]): FirstValueRecord {
  if (record.timeToFirstOfficialAgentNodeMs !== null) return record;
  if (!record.setupCompletedAt) return record;
  const setupAt = Date.parse(record.setupCompletedAt);
  if (!Number.isFinite(setupAt)) return record;

  const eligible = nodes.filter(
    (n) => isOfficialAgentNode(n) && Number.isFinite(Date.parse(n.createdAt)) && Date.parse(n.createdAt) >= setupAt,
  );
  const first = firstOfficialAgentNode(eligible);
  if (!first) return record;

  return {
    setupCompletedAt: record.setupCompletedAt,
    firstOfficialAgentNodeAt: first.createdAt,
    timeToFirstOfficialAgentNodeMs: Date.parse(first.createdAt) - setupAt,
  };
}

export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

// ─── Rendering (human output; the CLI owns JSON serialization) ──────────────

const STATUS_GLYPH: Record<CardSeverity, string> = { ok: '✓', warn: '⚠', critical: '✗' };
const SYNC_LABEL: Record<SyncState, string> = {
  local: 'local-only',
  synced: 'syncs (opt-in)',
  disabled: 'disabled',
};

/**
 * Render cards as plain lines: glyph, title, sync posture, detail, and — when
 * present — the single repair as the next action. No color codes here; the
 * caller decorates (and a piped `pd doctor --json` bypasses this entirely).
 */
export function renderRemediationCards(cards: RemediationCard[]): string[] {
  const lines: string[] = [];
  for (const card of cards) {
    const tag = card.severity === 'critical' ? ' [CRITICAL]' : card.severity === 'warn' ? ' [warn]' : '';
    lines.push(`${STATUS_GLYPH[card.severity]} ${card.title}${tag} (${SYNC_LABEL[card.syncState]}): ${card.detail}`);
    if (card.repair) {
      lines.push(`  → ${card.repair.command}   ${card.repair.description}${card.repair.oneClick ? ' (one-click safe)' : ''}`);
    }
  }
  return lines;
}
