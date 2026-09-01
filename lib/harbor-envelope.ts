/**
 * Harbor Envelope — the vacuum-sealed environment a harbor defines.
 *
 * ADR-0013 made the Harbor the universal unit of scope, but `lib/harbors.ts`
 * is explicit that v1 enforcement is *advisory*: harbors record intent and
 * enable discovery, they do not deny anything. This module fills that gap.
 *
 * An envelope is the resource boundary an agent operates inside while docked
 * in a harbor: which filesystem roots it may touch, which tools / skills / MCP
 * servers / LLM backends / channels it may use, and how much it may spend. It
 * is the local, single-harbor face of the same capability set that the
 * Federated Harbor cross-realm transfer ceremony attenuates and re-mints
 * (`whitepaper/source/federated-harbor-whitepaper.tex`).
 *
 * ── The one invariant: FAIL CLOSED ──────────────────────────────────────────
 * An action is denied unless the envelope explicitly admits it. An empty
 * allowlist denies everything. The ONLY way to open a dimension is the literal
 * wildcard `'*'`. A missing or malformed envelope normalizes to deny-all — it
 * can never silently widen to allow-all. This mirrors the bond-and-capability
 * model: authority is granted, never assumed.
 *
 * Allowlist matching is exact over structured identifiers (tool names, skill
 * slugs, backend ids, channel names) — these are enum-like fields we control,
 * not free text, so exact match is correct (and deliberately NOT substring or
 * keyword matching).
 *
 * Every verdict carries a `boundary` label so the permission edge can be shown
 * to the operator at the moment it is crossed (gates #190 permission-boundary
 * UX).
 */

import { resolve, relative, isAbsolute, dirname, basename } from 'node:path';
import { realpathSync } from 'node:fs';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface HarborEnvelope {
  /** Allowed filesystem roots (absolute path prefixes). `['*']` = all paths. */
  filesystem: string[];
  /** Allowed tool names. `['*']` = all tools. */
  tools: string[];
  /** Allowed skill slugs. `['*']` = all skills. */
  skills: string[];
  /** Allowed MCP server names. `['*']` = all MCP servers. */
  mcps: string[];
  /** Allowed LLM backend ids. `['*']` = all backends. */
  backends: string[];
  /** Allowed pub/sub channel names. `['*']` = all channels. */
  channels: string[];
  /** Spend ceiling in USD. `null` = unlimited; a number is the hard cap. */
  budgetUsd: number | null;
}

export type EnvelopeAction =
  | { kind: 'fs'; op: 'read' | 'write'; path: string }
  | { kind: 'tool'; name: string }
  | { kind: 'skill'; name: string }
  | { kind: 'mcp'; name: string }
  | { kind: 'backend'; name: string }
  | { kind: 'channel'; name: string }
  | { kind: 'spend'; amountUsd: number; priorUsd?: number };

export interface EnvelopeVerdict {
  allowed: boolean;
  /** Operator-readable explanation of the verdict. */
  reason: string;
  /** Which envelope dimension governed the verdict (for shown-to-user UX). */
  boundary:
    | 'filesystem'
    | 'tools'
    | 'skills'
    | 'mcps'
    | 'backends'
    | 'channels'
    | 'budget'
    | 'membership'
    | 'unknown';
}

const WILDCARD = '*';

// ─── Constructors ──────────────────────────────────────────────────────────────

/** The deny-all envelope: every dimension closed, zero budget. The default. */
export function emptyEnvelope(): HarborEnvelope {
  return {
    filesystem: [],
    tools: [],
    skills: [],
    mcps: [],
    backends: [],
    channels: [],
    budgetUsd: 0,
  };
}

/** The explicit opt-out: every dimension wide open, unlimited budget. */
export const OPEN_ENVELOPE: HarborEnvelope = Object.freeze({
  filesystem: [WILDCARD],
  tools: [WILDCARD],
  skills: [WILDCARD],
  mcps: [WILDCARD],
  backends: [WILDCARD],
  channels: [WILDCARD],
  budgetUsd: null,
}) as HarborEnvelope;

/** Coerce any value to a string allowlist, dropping non-strings. */
function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

/**
 * Normalize untrusted input (DB JSON, request body) into a valid envelope.
 * Anything missing or malformed becomes deny-all — never allow-all.
 */
export function parseEnvelope(raw: unknown): HarborEnvelope {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return emptyEnvelope();
  }
  const obj = raw as Record<string, unknown>;

  let budgetUsd: number | null;
  if (obj.budgetUsd === null) {
    budgetUsd = null; // explicit unlimited
  } else if (typeof obj.budgetUsd === 'number' && Number.isFinite(obj.budgetUsd) && obj.budgetUsd >= 0) {
    budgetUsd = obj.budgetUsd;
  } else {
    budgetUsd = 0; // missing/garbage → deny-all spend
  }

  return {
    filesystem: toStringList(obj.filesystem),
    tools: toStringList(obj.tools),
    skills: toStringList(obj.skills),
    mcps: toStringList(obj.mcps),
    backends: toStringList(obj.backends),
    channels: toStringList(obj.channels),
    budgetUsd,
  };
}

// ─── Enforcement ──────────────────────────────────────────────────────────────

function allow(boundary: EnvelopeVerdict['boundary'], reason: string): EnvelopeVerdict {
  return { allowed: true, reason, boundary };
}
function deny(boundary: EnvelopeVerdict['boundary'], reason: string): EnvelopeVerdict {
  return { allowed: false, reason, boundary };
}

/** Exact-match allowlist check with wildcard support. */
function admits(list: string[], name: string): boolean {
  return list.includes(WILDCARD) || list.includes(name);
}

/**
 * Resolve symlinks on the deepest *existing* ancestor of `p`, then re-append the
 * not-yet-existing tail. Never throws. For a path whose ancestors don't exist
 * (e.g. in CI), this degrades to a plain lexical `resolve`.
 *
 * This defeats the obvious symlink-bypass: a symlink that exists *inside* a root
 * but points *outside* it resolves to its real (outside) location here, so the
 * containment compare below sees the escape. Purely lexical resolution would
 * not.
 */
function realResolveLenient(p: string): string {
  const abs = resolve(p);
  const tail: string[] = [];
  let cur = abs;
  for (;;) {
    try {
      const real = realpathSync(cur);
      return tail.length ? resolve(real, ...tail) : real;
    } catch {
      const parent = dirname(cur);
      if (parent === cur) return abs; // reached fs root unresolved → lexical
      tail.unshift(basename(cur));
      cur = parent;
    }
  }
}

/**
 * Is `target` contained within `root`? Both are resolved to absolute form *with
 * symlinks followed on existing ancestors*; a target equal to or beneath the
 * root is contained. Traversal that escapes the root (`relative` starts with
 * `..`), a path-prefix sibling (`/x/port-daddy-evil` vs root `/x/port-daddy`),
 * or a symlink that points outside the root are all NOT contained.
 *
 * SECURITY NOTE: this is a policy check — necessary but NOT sufficient on its
 * own. It is subject to TOCTOU (a path can be swapped for a symlink between this
 * check and the actual open). The syscall-site enforcement must additionally use
 * an `openat(..., O_NOFOLLOW)`-style guarded open when this envelope is wired to
 * real filesystem operations (ADR-0047 P4+).
 */
function isContained(root: string, target: string): boolean {
  const absRoot = realResolveLenient(root);
  const absTarget = realResolveLenient(target);
  if (absTarget === absRoot) return true;
  const rel = relative(absRoot, absTarget);
  return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * The single enforcement primitive. Given an envelope and a requested action,
 * return an allow/deny verdict with the boundary that governed it.
 *
 * Fail-closed: every path that is not an explicit allow returns a deny.
 */
export function assessEnvelope(env: HarborEnvelope, action: EnvelopeAction): EnvelopeVerdict {
  switch (action?.kind) {
    case 'fs': {
      if (typeof action.path !== 'string' || action.path.length === 0) {
        return deny('filesystem', 'fs action missing a path');
      }
      if (env.filesystem.includes(WILDCARD)) {
        return allow('filesystem', 'filesystem wildcard');
      }
      for (const root of env.filesystem) {
        if (isContained(root, action.path)) {
          return allow('filesystem', `${action.path} is within harbor root ${root}`);
        }
      }
      return deny('filesystem', `${action.path} is outside every harbor filesystem root`);
    }

    case 'tool':
      return admits(env.tools, action.name)
        ? allow('tools', `tool '${action.name}' is in the harbor envelope`)
        : deny('tools', `tool '${action.name}' is not permitted by this harbor`);

    case 'skill':
      return admits(env.skills, action.name)
        ? allow('skills', `skill '${action.name}' is in the harbor envelope`)
        : deny('skills', `skill '${action.name}' is not permitted by this harbor`);

    case 'mcp':
      return admits(env.mcps, action.name)
        ? allow('mcps', `MCP server '${action.name}' is in the harbor envelope`)
        : deny('mcps', `MCP server '${action.name}' is not permitted by this harbor`);

    case 'backend':
      return admits(env.backends, action.name)
        ? allow('backends', `backend '${action.name}' is in the harbor envelope`)
        : deny('backends', `backend '${action.name}' is not permitted by this harbor`);

    case 'channel':
      return admits(env.channels, action.name)
        ? allow('channels', `channel '${action.name}' is in the harbor envelope`)
        : deny('channels', `channel '${action.name}' is not permitted by this harbor`);

    case 'spend': {
      const amount = action.amountUsd;
      const prior = action.priorUsd ?? 0;
      if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
        return deny('budget', 'spend amount must be a finite, non-negative number');
      }
      if (typeof prior !== 'number' || !Number.isFinite(prior) || prior < 0) {
        return deny('budget', 'prior spend must be a finite, non-negative number');
      }
      if (env.budgetUsd === null) {
        return allow('budget', 'harbor budget is unlimited');
      }
      const total = prior + amount;
      return total <= env.budgetUsd
        ? allow('budget', `spend $${amount} keeps total $${total} within $${env.budgetUsd} ceiling`)
        : deny('budget', `spend $${amount} would push total $${total} past the $${env.budgetUsd} ceiling`);
    }

    default:
      return deny('unknown', `unknown envelope action kind '${(action as { kind?: string })?.kind}'`);
  }
}
