/**
 * Shared types for the Steward's seat (ADR-0109; docs/plans/THE_FULL_WHEEL.md §1–§4).
 *
 * DESIGN INTENT: the Steward is the single durable owner of merge authority for
 * one repo. Everything in this module encodes that shape: identity is a
 * `(repo × role)` Durable Object name, memory is split between hot DO storage
 * (charter, inbox, cursors) and append-only D1 history (deck log, merge
 * ledger), and every record carries enough provenance that a stranger reading
 * the ledger can reconstruct why the seat did what it did. The types are the
 * contract the tick (P1 PR 2) and the console (P4) will build against, so they
 * are deliberately explicit rather than clever.
 */

/**
 * The Worker environment the Steward runs in.
 *
 * WHY OPTIONALS: the seat must fail closed but *visibly* when a binding is
 * missing — a missing D1 binding degrades ledger writes to the DO-storage
 * fallback ring and raises the `degraded` flag on /status rather than
 * throwing, and a missing admin token refuses every request with a 503 that
 * says the seat is not commissioned. Optional types force every call site to
 * decide its degradation story instead of assuming infrastructure.
 */
export interface Env {
  /** Append-only history fabric — the shared `port-daddy-relay` D1 database. */
  DB?: D1Database;
  /** The one-DO-per-repo namespace this Worker exports. */
  STEWARD: DurableObjectNamespace;
  /**
   * Shared bearer token gating every route. Held by the webhook receiver and
   * (later) the console; without it the seat answers 503, never 200.
   */
  STEWARD_ADMIN_TOKEN?: string;
  /**
   * GitHub token the tick surveys with (read: PRs, checks, reviews). Without
   * it the tick skips honestly ("cannot survey; holding") — the seat never
   * decides blind. The land-to-main capability is deliberately NOT this
   * token — see {@link Env.STEWARD_LAND_TOKEN}.
   */
  STEWARD_GITHUB_TOKEN?: string;
  /**
   * The land capability (P1 PR 3): a fine-grained, NON-admin PAT with
   * Contents + Pull requests read/write on this one repo, held by no other
   * system. Presence arms landing; absence means LAND verdicts are recorded
   * but never executed — the operator's rollout switch. Non-admin is the
   * point: GitHub itself refuses the merge whenever branch protection is
   * unsatisfied, so "never land over a real red" is platform-enforced
   * (ADR-0109's single-approver property, structurally).
   */
  STEWARD_LAND_TOKEN?: string;
}

/**
 * A wake event queued into the seat's inbox.
 *
 * MOTIVATION: the Steward runs on wakes, not loops (§3 of the plan) — every
 * external stimulus becomes one of these rows, drained by the alarm. The
 * `deliveryId` exists so at-least-once webhook delivery can be deduplicated at
 * the door; `kind` is a small open vocabulary because the receiver forwards
 * heterogeneous GitHub events and the tick, not the intake, decides relevance.
 */
export interface WakeEvent {
  /** What kind of stimulus this is, e.g. `pull_request:synchronize`, `heartbeat`, `operator`. */
  kind: string;
  /** Idempotency key — GitHub delivery GUID or caller-minted unique id. */
  deliveryId: string;
  /** PR number when the stimulus concerns one; absent for repo-level events. */
  prNumber?: number;
  /** Small free-form context payload; never a substitute for re-fetching live state. */
  detail?: string;
  /** Epoch milliseconds the intake accepted the event. */
  receivedAt: number;
}

/**
 * The seat's charter — mission, hard limits, escalation rules.
 *
 * WHY VERSIONED WITH PROVENANCE: §5's sanity protocol has every wake re-read
 * the charter and self-audit against it, which only means something if the
 * charter's history is auditable. Only the operator and reviewed PRs may write
 * it (§4's ledger table), so each revision records who and why.
 */
export interface Charter {
  /** Monotonic version, bumped on every accepted revision. */
  version: number;
  /** One-paragraph mission statement the seat re-reads at every wake. */
  mission: string;
  /** Hard limits — things the seat may NEVER do, checked in the wake self-audit. */
  hardLimits: string[];
  /** When the seat must SURFACE to the operator instead of acting. */
  escalationRules: string[];
  /** Who authored this revision — `operator` or a PR reference. */
  updatedBy: string;
  /** Epoch milliseconds of the revision. */
  updatedAt: number;
}

/**
 * One deck-log entry — the seat's vital sign (§5.3: a wake that writes no
 * entry is a failed wake, ALL QUIET included).
 */
export interface DeckLogEntry {
  /** Repo the seat serves, `owner/repo`. */
  repo: string;
  /** `wake` when stimuli were processed, `all-quiet` for a heartbeat with an empty inbox. */
  entryKind: 'wake' | 'all-quiet';
  /** Human-readable one-liner a cold reader can follow. */
  summary: string;
  /** JSON-encoded structured context (drained events, charter version, degradation flags). */
  detail: string;
  /** How many wake events this entry accounts for (0 for all-quiet). */
  wakeEvents: number;
  /** Epoch seconds. */
  createdAt: number;
}

/**
 * One merge-ledger row — every verdict the seat ever renders (§4).
 *
 * The scaffold ships the schema and append/read path so the tick (P1 PR 2)
 * lands onto an already-tested ledger; nothing writes verdicts yet.
 */
export interface MergeLedgerEntry {
  /** Repo the verdict concerns, `owner/repo`. */
  repo: string;
  /** The PR judged. */
  prNumber: number;
  /** The seat's three-valued verdict vocabulary — nothing else is ever valid. */
  verdict: 'LAND' | 'NEEDS-WORK' | 'SURFACE';
  /** Evidence links + reasoning a stranger can check; never empty. */
  evidence: string;
  /** Who asked for the verdict — `tick`, `operator`, or a re-request source. */
  requestedBy: string;
  /** Epoch seconds. */
  createdAt: number;
}
