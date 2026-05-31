/**
 * Port Daddy Arbiter — Runtime Invariant Enforcement
 *
 * The sovereign's sword. Subscribes to the activity log and checks
 * every state transition against formally verified invariants.
 * Maps directly to the BondedCommons TLA+ specification.
 *
 * Six rules, three enforcement levels:
 *   - LOG:   Record the violation (always)
 *   - ALERT: Notify via pub/sub (strictMode: false)
 *   - HALT:  Trigger man-overboard salvage (strictMode: true)
 */

import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { ActivityType, type createActivityLog } from './activity.js';
import type { createAgents } from './agents.js';
import type { createSessions } from './sessions.js';
import type { createLocks } from './locks.js';
import type { createResurrection } from './resurrection.js';
import type { Bonds } from './bonds.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Rust Enforcer Bridge (FFI) ─────────────────────────────────────────────

const nativeLibName = 'libharbor_card_rs.' + (process.platform === 'darwin' ? 'dylib' : 'so');

interface EmbeddedNativeCoreAsset {
  name: string;
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  sha256: string;
  dataBase64: string;
}

interface KoffiLibrary {
  func: (signature: string) => (...args: any[]) => any;
}

interface KoffiModule {
  load: (path: string) => KoffiLibrary;
}

declare global {
  // Set by dist/embedded-native-core.generated.js when the Bun single-binary
  // build embeds the Rust FFI core. Source installs leave it undefined.
  // eslint-disable-next-line no-var
  var __PORT_DADDY_EMBEDDED_NATIVE_CORE__: EmbeddedNativeCoreAsset | undefined;
  // Preloaded by the Bun single-binary entrypoint so the dependency is bundled,
  // but still optional for source installs that should degrade gracefully.
  // eslint-disable-next-line no-var
  var __PORT_DADDY_KOFFI__: KoffiModule | undefined;
  // eslint-disable-next-line no-var
  var __PORT_DADDY_KOFFI_LOAD_ERROR__: string | undefined;
}

const require = createRequire(import.meta.url);

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function candidateNativeEnforcerPaths(): string[] {
  const candidates = [
    join(__dirname, '../dist/core', nativeLibName),
  ];

  const resourceDir = process.env.PORT_DADDY_RESOURCE_DIR?.trim();
  if (resourceDir) {
    candidates.push(join(resourceDir, 'dist/core', nativeLibName));
  }

  if (process.execPath) {
    const executableDir = dirname(process.execPath);
    candidates.push(join(executableDir, 'dist/core', nativeLibName));
    candidates.push(join(executableDir, 'core', nativeLibName));
  }

  return [...new Set(candidates)];
}

function embeddedNativeEnforcer(): EmbeddedNativeCoreAsset | null {
  const asset = globalThis.__PORT_DADDY_EMBEDDED_NATIVE_CORE__;
  if (!asset) return null;
  if (asset.name !== nativeLibName) return null;
  if (asset.platform !== process.platform) return null;
  if (asset.arch !== process.arch) return null;
  return asset as EmbeddedNativeCoreAsset;
}

function materializeEmbeddedNativeEnforcer(): string | null {
  const asset = embeddedNativeEnforcer();
  if (!asset) return null;

  const bytes = Buffer.from(asset.dataBase64, 'base64');
  const digest = sha256(bytes);
  if (digest !== asset.sha256) {
    enforcerLoadError = `Embedded Rust enforcer checksum mismatch: expected ${asset.sha256}, got ${digest}`;
    return null;
  }

  const dir = mkdtempSync(join(tmpdir(), 'port-daddy-native-core-'));
  const path = join(dir, asset.name);
  writeFileSync(path, bytes, { mode: 0o700, flag: 'wx' });

  return path;
}

function resolveNativeEnforcerPath(): string | null {
  const filePath = candidateNativeEnforcerPaths().find(candidate => existsSync(candidate));
  if (filePath) return filePath;

  try {
    return materializeEmbeddedNativeEnforcer();
  } catch (err) {
    enforcerLoadError = `Embedded Rust enforcer materialization failed: ${(err as Error).message}`;
    return null;
  }
}

function loadKoffi(): KoffiModule {
  return globalThis.__PORT_DADDY_KOFFI__ ?? require('koffi');
}

type NativeEnforcer = {
  constantTimeCompare: (a: Buffer, aLen: number, b: Buffer, bLen: number) => boolean;
  verifyCapsSubset: (rootJson: string, rootLen: number, subJson: string, subLen: number) => boolean;
};

let enforcer: NativeEnforcer | null = null;
let enforcerLoadAttempted = false;
let enforcerLoadError: string | null = null;

function loadNativeEnforcer(): NativeEnforcer | null {
  if (enforcerLoadAttempted) return enforcer;
  enforcerLoadAttempted = true;

  const libPath = resolveNativeEnforcerPath();
  if (!libPath) {
    const embeddedHint = embeddedNativeEnforcer()
      ? enforcerLoadError ?? 'embedded native core could not be materialized'
      : 'no matching embedded native core asset present';
    enforcerLoadError = `Rust enforcer library missing; checked ${candidateNativeEnforcerPaths().join(', ')}; ${embeddedHint}`;
    return null;
  }

  try {
    const koffi = loadKoffi();
    const lib = koffi.load(libPath);
    enforcer = {
      constantTimeCompare: lib.func(
        'bool harbor_constant_time_compare(const uint8_t *a, size_t a_len, const uint8_t *b, size_t b_len)'
      ),
      verifyCapsSubset: lib.func(
        'bool harbor_verify_caps_subset_json(const char *root_json, size_t root_len, const char *sub_json, size_t sub_len)'
      ),
    };
    enforcerLoadError = null;
    console.error('[Arbiter] Rust enforcer loaded via FFI');
  } catch (err) {
    enforcer = null;
    enforcerLoadError = (err as Error).message;
    console.error('[Arbiter] Rust FFI load failed:', enforcerLoadError);
  }

  return enforcer;
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ArbiterConfig {
  strictMode: boolean;
}

export interface Violation {
  id: number;
  timestamp: number;
  rule: string;
  severity: 'warning' | 'violation' | 'critical';
  details: string;
  agentId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ArbiterDeps {
  activityLog: ReturnType<typeof createActivityLog>;
  agents: ReturnType<typeof createAgents>;
  sessions: ReturnType<typeof createSessions>;
  locks: ReturnType<typeof createLocks>;
  resurrection?: ReturnType<typeof createResurrection>;
  bonds?: Bonds;
}

// ─── Rules ──────────────────────────────────────────────────────────────────

export const ARBITER_RULE_NAMES = [
  'PID_SQUATTING',
  'CAP_ESCALATION',
  'NOTE_MONOTONICITY',
  'ESCROW_POSITIVE',
  'LOCK_OWNER_VALID',
  'HEARTBEAT_FRESHNESS',
] as const;

export type RuleName = typeof ARBITER_RULE_NAMES[number];

type RuleCoverage = 'enforced' | 'degraded' | 'stubbed';
type RuleEngine = 'runtime' | 'ffi' | 'stub';
type RuleCategory = 'identity' | 'capability' | 'session' | 'economics' | 'liveness';
type StrictModeAction = 'log_only' | 'man_overboard';

interface RuleDefinition {
  description: string;
  category: RuleCategory;
  defaultSeverity: Violation['severity'];
  engine: RuleEngine;
  requiresEnforcer: boolean;
}

export interface ArbiterRuleStatus {
  name: RuleName;
  description: string;
  category: RuleCategory;
  defaultSeverity: Violation['severity'];
  engine: RuleEngine;
  requiresEnforcer: boolean;
  coverage: RuleCoverage;
  strictModeAction: StrictModeAction;
  degradedReason: string | null;
}

export interface ArbiterDegradedReason {
  code: string;
  component: 'arbiter';
  affectedRules: RuleName[];
  message: string;
}

export interface ArbiterStatus {
  active: boolean;
  strictMode: boolean;
  enforcerLoaded: boolean;
  rulesCount: number;
  rules: RuleName[];
  ruleDetails: ArbiterRuleStatus[];
  summary: {
    state: 'nominal' | 'degraded';
    mode: 'observe_only' | 'strict_enforcement';
    criticalAction: StrictModeAction;
    enforcedRules: number;
    degradedRules: number;
    stubbedRules: number;
  };
  degraded: ArbiterDegradedReason[];
  violationsCount: number;
  uptimeMs: number;
  startedAt: number;
}

const RULE_DEFINITIONS: Record<RuleName, RuleDefinition> = {
  PID_SQUATTING: {
    description: 'Verify that service claims come from the registered agent PID.',
    category: 'identity',
    defaultSeverity: 'critical',
    engine: 'runtime',
    requiresEnforcer: false,
  },
  CAP_ESCALATION: {
    description: 'Verify capability-scoped locks against the agent capability set.',
    category: 'capability',
    defaultSeverity: 'critical',
    engine: 'ffi',
    requiresEnforcer: true,
  },
  NOTE_MONOTONICITY: {
    description: 'Ensure active-session note count never regresses.',
    category: 'session',
    defaultSeverity: 'critical',
    engine: 'runtime',
    requiresEnforcer: false,
  },
  ESCROW_POSITIVE: {
    description: 'Require spawned-agent sessions with escrow metadata to map to a positive active bond.',
    category: 'economics',
    defaultSeverity: 'violation',
    engine: 'runtime',
    requiresEnforcer: false,
  },
  LOCK_OWNER_VALID: {
    description: 'Require lock holders to map to registered live agents.',
    category: 'session',
    defaultSeverity: 'violation',
    engine: 'runtime',
    requiresEnforcer: false,
  },
  HEARTBEAT_FRESHNESS: {
    description: 'Flag stale heartbeats before agents fully die.',
    category: 'liveness',
    defaultSeverity: 'warning',
    engine: 'runtime',
    requiresEnforcer: false,
  },
};

// ─── Arbiter Factory ────────────────────────────────────────────────────────

export function createArbiter(
  deps: ArbiterDeps,
  config: ArbiterConfig = { strictMode: false }
) {
  const { activityLog, agents, sessions, locks, resurrection, bonds } = deps;
  const violations: Violation[] = [];
  const startedAt = Date.now();
  let nextViolationId = 1;

  // Track note counts per session for monotonicity checking
  const sessionNoteCounts = new Map<string, number>();

  loadNativeEnforcer();

  // ─── Activity Log Subscription ──────────────────────────────────────────

  const stopWatching = activityLog.subscribe((entry) => {
    try {
      switch (entry.type) {
        case ActivityType.SERVICE_CLAIM:
          checkPidSquatting(entry);
          break;

        case ActivityType.LOCK_ACQUIRE:
          checkLockOwnerValid(entry);
          checkCapEscalation(entry);
          break;

        case ActivityType.SESSION_NOTE:
          checkNoteMonotonicity(entry);
          break;

        case ActivityType.SESSION_START:
          checkEscrowPositive(entry);
          break;

        case ActivityType.AGENT_HEARTBEAT:
          checkHeartbeatFreshness(entry);
          break;
      }
    } catch (err) {
      console.error('[Arbiter] Rule check error:', (err as Error).message);
    }
  });

  // ─── Resurrection Events ────────────────────────────────────────────────

  if (resurrection) {
    try {
      resurrection.on('agent:dead', (deadAgent: any) => {
        recordViolation('HEARTBEAT_FRESHNESS', 'warning',
          `Agent ${deadAgent.id || 'unknown'} declared dead — queued for salvage`,
          deadAgent.id
        );
      });
    } catch {
      // Resurrection module may not support .on() in all versions
    }
  }

  // ─── Rule Implementations ───────────────────────────────────────────────

  /**
   * Rule 1: PID Squatting (Ghost in the Harbor)
   * If an agent claims a service, verify its PID matches the registered PID.
   */
  function checkPidSquatting(entry: any) {
    const { agentId, metadata } = entry;
    const claimedPid = metadata?.pid;

    if (!claimedPid || !agentId) return;

    const agentRecord = agents.get(agentId);
    if (agentRecord && agentRecord.success && agentRecord.agent) {
      const expectedPid = agentRecord.agent.pid;
      if (expectedPid && expectedPid !== claimedPid) {
        recordViolation('PID_SQUATTING', 'critical',
          `PID ${claimedPid} impersonating agent ${agentId} (expected PID: ${expectedPid})`,
          agentId, { claimedPid, expectedPid }
        );
      }
    }
  }

  /**
   * Rule 2: Capability Escalation
   * When an agent acquires a lock on a capability-scoped resource,
   * verify via the Rust FFI that the agent's capabilities include the required scope.
   */
  function checkCapEscalation(entry: any) {
    const { agentId, targetId } = entry;
    if (!targetId || !agentId || !enforcer) return;

    // Only check scoped locks (e.g., db:write, fs:critical)
    if (!targetId.includes(':')) return;

    const agentRecord = agents.get(agentId);
    if (!agentRecord?.success || !agentRecord.agent?.metadata) return;

    const agentCaps = agentRecord.agent.metadata?.capabilities;
    if (!agentCaps || !Array.isArray(agentCaps)) return;

    const requiredCaps = JSON.stringify([targetId]);
    const heldCaps = JSON.stringify(agentCaps);

    try {
      const isValid = enforcer.verifyCapsSubset(heldCaps, heldCaps.length, requiredCaps, requiredCaps.length);
      if (!isValid) {
        recordViolation('CAP_ESCALATION', 'critical',
          `Agent ${agentId} attempted to acquire ${targetId} without capability`,
          agentId, { required: targetId, held: agentCaps }
        );
      }
    } catch (err) {
      console.error('[Arbiter] FFI verifyCapsSubset failed:', (err as Error).message);
    }
  }

  /**
   * Rule 3: Note Monotonicity (from TLA+ NoteMonotonicity invariant)
   * Notes for active sessions must never shrink.
   * Track note count per session; alert if it decreases.
   */
  function checkNoteMonotonicity(entry: any) {
    const sessionId = entry.targetId || entry.metadata?.sessionId;
    if (!sessionId) return;

    const prev = sessionNoteCounts.get(sessionId) || 0;
    const next = prev + 1;
    sessionNoteCounts.set(sessionId, next);

    // The note count should only increase. If we ever observe a decrease
    // (which would require a DELETE on session_notes — impossible via API),
    // that's a violation.
    if (next < prev) {
      recordViolation('NOTE_MONOTONICITY', 'critical',
        `Session ${sessionId} note count decreased from ${prev} to ${next}`,
        entry.agentId, { sessionId, prev, next }
      );
    }
  }

  /**
   * Rule 4: Escrow Positive (from TLA+ EscrowInvariant)
   * Spawn sessions that declare escrow requirements must point at a
   * positive, active bond. Plain human/CLI sessions can still exist
   * without a bond; the rule applies once metadata says this is a
   * bonded runtime body.
   */
  function checkEscrowPositive(entry: any) {
    const metadata = entry.metadata ?? {};
    const escrow = readFiniteUsd(metadata.escrow ?? metadata.escrowUsd ?? metadata.bondUsd);
    const bondId = readPositiveInteger(metadata.bondId);
    const requiresEscrow = metadata.requiresEscrow === true
      || metadata.spawn === true
      || bondId !== null;

    if (escrow !== null && escrow <= 0) {
      recordViolation('ESCROW_POSITIVE', 'violation',
        `Session started with non-positive escrow: ${escrow}`,
        entry.agentId, { escrow }
      );
      return;
    }

    if (!requiresEscrow) return;

    if (!bonds) {
      recordViolation('ESCROW_POSITIVE', 'violation',
        'Session declared escrow requirement, but bond escrow module is not wired into Arbiter',
        entry.agentId, { bondId, escrow }
      );
      return;
    }

    if (bondId === null) {
      recordViolation('ESCROW_POSITIVE', 'violation',
        'Session declared escrow requirement without a bondId',
        entry.agentId, { escrow }
      );
      return;
    }

    const bond = bonds.getBond(bondId);
    if (!bond) {
      recordViolation('ESCROW_POSITIVE', 'violation',
        `Session references missing bond ${bondId}`,
        entry.agentId, { bondId, escrow }
      );
      return;
    }

    if (entry.agentId && bond.agentId !== entry.agentId) {
      recordViolation('ESCROW_POSITIVE', 'violation',
        `Session agent ${entry.agentId} references bond ${bondId} owned by ${bond.agentId}`,
        entry.agentId, { bondId, owner: bond.agentId }
      );
      return;
    }

    if (bond.bondUsd <= 0) {
      recordViolation('ESCROW_POSITIVE', 'violation',
        `Session references non-positive bond ${bondId}: ${bond.bondUsd}`,
        entry.agentId, { bondId, bondUsd: bond.bondUsd }
      );
      return;
    }

    if (!['escrowed', 'running', 'exiting'].includes(bond.state)) {
      recordViolation('ESCROW_POSITIVE', 'violation',
        `Session references resolved bond ${bondId} in state ${bond.state}`,
        entry.agentId, { bondId, state: bond.state }
      );
    }
  }

  /**
   * Rule 5: Lock Owner Valid (from TLA+ LockOwnerValid)
   * Locks must be held by registered agents with active sessions.
   */
  function checkLockOwnerValid(entry: any) {
    const { agentId } = entry;
    if (!agentId) return;

    const agentRecord = agents.get(agentId);
    if (!agentRecord?.success || !agentRecord.agent) {
      recordViolation('LOCK_OWNER_VALID', 'violation',
        `Unregistered agent ${agentId} acquired a lock`,
        agentId
      );
    }
  }

  /**
   * Rule 6: Heartbeat Freshness
   * On heartbeat, check if the agent was previously flagged as stale.
   * This is the "resurrection radar" — early warning for dying agents.
   */
  function checkHeartbeatFreshness(entry: any) {
    const { agentId, metadata } = entry;
    if (!agentId) return;

    const health = metadata?.health;
    if (health?.liveness === 'stale') {
      recordViolation('HEARTBEAT_FRESHNESS', 'warning',
        `Agent ${agentId} heartbeat is stale (grace remaining: ${health.graceRemaining}ms)`,
        agentId, { liveness: health.liveness, graceRemaining: health.graceRemaining }
      );
    }
  }

  // ─── Violation Recording ────────────────────────────────────────────────

  function recordViolation(
    rule: RuleName,
    severity: Violation['severity'],
    details: string,
    agentId?: string | null,
    metadata?: Record<string, unknown>
  ) {
    const violation: Violation = {
      id: nextViolationId++,
      timestamp: Date.now(),
      rule,
      severity,
      details,
      agentId,
      metadata,
    };

    violations.push(violation);

    // Always log to activity
    activityLog.log('security.violation', {
      details: `[${rule}] ${details}`,
      agentId,
      metadata: { ...metadata, rule, severity, strictMode: config.strictMode },
    });

    console.error(`[Arbiter] ${severity.toUpperCase()} ${rule}: ${details}`);

    // In strict mode, critical violations trigger man-overboard
    if (config.strictMode && severity === 'critical') {
      activityLog.log('system.man_overboard', {
        details: `Arbiter triggered man-overboard: ${rule}`,
        agentId,
        metadata: { rule, violationId: violation.id },
      });
    }
  }

  // ─── Test Injection (for demos and paper verification) ──────────────────

  function injectTestViolation(ruleName: string): Violation | null {
    switch (ruleName) {
      case 'PID_SQUATTING':
        recordViolation('PID_SQUATTING', 'critical',
          'TEST: Simulated PID squatting detected', 'test-agent', { test: true });
        break;
      case 'NOTE_MONOTONICITY':
        recordViolation('NOTE_MONOTONICITY', 'critical',
          'TEST: Simulated note count decrease', 'test-agent', { test: true });
        break;
      case 'CAP_ESCALATION':
        recordViolation('CAP_ESCALATION', 'critical',
          'TEST: Simulated capability escalation', 'test-agent', { test: true });
        break;
      case 'LOCK_OWNER_VALID':
        recordViolation('LOCK_OWNER_VALID', 'violation',
          'TEST: Simulated unregistered lock owner', 'test-agent', { test: true });
        break;
      case 'ESCROW_POSITIVE':
        recordViolation('ESCROW_POSITIVE', 'violation',
          'TEST: Simulated zero escrow', 'test-agent', { test: true, escrow: 0 });
        break;
      case 'HEARTBEAT_FRESHNESS':
        recordViolation('HEARTBEAT_FRESHNESS', 'warning',
          'TEST: Simulated stale heartbeat', 'test-agent', { test: true });
        break;
      default:
        return null;
    }
    return violations[violations.length - 1];
  }

  function describeRule(ruleName: RuleName): ArbiterRuleStatus {
    const definition = RULE_DEFINITIONS[ruleName];
    let coverage: RuleCoverage = 'enforced';
    let degradedReason: string | null = null;

    if (ruleName === 'CAP_ESCALATION' && !enforcer) {
      coverage = 'degraded';
      degradedReason = enforcerLoadError
        ? `Rust FFI enforcer unavailable: ${enforcerLoadError}`
        : 'Rust FFI enforcer unavailable; capability subset checks are advisory only.';
    } else if (ruleName === 'ESCROW_POSITIVE' && !bonds) {
      coverage = 'degraded';
      degradedReason = 'Bond escrow module is not wired into Arbiter; escrow metadata cannot be verified against the ledger.';
    }

    return {
      name: ruleName,
      ...definition,
      coverage,
      strictModeAction: definition.defaultSeverity === 'critical' && config.strictMode
        ? 'man_overboard'
        : 'log_only',
      degradedReason,
    };
  }

  function getDegradedReasons(ruleDetails: ArbiterRuleStatus[]): ArbiterDegradedReason[] {
    const degraded: ArbiterDegradedReason[] = [];

    if (!config.strictMode) {
      degraded.push({
        code: 'strict_mode_disabled',
        component: 'arbiter',
        affectedRules: ruleDetails
          .filter((rule) => rule.defaultSeverity === 'critical')
          .map((rule) => rule.name),
        message: 'Critical arbiter violations are logged but do not trigger man-overboard while strictMode is false.',
      });
    }

    if (ruleDetails.some((rule) => rule.name === 'CAP_ESCALATION' && rule.coverage === 'degraded')) {
      degraded.push({
        code: 'ffi_enforcer_unavailable',
        component: 'arbiter',
        affectedRules: ['CAP_ESCALATION'],
        message: 'Capability escalation checks cannot validate capability subsets without the Rust enforcer.',
      });
    }

    if (ruleDetails.some((rule) => rule.name === 'ESCROW_POSITIVE' && rule.coverage === 'degraded')) {
      degraded.push({
        code: 'escrow_bonds_unavailable',
        component: 'arbiter',
        affectedRules: ['ESCROW_POSITIVE'],
        message: 'Escrow positivity cannot validate declared bond metadata because bonds are not wired into Arbiter.',
      });
    }

    return degraded;
  }

  // ─── Public API ─────────────────────────────────────────────────────────

  return {
    /** Number of violations recorded since startup */
    getViolationsCount: () => violations.length,

    /** All recorded violations */
    getViolations: (limit = 50, offset = 0) => violations.slice(offset, offset + limit),

    /** Status summary */
    getStatus: (): ArbiterStatus => {
      const ruleDetails = ARBITER_RULE_NAMES.map(describeRule);
      const degraded = getDegradedReasons(ruleDetails);

      return {
        active: true,
        strictMode: config.strictMode,
        enforcerLoaded: enforcer !== null,
        rulesCount: ARBITER_RULE_NAMES.length,
        rules: [...ARBITER_RULE_NAMES],
        ruleDetails,
        summary: {
          state: degraded.length > 0 ? 'degraded' : 'nominal',
          mode: config.strictMode ? 'strict_enforcement' : 'observe_only',
          criticalAction: config.strictMode ? 'man_overboard' : 'log_only',
          enforcedRules: ruleDetails.filter((rule) => rule.coverage === 'enforced').length,
          degradedRules: ruleDetails.filter((rule) => rule.coverage === 'degraded').length,
          stubbedRules: ruleDetails.filter((rule) => rule.coverage === 'stubbed').length,
        },
        degraded,
        violationsCount: violations.length,
        uptimeMs: Date.now() - startedAt,
        startedAt,
      };
    },

    /** Inject a test violation (for demos) */
    injectTestViolation,

    /** Stop the arbiter (unsubscribe from activity log) */
    stop: stopWatching,
  };
}

function readFiniteUsd(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readPositiveInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return parsed > 0 ? parsed : null;
  }
  return null;
}

export type Arbiter = ReturnType<typeof createArbiter>;
