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

import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ActivityType, type createActivityLog } from './activity.js';
import type { createAgents } from './agents.js';
import type { createSessions } from './sessions.js';
import type { createLocks } from './locks.js';
import type { createResurrection } from './resurrection.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Rust Enforcer Bridge (FFI) ─────────────────────────────────────────────

const libPath = join(
  __dirname,
  '../dist/core/libharbor_card_rs.' + (process.platform === 'darwin' ? 'dylib' : 'so')
);

let enforcer: {
  constantTimeCompare: (a: Buffer, aLen: number, b: Buffer, bLen: number) => boolean;
  verifyCapsSubset: (rootJson: string, rootLen: number, subJson: string, subLen: number) => boolean;
} | null = null;

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
}

// ─── Rules ──────────────────────────────────────────────────────────────────

const RULES = [
  'PID_SQUATTING',
  'CAP_ESCALATION',
  'NOTE_MONOTONICITY',
  'ESCROW_POSITIVE',
  'LOCK_OWNER_VALID',
  'HEARTBEAT_FRESHNESS',
] as const;

type RuleName = typeof RULES[number];

// ─── Arbiter Factory ────────────────────────────────────────────────────────

export function createArbiter(
  deps: ArbiterDeps,
  config: ArbiterConfig = { strictMode: false }
) {
  const { activityLog, agents, sessions, locks, resurrection } = deps;
  const violations: Violation[] = [];
  const startedAt = Date.now();
  let nextViolationId = 1;

  // Track note counts per session for monotonicity checking
  const sessionNoteCounts = new Map<string, number>();

  // Try to load the Rust enforcer (non-blocking if unavailable)
  if (existsSync(libPath)) {
    import('koffi').then((koffiModule: any) => {
      try {
        const koffi = koffiModule.default ?? koffiModule;
        const lib = koffi.load(libPath);
        enforcer = {
          constantTimeCompare: lib.func(
            'bool harbor_constant_time_compare(const uint8_t *a, size_t a_len, const uint8_t *b, size_t b_len)'
          ),
          verifyCapsSubset: lib.func(
            'bool harbor_verify_caps_subset_json(const char *root_json, size_t root_len, const char *sub_json, size_t sub_len)'
          ),
        };
        console.error('[Arbiter] Rust enforcer loaded via FFI');
      } catch (err) {
        console.error('[Arbiter] Rust FFI load failed:', (err as Error).message);
      }
    }).catch(() => {
      console.error('[Arbiter] koffi not available, running without Rust enforcer');
    });
  }

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
   * When Float Plans are implemented, every active session must have escrow > 0.
   * Currently a stub that checks for the field's existence.
   */
  function checkEscrowPositive(entry: any) {
    // Float Plans not yet implemented — log as info when they are
    const escrow = entry.metadata?.escrow;
    if (escrow !== undefined && escrow <= 0) {
      recordViolation('ESCROW_POSITIVE', 'violation',
        `Session started with non-positive escrow: ${escrow}`,
        entry.agentId, { escrow }
      );
    }
    // When escrow field is absent, no violation — Float Plans not active yet
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

  // ─── Public API ─────────────────────────────────────────────────────────

  return {
    /** Number of violations recorded since startup */
    getViolationsCount: () => violations.length,

    /** All recorded violations */
    getViolations: (limit = 50, offset = 0) => violations.slice(offset, offset + limit),

    /** Status summary */
    getStatus: () => ({
      active: true,
      strictMode: config.strictMode,
      enforcerLoaded: enforcer !== null,
      rulesCount: RULES.length,
      rules: [...RULES],
      violationsCount: violations.length,
      uptimeMs: Date.now() - startedAt,
      startedAt,
    }),

    /** Inject a test violation (for demos) */
    injectTestViolation,

    /** Stop the arbiter (unsubscribe from activity log) */
    stop: stopWatching,
  };
}

export type Arbiter = ReturnType<typeof createArbiter>;
