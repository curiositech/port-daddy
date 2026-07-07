/**
 * Harbor Editor **P3, slice 3: agent-neutral MCP claim tools + the commit gate**
 * (the TypeScript, daemon-facing half; the Rust half is
 * `core/pd-console/src/editor_commit_gate.rs`).
 *
 * ## What this module is (honest scope)
 * Slice 1 made a region claim a live awareness range + a durable `/files` mirror;
 * slice 2 added the pre-write WEDGE (`/conflicts/predict`). This module lifts those
 * primitives onto the **MCP surface** so ANY backend — not the editor pane alone —
 * can claim a region, release it, and run a coordination preflight through the SAME
 * `mcp/server.ts` surface that already exposes `begin_session`/`claim_port`/
 * `coordination_preflight`. It is the pure, jest-testable core those tool handlers
 * delegate to (the `lib/safe/mcp-inventory.ts` discipline: server.ts wires I/O, the
 * decisions live here where they unit-test with no daemon and no transport).
 *
 * ## The two PD hard rules this module encodes (adversarial-verify targets)
 *   - **Agent-neutral (HARD RULE 4).** `claim_region` / `release_region` /
 *     `coordination_preflight` are first-class for EVERY backend. Nothing here branches
 *     on Claude (or on any backend literal): an actor identity is an OPAQUE string,
 *     forwarded to the daemon and echoed in a refusal, NEVER compared to `'claude'` to
 *     change what a claim does. `claimRegionBody` / `releaseRegionBody` / `preflight`
 *     produce byte-identical output for a Claude, a Codex, and a human actor — proven
 *     behaviorally in the tests, not asserted by comment.
 *   - **A refusal names only the correct action, never a bypass (HARD RULE 5).** A gated
 *     preflight yields a typed {@link PreflightVerdict} of kind `gated` whose message
 *     offers *request a handoff / open a parley / pick another region* and NEVER a
 *     `--force`/`--no-verify`/`--allow-*` flag. It is a typed refusal (the #718
 *     `UnsupportedScopeError` precedent) — not a bypass-advertising string, not a silent
 *     merge. The wording is the TS twin of Rust `editor_wedge::guard_message`, kept in
 *     lockstep so there is one sentence to audit on each side.
 */

/**
 * The ONLY actions a gated refusal ever offers (HARD RULE 5) — the TS twin of Rust
 * `editor_wedge::GATED_ACTIONS`. Every one is a forward, honest move: negotiate for the
 * region or leave it. There is deliberately NO `--force` / `--no-verify` / `--allow-*`.
 */
export const GATED_ACTIONS = ['request a handoff', 'open a parley', 'pick another region'] as const;

/**
 * The tripwire list a test scans a refusal string against — the TS twin of Rust
 * `editor_wedge::BYPASS_TOKENS`. A refusal that mentions ANY of these has advertised a
 * bypass and is a defect. Kept in lockstep with the Rust list so both halves audit the
 * same forbidden vocabulary.
 */
export const BYPASS_TOKENS = ['--force', '--no-verify', '--allow', 'force', 'override', 'bypass'] as const;

/**
 * The typed refusal string for a region held by another live actor — names the owner,
 * the symbol, and ONLY {@link GATED_ACTIONS}. This is the load-bearing HARD-RULE-5
 * sentence: it must never name a bypass flag. It is the exact TS mirror of Rust
 * `editor_wedge::guard_message(owner_label, symbol)` so a reviewer audits one wording.
 */
export function regionRefusalMessage(ownerLabel: string, symbol: string): string {
  return `region ‘${symbol}’ is held by ${ownerLabel}'s live claim — ${GATED_ACTIONS.join(', ')}.`;
}

// ── Agent-neutral identities & the daemon claim shapes ───────────────────────

/**
 * An acting actor — an OPAQUE `sessionId` (+ optional `agentId` label). Agent-neutral:
 * both are forwarded/echoed as strings and NEVER compared to a backend literal. A
 * Claude, a Codex, and a human differ only in the value of these strings, never in the
 * code path they take.
 */
export interface Actor {
  sessionId: string;
  agentId?: string;
}

/**
 * A region claim intent — a contiguous 1-based inclusive line span of one file plus the
 * work `symbol` (the label the daemon scores conflicts on). `kind` defaults to `modify`
 * (holding a region to edit it); `read` exists so a look-only claim never over-blocks.
 */
export interface ClaimIntent {
  path: string;
  startLine: number;
  endLine: number;
  symbol: string;
  kind?: 'read' | 'modify';
}

/**
 * One owner row as `GET /files/who-owns` returns it (`getClaimOwner().owners[i]`). Every
 * field the resolver reads is optional/tolerant so a partial or drifted row never throws.
 */
export interface WhoOwnsOwner {
  sessionId: string;
  agentId?: string | null;
  symbol?: string | null;
  symbolPath?: string | null;
  startLine?: number | null;
  endLine?: number | null;
  claimedAt?: number | null;
}

/** Do two 1-based inclusive spans share at least one line? */
function spansOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/** The opaque display label for an owner — `agentId` if present, else `sessionId`. Never a backend name. */
function ownerLabel(owner: WhoOwnsOwner): string {
  const a = (owner.agentId ?? '').trim();
  return a.length > 0 ? a : owner.sessionId;
}

/**
 * The **first-granted, non-revoked** owner covering the intent region — HARD RULE 6's
 * contention winner (earliest `claimedAt`, ties broken by `sessionId` for determinism),
 * among owners that (a) overlap the region and (b) pass the liveness predicate. A
 * whole-file claim (null span) is treated as covering the region. Returns `undefined`
 * when no live owner overlaps. Identity-blind: it orders on grant time, never on who or
 * which backend holds the claim.
 */
export function firstGrantedOwner(
  intent: ClaimIntent,
  owners: WhoOwnsOwner[],
  isLive: (owner: WhoOwnsOwner) => boolean = () => true,
): WhoOwnsOwner | undefined {
  const covering = owners.filter((o) => {
    if (!isLive(o)) return false;
    const s = o.startLine ?? null;
    const e = o.endLine ?? null;
    if (s == null || e == null) return true; // whole-file claim covers any region
    return spansOverlap(s, e, intent.startLine, intent.endLine);
  });
  let winner: WhoOwnsOwner | undefined;
  for (const o of covering) {
    if (winner === undefined) {
      winner = o;
      continue;
    }
    const oAt = o.claimedAt ?? Number.MAX_SAFE_INTEGER;
    const wAt = winner.claimedAt ?? Number.MAX_SAFE_INTEGER;
    if (oAt < wAt || (oAt === wAt && o.sessionId < winner.sessionId)) {
      winner = o;
    }
  }
  return winner;
}

/**
 * The typed verdict of a region preflight (the MCP twin of Rust
 * `editor_wedge::GuardVerdict`). `clear` → proceed; `gated` → another live actor holds
 * the region: a typed refusal carrying the owner, the symbol, the span, the bypass-free
 * {@link regionRefusalMessage}, and only the sanctioned {@link GATED_ACTIONS}.
 */
export type PreflightVerdict =
  | { kind: 'clear' }
  | {
      kind: 'gated';
      owner: string;
      symbol: string;
      region: [number, number];
      message: string;
      actions: readonly string[];
    };

/**
 * The agent-neutral region preflight (HARD RULE 6/7): given the acting actor `me`, its
 * region intent, and the file's live owners (from `GET /files/who-owns`), decide whether
 * the edit may proceed. It is `clear` when the region is free or the first-granted owner
 * is `me`; it is `gated` — a typed, bypass-free refusal — when another LIVE actor holds
 * the first-granted claim (I am the contender, so I negotiate or move).
 *
 * Identity-blind by construction: `me` is matched to owners by `sessionId` equality
 * only, and the outcome never depends on which backend `me` runs — the same intent
 * against the same owners yields the same verdict for a Claude, a Codex, or a human.
 */
export function preflight(
  me: Actor,
  intent: ClaimIntent,
  owners: WhoOwnsOwner[],
  isLive: (owner: WhoOwnsOwner) => boolean = () => true,
): PreflightVerdict {
  const winner = firstGrantedOwner(intent, owners, isLive);
  if (winner === undefined || winner.sessionId === me.sessionId) {
    return { kind: 'clear' };
  }
  const label = ownerLabel(winner);
  const symbol = (winner.symbol ?? winner.symbolPath ?? intent.symbol) || intent.symbol;
  const region: [number, number] = [
    winner.startLine ?? intent.startLine,
    winner.endLine ?? intent.endLine,
  ];
  return {
    kind: 'gated',
    owner: label,
    symbol,
    region,
    message: regionRefusalMessage(label, symbol),
    actions: GATED_ACTIONS,
  };
}

// ── Daemon request builders (region-scoped, reusing the /files routes) ────────

/** Tool args for `claim_region` — a single region-scoped claim of one file's line span. */
export interface ClaimRegionArgs {
  session_id: string;
  path: string;
  start_line: number;
  end_line: number;
  symbol: string;
  symbol_path?: string;
  kind?: 'read' | 'modify';
}

/** Tool args for `release_region` — releasing one previously claimed region. */
export interface ReleaseRegionArgs {
  session_id: string;
  path: string;
  start_line: number;
  end_line: number;
  symbol_path?: string;
}

/** The `{ sessionId, body }` a `claim_region` maps to on `POST /sessions/:id/files`. */
export interface RegionRequest {
  sessionId: string;
  body: Record<string, unknown>;
}

/**
 * Map `claim_region` args to the region-scoped `POST /sessions/:id/files` body — REUSING
 * the exact `regions: [{ path, symbolPath, startLine, endLine, symbol }]` shape
 * `claim_files` already drives (never a whole-file `files: [...]` claim: a claim is a
 * REGION, HARD RULE 1). Deliberately carries NO `force`/bypass field — contention is
 * resolved by handoff/parley, never by forcing over a live claim (HARD RULE 5). The
 * mapping is identity-blind: no actor/backend value influences the body.
 */
export function claimRegionRequest(args: ClaimRegionArgs): RegionRequest {
  return {
    sessionId: args.session_id,
    body: {
      regions: [
        {
          path: args.path,
          symbolPath: args.symbol_path,
          startLine: args.start_line,
          endLine: args.end_line,
          symbol: args.symbol,
        },
      ],
    },
  };
}

/** Map `release_region` args to the region-scoped `DELETE /sessions/:id/files` body. */
export function releaseRegionRequest(args: ReleaseRegionArgs): RegionRequest {
  return {
    sessionId: args.session_id,
    body: {
      regions: [
        {
          path: args.path,
          symbolPath: args.symbol_path,
          startLine: args.start_line,
          endLine: args.end_line,
        },
      ],
    },
  };
}

// ── MCP tool surface (the region tools live INLINE in mcp/server.ts) ──────────

/**
 * The MCP tool names slice 3 adds/owns on the editor-coordination surface. `claim_region`
 * and `release_region` are NEW; `coordination_preflight` already exists on the surface
 * (this slice keeps it agent-neutral and region-aware). All three are first-class for
 * EVERY backend — never Claude-specific (HARD RULE 4).
 *
 * The tool DEFINITIONS themselves live as inline object literals in `mcp/server.ts`'s
 * `TOOLS` array (so the `mcp-parity` registry sees them and every tool maps to a manifest
 * feature); this module owns the agent-neutral LOGIC those handlers delegate to
 * ({@link claimRegionRequest}/{@link releaseRegionRequest}/{@link preflight}) plus the
 * refusal wording, which is what jest audits for neutrality and the bypass-free rule.
 */
export const EDITOR_CLAIM_TOOL_NAMES = ['claim_region', 'release_region', 'coordination_preflight'] as const;
