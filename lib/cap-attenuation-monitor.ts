/**
 * Capability Attenuation Monitor — runtime verification of invariant I4.
 *
 * I4 ("delegated capabilities can only be restricted, never expanded") is proven
 * symbolically in `whitepaper/formal/proverif/harbor-card/harbor_card_v5_attenuation.pv` (single-hop) and
 * `harbor_card_v7_multihop_fixed.pv` (per-hop multi-hop). This module is the
 * operational twin: a pure-TS runtime monitor compiling that invariant so the
 * daemon can ENFORCE at runtime what ProVerif proved.
 *
 * Why it exists: the Arbiter's `CAP_ESCALATION` rule (lib/arbiter.ts) is
 * `engine: 'ffi'` and depends on a Rust enforcer. When that binary is absent
 * (dev, test, or a half-booted daemon) the rule silently degrades to "advisory
 * only" — the watchman asleep (runtime-verification-for-agents, Failure Mode 3).
 * This monitor is the TS fallback that keeps capability-escalation actually
 * checked without the native enforcer.
 *
 * Capability grammar (ADR-0027):
 *   - prefix caps `chan:pub:<prefix>` / `chan:sub:<prefix>`: a BROADER prefix
 *     dominates a NARROWER one (attenuation narrows scope). `*` at the value
 *     position dominates every value of that verb.
 *   - exact caps (`spawn:agent`, `presence:write`, `backend:<id>`, …): a cap is
 *     covered only by an identical cap.
 *
 * The monitor OBSERVES and REPORTS; it never mutates state (the Arbiter pattern:
 * remediation is a separate concern).
 */

export interface CapViolation {
  invariant: 'CapAttenuation';
  /** 1-based hop in a chain where the expansion occurred (1 for a single delegation). */
  hop: number;
  /** child capabilities NOT covered by the parent — the expansion. */
  expandedCaps: string[];
  parentCaps: string[];
  childCaps: string[];
}

const PREFIX_VERBS = ['chan:pub:', 'chan:sub:'] as const;

function prefixVerb(cap: string): string | null {
  for (const v of PREFIX_VERBS) if (cap.startsWith(v)) return v;
  return null;
}

/**
 * Is a single child capability conveyed by (covered by) any capability in the
 * parent set? Exact caps require an identical parent cap. Prefix caps require a
 * parent of the same verb whose prefix is at-or-above the child's (broader), or
 * a `*` wildcard for that verb.
 */
export function isCapCovered(child: string, parentSet: string[]): boolean {
  const verb = prefixVerb(child);
  if (!verb) {
    // exact cap: covered only by an identical parent cap.
    return parentSet.includes(child);
  }
  const childPrefix = child.slice(verb.length);
  for (const p of parentSet) {
    if (!p.startsWith(verb)) continue;
    const parentPrefix = p.slice(verb.length);
    if (parentPrefix === '*') return true;                 // wildcard dominates the verb
    if (childPrefix === parentPrefix) return true;          // equal scope
    if (childPrefix.startsWith(parentPrefix + '/')) return true; // child strictly under parent
  }
  return false;
}

/**
 * Does the child capability SET attenuate the parent SET — i.e. is every child
 * capability covered by the parent? Returns the uncovered (expanded) caps.
 */
export function isAttenuation(
  childCaps: string[],
  parentCaps: string[],
): { ok: boolean; expanded: string[] } {
  const expanded = childCaps.filter((c) => !isCapCovered(c, parentCaps));
  return { ok: expanded.length === 0, expanded };
}

/**
 * Check a single delegation parent → child. Returns a violation iff the child
 * claims authority the parent does not convey.
 */
export function checkDelegation(parentCaps: string[], childCaps: string[]): CapViolation | null {
  const { ok, expanded } = isAttenuation(childCaps, parentCaps);
  if (ok) return null;
  return {
    invariant: 'CapAttenuation',
    hop: 1,
    expandedCaps: expanded,
    parentCaps,
    childCaps,
  };
}

/**
 * Check a full delegation chain PER HOP — each link must attenuate its IMMEDIATE
 * parent, never the root. This is the v7 discipline: a verifier that checks only
 * final-vs-root accepts a non-monotonic middle hop (harbor_card_v6 attack).
 * Returns the first offending hop, or null if the whole chain attenuates.
 */
export function checkChain(chain: string[][]): CapViolation | null {
  for (let i = 1; i < chain.length; i++) {
    const { ok, expanded } = isAttenuation(chain[i], chain[i - 1]);
    if (!ok) {
      return {
        invariant: 'CapAttenuation',
        hop: i,
        expandedCaps: expanded,
        parentCaps: chain[i - 1],
        childCaps: chain[i],
      };
    }
  }
  return null;
}

/**
 * Sweep a batch of delegation edges (e.g. stored harbor-card chains) and return
 * every violation. For the Arbiter's periodic audit path.
 */
export function sweepDelegations(
  edges: Array<{ id?: string; parentCaps: string[]; childCaps: string[] }>,
): Array<CapViolation & { id?: string }> {
  const out: Array<CapViolation & { id?: string }> = [];
  for (const e of edges) {
    const v = checkDelegation(e.parentCaps, e.childCaps);
    if (v) out.push({ ...v, id: e.id });
  }
  return out;
}

/**
 * Does a pure-TS attenuation monitor exist? Used by the Arbiter to decide
 * CAP_ESCALATION coverage when the native FFI enforcer is unavailable. Always
 * true once this module is importable — it is the fallback's existence proof.
 */
export const CAP_ATTENUATION_MONITOR_AVAILABLE = true;
