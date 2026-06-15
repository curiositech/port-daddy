/**
 * The Port Daddy first-party caveat grammar (ADR-0053 Appendix A §A.2).
 *
 * Caveats are predicates of the form `<field> <op> <value>` over a small, fixed
 * set of fields the daemon controls. This is a STRUCTURED grammar over known
 * enum fields and operators — not free-text NLP — so exact parsing is correct
 * and complete here (there is no open vocabulary to under-enumerate).
 *
 *   op       = push | api-call
 *   repo     = <repo-id>
 *   branch   = <glob>            (holder may narrow to one branch / a sub-glob)
 *   branch  != <name>           (protected-ref deny; root mints `branch != main`)
 *   host     = <fqdn>           (Layer 2)
 *   spend_usd <= <number>       (Layer 2 ceiling)
 *   expires  = <unix-ms>        (valid while now <= value)
 *   session  = <session-id>
 *
 * Verification is **conjunctive**: every caveat must hold. That conjunction is
 * what makes authority one-directional — appending `spend_usd <= 100` on top of
 * an existing `spend_usd <= 2` cannot broaden anything, because both must hold
 * and the tighter bound wins. `narrows()` exposes the same check for the minting
 * side (the `CAP_ESCALATION` monitor on `feat/cap-attenuation-monitor`).
 */

import type { RequestContext } from './types.js';

export type CaveatField = 'op' | 'repo' | 'branch' | 'host' | 'spend_usd' | 'expires' | 'session';
export type CaveatOp = '=' | '!=' | '<=';

export interface ParsedCaveat {
  field: CaveatField;
  op: CaveatOp;
  value: string;
}

const FIELDS: ReadonlySet<string> = new Set([
  'op',
  'repo',
  'branch',
  'host',
  'spend_usd',
  'expires',
  'session',
]);

/** Which operators are legal for each field. A predicate using a disallowed
 *  operator (e.g. `repo <= x`) is malformed and never satisfiable. */
const FIELD_OPS: Record<CaveatField, ReadonlySet<CaveatOp>> = {
  op: new Set(['=']),
  repo: new Set(['=']),
  branch: new Set(['=', '!=']),
  host: new Set(['=']),
  spend_usd: new Set(['<=']),
  expires: new Set(['=']),
  session: new Set(['=']),
};

// --- Builders --------------------------------------------------------------

export const opCaveat = (op: 'push' | 'api-call') => `op = ${op}`;
export const repoCaveat = (repoId: string) => `repo = ${repoId}`;
export const branchCaveat = (glob: string) => `branch = ${glob}`;
export const denyBranchCaveat = (name: string) => `branch != ${name}`;
export const hostCaveat = (fqdn: string) => `host = ${fqdn}`;
export const spendCeilingCaveat = (usd: number) => `spend_usd <= ${usd.toFixed(2)}`;
export const expiresCaveat = (unixMs: number) => `expires = ${Math.floor(unixMs)}`;
export const sessionCaveat = (sessionId: string) => `session = ${sessionId}`;

// --- Parsing ---------------------------------------------------------------

/**
 * Parse a predicate string. Returns null for anything that isn't a well-formed
 * caveat over a known field with a legal operator. A null parse is treated as
 * unsatisfiable by `checkCaveat` (fail-closed): an unrecognized caveat must
 * never silently pass.
 */
export function parseCaveat(predicate: string): ParsedCaveat | null {
  const trimmed = predicate.trim();
  // Operators are matched longest-first so `!=` / `<=` win over `=`.
  const m = trimmed.match(/^(\S+)\s*(!=|<=|=)\s*(.+)$/);
  if (!m) return null;
  const field = m[1] as CaveatField;
  const op = m[2] as CaveatOp;
  const value = m[3].trim();
  if (!FIELDS.has(field)) return null;
  if (!FIELD_OPS[field].has(op)) return null;
  if (value.length === 0) return null;
  return { field, op, value };
}

// --- Evaluation ------------------------------------------------------------

/** Convert a branch glob (`feat/dom-daddy-*`) to an anchored RegExp. Only `*`
 *  is special (matches any run of non-slash... actually any chars); everything
 *  else is escaped. Branches don't contain regex metacharacters in practice. */
function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

/**
 * Evaluate a single caveat against a request context. Fail-closed: an
 * unparseable caveat, or one whose required context field is absent, returns
 * false. (If a macaroon says `host = x` and the request carries no host, the
 * caveat cannot be shown to hold, so it fails.)
 */
export function checkCaveat(predicate: string, ctx: RequestContext): boolean {
  const c = parseCaveat(predicate);
  if (!c) return false;
  switch (c.field) {
    case 'op':
      return ctx.op !== undefined && ctx.op === c.value;
    case 'repo':
      return ctx.repo !== undefined && ctx.repo === c.value;
    case 'branch':
      if (ctx.branch === undefined) return false;
      return c.op === '!='
        ? !globToRegExp(c.value).test(ctx.branch)
        : globToRegExp(c.value).test(ctx.branch);
    case 'host':
      return ctx.host !== undefined && ctx.host === c.value;
    case 'spend_usd': {
      if (ctx.spendUsd === undefined) return false;
      const ceiling = Number(c.value);
      return Number.isFinite(ceiling) && ctx.spendUsd <= ceiling;
    }
    case 'expires': {
      const exp = Number(c.value);
      return Number.isFinite(exp) && ctx.nowMs <= exp;
    }
    case 'session':
      return ctx.session !== undefined && ctx.session === c.value;
    default:
      return false;
  }
}

/**
 * A checker bound to a request context — pass this as the `checkFirstParty`
 * argument to `verify()`. Evaluates each caveat conjunctively (verify() already
 * ANDs the results across the chain).
 */
export function makeChecker(ctx: RequestContext): (predicate: string) => boolean {
  return (predicate) => checkCaveat(predicate, ctx);
}

/**
 * The attenuation monitor (`CAP_ESCALATION`): does appending `candidate` to a
 * macaroon that already carries `existing` caveats *narrow* authority, or does
 * it attempt to broaden? Returns true iff the candidate cannot broaden anything.
 *
 * The macaroon chain already makes removal impossible; this catches the subtler
 * intent of adding a *looser* bound on a field that's already bounded (e.g.
 * `spend_usd <= 100` when `spend_usd <= 2` is present). Such an add is harmless
 * at verify time (conjunction keeps the tighter bound) but is a broadening
 * *attempt* the monitor should flag rather than silently accept.
 */
export function narrows(existing: string[], candidate: string): boolean {
  const cand = parseCaveat(candidate);
  if (!cand) return false; // unparseable → reject
  for (const e of existing) {
    const prev = parseCaveat(e);
    if (!prev || prev.field !== cand.field) continue;
    // Numeric ceilings: a new ceiling must be <= the existing one.
    if (cand.field === 'spend_usd') {
      if (Number(cand.value) > Number(prev.value)) return false;
    } else if (cand.field === 'expires') {
      // A new expiry must be sooner-or-equal (you may shorten, never extend).
      if (Number(cand.value) > Number(prev.value)) return false;
    } else if (cand.op === '=' && prev.op === '=') {
      // Equality fields (op/repo/host/session): re-asserting the same value is
      // fine; asserting a *different* value would create an unsatisfiable AND
      // (which is not broadening — it's self-denial — so allow it, the chain is
      // still sound), but a contradictory re-bind on `repo`/`session` is almost
      // always a bug, so flag it.
      if (cand.value !== prev.value) return false;
    }
  }
  return true;
}
