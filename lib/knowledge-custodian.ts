/**
 * Knowledge Custodian — daemon-resident compaction engine caretaker.
 *
 * A setInterval loop running inside the daemon process — NOT a separate LLM agent.
 * For decisions requiring intelligence it spawns a one-shot Haiku sortie (cost cap $0.02).
 *
 * Duties:
 * 1. harvest      — promote session notes to episodes before sessions go stale
 * 2. resurrect    — event-driven on agent:dead; read salvage capsule, HITL, respawn
 * 3. dedupWarn    — on sortie:created; BM25 search for similar past work
 * 4. contextPressure — periodic; warn/propose-spawn for agents at critical context
 * 5. archiveTTL   — every 6h; archive expired episodes, mark stale resurrections
 *
 * The custodian heartbeats every pollIntervalMs, visible in swarm_awareness.
 * It has its own session registered as 'system:custodian:main'.
 */

import type { Database } from 'better-sqlite3';
import { harvestSession } from './session-harvest.js';
import { createOperatorPermissions, type OperatorPermissions } from './operator-permissions.js';
import { isSubscriptionBackend } from './backend-catalog.js';
import { haltActive } from './distress.js';

/** Capability tier the escalation guard reasons about. `high` always forces HITL. */
export type ResurrectTier = 'fast' | 'high';

/** Real projected cost/tier of a resurrect respawn (replaces the old $0.02 constant). */
export interface ResurrectCostProjection {
  estimatedCostUsd: number;
  tier: ResurrectTier;
}

interface CustodianLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

interface CustodianDeps {
  db: Database;
  logger: CustodianLogger;
  /** episodicMemory module from lib/episodic-memory.ts */
  episodicMemory: {
    archiveExpired(before?: string): number;
    remember(input: Record<string, unknown>): { id: number };
  };
  /** messaging module for broadcasting inbox messages */
  messaging?: {
    publish(channel: string, payload: Record<string, unknown>): void;
  };
  /** resurrection module — used here only to purge long-stale queue entries */
  resurrection?: {
    cleanup(olderThan?: number): { cleaned: number };
  };
  /** context window tracker for pressure-level queries */
  contextTracker?: {
    getSwarmContextSummary(project?: string): Array<{
      agentId: string;
      pressureLevel: string;
      usedPct: number;
      effectiveMax: number;
      tokensUsed: number;
    }>;
  };
  /** operator permissions store */
  operatorPermissions?: OperatorPermissions;
  /** blob store for large artifact promotion */
  blobs?: {
    store(content: string, opts: { mimeType?: string; agentId?: string; metadata?: Record<string, unknown> }): Promise<{ id: string }>;
  };
  /** poll interval in ms (default 60_000) */
  pollIntervalMs?: number;
  /** archiveTTL interval in ms (default 6 * 60 * 60 * 1000) */
  archiveIntervalMs?: number;
  /**
   * ADR-0132 A0: is a halt hoisted? Defaults to the real sentinel check in
   * lib/distress.ts; injectable for tests. While halted the resurrect duty
   * does nothing — not even an approval request — because a halt means
   * "do not start, restart, or resurrect anything".
   */
  haltActive?: () => boolean;
}

interface DutyTimestamps {
  harvest: number | null;
  resurrect: number | null;
  dedupWarn: number | null;
  contextPressure: number | null;
  archiveTTL: number | null;
}

export interface CustodianStatus {
  running: boolean;
  lastDutyAt: DutyTimestamps;
  episodesHarvestedToday: number;
  pendingApprovalsCount: number;
  startedAt: string | null;
}

const STALE_AFTER_MINUTES = 30;
const CONTEXT_WARN_INTERVAL_MS = 30_000;

export class KnowledgeCustodian {
  private readonly db: Database;
  private readonly deps: CustodianDeps;
  private readonly operatorPermissions: OperatorPermissions;
  private running = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private archiveTimer: ReturnType<typeof setInterval> | null = null;
  private contextPressureTimer: ReturnType<typeof setInterval> | null = null;
  private immediateHarvestTimer: ReturnType<typeof setTimeout> | null = null;
  private startedAt: string | null = null;
  private lastDuty: DutyTimestamps = {
    harvest: null,
    resurrect: null,
    dedupWarn: null,
    contextPressure: null,
    archiveTTL: null,
  };

  constructor(deps: CustodianDeps) {
    this.db = deps.db;
    this.deps = deps;
    this.operatorPermissions = deps.operatorPermissions ?? createOperatorPermissions(deps.db);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.startedAt = new Date().toISOString();

    const pollMs = this.deps.pollIntervalMs ?? 60_000;
    const archiveMs = this.deps.archiveIntervalMs ?? 6 * 60 * 60 * 1000;

    this.pollTimer = setInterval(() => this.runHarvestDuty(), pollMs);
    this.archiveTimer = setInterval(() => this.runArchiveTTLDuty(), archiveMs);
    this.contextPressureTimer = setInterval(() => this.runContextPressureDuty(), CONTEXT_WARN_INTERVAL_MS);

    // Run harvest once immediately; store handle so stop() can cancel it
    this.immediateHarvestTimer = setTimeout(() => {
      this.immediateHarvestTimer = null;
      if (this.running) this.runHarvestDuty();
    }, 5_000);
  }

  stop(): void {
    if (this.immediateHarvestTimer) { clearTimeout(this.immediateHarvestTimer); this.immediateHarvestTimer = null; }
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    if (this.archiveTimer) { clearInterval(this.archiveTimer); this.archiveTimer = null; }
    if (this.contextPressureTimer) { clearInterval(this.contextPressureTimer); this.contextPressureTimer = null; }
    this.running = false;
  }

  getStatus(): CustodianStatus {
    const todayStartMs = new Date().setHours(0, 0, 0, 0);
    const tomorrowStartMs = todayStartMs + 86_400_000;
    const episodesHarvestedToday = (this.db.prepare(`
      SELECT COUNT(*) as n FROM episodic_memory
      WHERE source_type = 'note'
        AND created_at >= ? AND created_at < ?
    `).get(todayStartMs, tomorrowStartMs) as { n: number } | undefined)?.n ?? 0;

    const pendingApprovalsCount = this.operatorPermissions.listCandidates().length;

    return {
      running: this.running,
      lastDutyAt: { ...this.lastDuty },
      episodesHarvestedToday,
      pendingApprovalsCount,
      startedAt: this.startedAt,
    };
  }

  // ─── Duty: harvest ───────────────────────────────────────────────────────────

  async runHarvestDuty(): Promise<void> {
    const { db, deps } = this;
    const staleThreshold = Date.now() - STALE_AFTER_MINUTES * 60 * 1000;

    const staleSessions = db.prepare(`
      SELECT id FROM sessions
      WHERE status = 'active' AND updated_at < ?
    `).all(staleThreshold) as Array<{ id: string }>;

    let harvested = 0;
    for (const { id } of staleSessions) {
      try {
        const result = await harvestSession(id, db, {
          episodicMemory: deps.episodicMemory as unknown as Parameters<typeof harvestSession>[2]['episodicMemory'],
          blobs: deps.blobs,
        });
        harvested += result.promoted;
      } catch (err) {
        deps.logger.error('Custodian harvest failed', { sessionId: id, err });
      }
    }

    if (harvested > 0) {
      deps.logger.info('Custodian harvest duty complete', { harvested, staleSessions: staleSessions.length });
    }
    this.lastDuty.harvest = Date.now();
  }

  // Called externally when a session ends — immediate harvest while the
  // append-only session notes remain queryable.
  async onSessionEnd(sessionId: string): Promise<void> {
    try {
      await harvestSession(sessionId, this.db, {
        episodicMemory: this.deps.episodicMemory as unknown as Parameters<typeof harvestSession>[2]['episodicMemory'],
        blobs: this.deps.blobs,
      });
    } catch (err) {
      this.deps.logger.error('Custodian onSessionEnd harvest failed', { sessionId, err });
    }
  }

  // ─── Duty: resurrect (event-driven on agent:dead) ────────────────────────────

  async onAgentDead(
    agentId: string,
    identityProject: string,            // AUTHENTICATED scope from the StaleAgent record — trusted
    capsule?: Record<string, unknown>,  // FORGEABLE self-salvage payload — respawn context ONLY
  ): Promise<void> {
    const { deps } = this;
    if (!deps.messaging) return;

    // ADR-0132 §3 (Daemon row): a hoisted halt suspends resurrection outright.
    // No spawn, no approval request, no queue mutation — silence during a
    // halt is compliance, and the custodian must not turn it into a relaunch.
    if ((deps.haltActive ?? haltActive)()) {
      deps.logger.info('Custodian resurrect suspended: Port Daddy is halted (SECURITE HALT)', { agentId, scope: identityProject ?? '' });
      return;
    }

    // TRUST BOUNDARY (ADR-0040): the authorization scope comes from the daemon-owned
    // StaleAgent.identityProject, NEVER from the attacker-controllable capsule. A forged
    // `capsule.identityProject` cannot influence the permission check because scope is a
    // distinct positional argument the caller supplies from the verified agent record.
    const scope = identityProject ?? '';

    // Real projected cost/tier for THIS resurrect spawn (replaces the hardcoded $0.02
    // constant that operator-permissions.check() ignored entirely).
    const { estimatedCostUsd, tier } = this.projectResurrectCost(agentId);

    let policy = this.operatorPermissions.check('resurrect', scope, estimatedCostUsd);

    // Escalation guard (defense-in-depth): an empty/unknown identity — which the
    // operator-permissions store matches with the wildcard `''` → `'%'` prefix, i.e.
    // every project — or a high-cost tier can NEVER silently auto-resurrect. Force HITL.
    // This closes the empty-prefix escalation-by-aggregation path even if an `''` pattern
    // was somehow flipped to `'auto'`.
    if (policy === 'auto' && (!scope || tier === 'high')) policy = 'ask';

    switch (policy) {
      case 'deny':
        deps.logger.info('Custodian resurrect blocked by policy', { agentId, scope });
        return;
      case 'ask':
        deps.messaging.publish('operator:approvals', {
          type: 'resurrect_request',
          agentId,
          identityProject: scope,
          estimatedCostUsd,
          tier,
          capsule,
          requestedAt: new Date().toISOString(),
          message: `Agent ${agentId} died. Resurrect ${scope || '(unknown project)'}? (est. $${estimatedCostUsd.toFixed(3)}, tier: ${tier})`,
        });
        this.lastDuty.resurrect = Date.now();
        return;
      case 'auto':
        // capsule is passed through as respawn context ONLY — never as identity.
        await this.doResurrect(agentId, capsule);
        this.lastDuty.resurrect = Date.now();
        return;
      default: {
        // Exhaustiveness: every PermissionPolicy is handled above.
        const _exhaustive: never = policy;
        return _exhaustive;
      }
    }
  }

  async resolveResurrection(
    agentId: string,
    identityProject: string,             // AUTHENTICATED scope echoed back from the stored request
    decision: 'approved' | 'denied',
    capsule?: Record<string, unknown>,   // respawn context ONLY
    costUsd = 0,
  ): Promise<void> {
    // Scope is the trusted `identityProject` from the approval request we published
    // (which carried the authenticated scope), NOT re-derived from the forgeable capsule.
    this.operatorPermissions.record('resurrect', identityProject ?? '', costUsd, decision);

    if (decision === 'approved') {
      await this.doResurrect(agentId, capsule);
    }
  }

  /**
   * Project the cost/tier of resurrecting `agentId`, grounded in the agent's most recent
   * real spend rather than a hardcoded constant. Subscription (`cli:*`) backends project
   * ~$0 at `fast` tier (marginal cost to the operator's wallet is zero); metered backends
   * project their recent per-spawn spend and escalate to `high` tier once that spend
   * crosses the HITL threshold. The `tier` is what the escalation guard gates on, so a
   * high-cost or unknown resurrect always requires an operator gate.
   */
  private projectResurrectCost(agentId: string): ResurrectCostProjection {
    const HIGH_TIER_USD = 0.10;
    try {
      const agent = this.db.prepare(
        `SELECT identity_project FROM agents WHERE id = ?`
      ).get(agentId) as { identity_project: string | null } | undefined;

      const project = agent?.identity_project ?? null;
      // Most recent settled spend for this agent's project — the best available signal
      // for what a respawn under the same backend will cost.
      const recent = project
        ? (this.db.prepare(
            `SELECT backend, cost_usd FROM cost_events
             WHERE project_name = ? ORDER BY ts DESC LIMIT 1`
          ).get(project) as { backend: string; cost_usd: number } | undefined)
        : undefined;

      if (!recent) {
        // No spend history — conservative default. `fast` tier, small nonzero estimate.
        return { estimatedCostUsd: 0.05, tier: 'fast' };
      }

      if (isSubscriptionBackend(recent.backend)) {
        return { estimatedCostUsd: 0.001, tier: 'fast' };
      }

      const estimatedCostUsd = recent.cost_usd > 0 ? recent.cost_usd : 0.05;
      return { estimatedCostUsd, tier: estimatedCostUsd >= HIGH_TIER_USD ? 'high' : 'fast' };
    } catch {
      // Any query failure fails cautious: a small estimate at `fast` tier still gates on
      // the empty-scope branch of the escalation guard when scope is unknown.
      return { estimatedCostUsd: 0.05, tier: 'fast' };
    }
  }

  private async doResurrect(agentId: string, capsule?: Record<string, unknown>): Promise<void> {
    const { deps } = this;
    if (!deps.messaging) return;

    // Inject capsule as first context for the new agent
    deps.messaging.publish(`agent:${agentId}:inbox`, {
      type: 'resurrection_context',
      capsule,
      from: 'system:custodian:main',
      message: `You are being resurrected. Previous context: ${JSON.stringify(capsule?.nextPlan ?? 'unknown')}`,
    });

    deps.logger.info('Custodian resurrected agent', { agentId });
  }

  // ─── Duty: dedupWarn (event-driven on sortie:created) ────────────────────────

  async onSortieCreated(sortieId: string, purpose: string, agentId?: string): Promise<void> {
    const { db, deps } = this;
    if (!deps.messaging || !purpose.trim()) return;

    // BM25-style search using LIKE (avoid keyword enumeration — search all terms)
    const terms = purpose
      .toLowerCase()
      .split(/\s+/)
      .filter(t => t.length > 2)
      .slice(0, 8);

    if (terms.length === 0) return;

    const whereClauses = terms.map(() => `(LOWER(title) LIKE ? OR LOWER(summary) LIKE ?)`).join(' OR ');
    const params = terms.flatMap(t => [`%${t}%`, `%${t}%`]);
    params.push('10');

    const rows = db.prepare(`
      SELECT id, title, summary, episode_type, source_id, project
      FROM episodic_memory
      WHERE ${whereClauses}
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(...params) as Array<Record<string, unknown>>;

    if (rows.length === 0) {
      this.lastDuty.dedupWarn = Date.now();
      return;
    }

    // Score by term coverage
    const scored = rows
      .map(row => {
        const text = `${row.title} ${row.summary}`.toLowerCase();
        const hits = terms.filter(t => text.includes(t)).length;
        return { row, score: hits / terms.length };
      })
      .filter(r => r.score >= 0.5)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    if (scored.length === 0) {
      this.lastDuty.dedupWarn = Date.now();
      return;
    }

    const matchList = scored
      .map(({ row, score }) => `- "${row.title}" (id: ${row.id}, score: ${score.toFixed(2)}) — \`pd memory episode ${row.id}\``)
      .join('\n');

    const channel = agentId ? `agent:${agentId}:inbox` : 'operator:notifications';
    deps.messaging.publish(channel, {
      type: 'dedup_warning',
      sortieId,
      purpose,
      matches: scored.map(({ row, score }) => ({ id: row.id, title: row.title, score })),
      message: `Possible duplicate work detected for sortie ${sortieId}.\n\nSimilar past work:\n${matchList}\n\nRun \`pd memory find "${purpose}"\` before starting.`,
    });

    this.lastDuty.dedupWarn = Date.now();
  }

  // ─── Duty: contextPressure ────────────────────────────────────────────────────

  runContextPressureDuty(): void {
    const { deps } = this;
    if (!deps.contextTracker || !deps.messaging) return;

    const agents = deps.contextTracker.getSwarmContextSummary();

    for (const agent of agents) {
      if (agent.pressureLevel === 'critical') {
        deps.messaging.publish(`agent:${agent.agentId}:inbox`, {
          type: 'context_pressure',
          agentId: agent.agentId,
          usedPct: agent.usedPct,
          pressureLevel: 'critical',
          message: `Context critical (${Math.round(agent.usedPct * 100)}% of effective window used). ` +
            `Consider spawning a continuation agent or executing a handoff. ` +
            `Remaining effective capacity: ~${Math.round((agent.effectiveMax - agent.tokensUsed) / 1000)}k tokens.`,
        });
      } else if (agent.pressureLevel === 'warn') {
        deps.messaging.publish(`agent:${agent.agentId}:inbox`, {
          type: 'context_advisory',
          agentId: agent.agentId,
          usedPct: agent.usedPct,
          pressureLevel: 'warn',
          message: `Context at ${Math.round(agent.usedPct * 100)}% of effective window. Plan handoff soon.`,
        });
      }
    }

    this.lastDuty.contextPressure = Date.now();
  }

  // ─── Duty: archiveTTL ────────────────────────────────────────────────────────

  /**
   * Archive expired knowledge and retire only provably inactive ephemeral work.
   * The design rechecks the same SQLite predicates after asynchronous harvest:
   * collecting evidence must never overwrite a renewed or completed session.
   * @returns Immediately; completion logging counts actual conditional updates.
   */
  runArchiveTTLDuty(): void {
    const { db, deps } = this;

    // Archive expired episodes
    const archived = deps.episodicMemory.archiveExpired();

    // Purge resurrection queue entries older than 30 days. This previously
    // hand-rolled a filter+mark loop against a `getQueue`/`markDead` interface
    // that never existed on the real resurrection module (lib/resurrection.ts
    // exposes `cleanup`, not those two) — an `as any` cast at the server.ts
    // wiring site hid the type mismatch, and the resulting TypeError crashed
    // the whole daemon process the first time this 6-hourly duty fired after
    // any entry aged past the threshold. `cleanup()` is the module's own
    // purpose-built method for exactly this.
    if (deps.resurrection) {
      deps.resurrection.cleanup(30 * 24 * 60 * 60 * 1000);
    }

    // One sweep clock: elapsed harvest time cannot age newly observed activity
    // into eligibility. Malformed storage/clock values are not expiry evidence.
    const sweepAt = Date.now();
    const sevenDaysAgo = sweepAt - 7 * 24 * 60 * 60 * 1000;
    if (!Number.isSafeInteger(sweepAt) || sevenDaysAgo < 0) {
      deps.logger.error('Custodian archiveTTL clock invalid');
      return;
    }
    const eligible = `
      status = 'active'
      AND (is_durable IS NULL OR (typeof(is_durable) = 'integer' AND is_durable = 0))
      AND typeof(updated_at) = 'integer' AND updated_at >= 0 AND updated_at < @cutoff
      AND NOT EXISTS (
        SELECT 1 FROM session_notes sn WHERE sn.session_id = sessions.id AND (
          typeof(sn.created_at) != 'integer' OR sn.created_at < 0
          OR sn.created_at >= @cutoff
        )
      )
    `;
    const orphaned = db.prepare(`
      SELECT id, updated_at FROM sessions WHERE ${eligible}
    `).all({ cutoff: sevenDaysAgo }) as Array<{ id: string; updated_at: number }>;
    const abandon = db.prepare(`
      UPDATE sessions SET status = 'abandoned', phase = 'abandoned',
        completed_at = @sweepAt, updated_at = @sweepAt
      WHERE id = @id AND updated_at = @capturedUpdatedAt AND ${eligible}
    `);

    const harvests = orphaned.map(({ id, updated_at }) =>
      harvestSession(id, db, {
        episodicMemory: deps.episodicMemory as unknown as Parameters<typeof harvestSession>[2]['episodicMemory'],
        blobs: deps.blobs,
      })
        .then(() => {
          return abandon.run({ id, capturedUpdatedAt: updated_at, cutoff: sevenDaysAgo, sweepAt }).changes;
        })
        .catch(err => {
          deps.logger.error('Custodian archiveTTL harvest failed', { sessionId: id, err });
          return 0;
        }),
    );

    void Promise.all(harvests).then(changes => {
      if (archived > 0 || orphaned.length > 0) {
        deps.logger.info('Custodian archiveTTL duty complete', {
          archived, orphanedSessions: changes.reduce((sum, count) => sum + count, 0),
        });
      }
    });
    this.lastDuty.archiveTTL = sweepAt;
  }
}

export function createKnowledgeCustodian(deps: CustodianDeps): KnowledgeCustodian {
  return new KnowledgeCustodian(deps);
}
