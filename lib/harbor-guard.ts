/**
 * Harbor Guard — shape validation for the `harbor` identifier.
 *
 * A harbor is meant to be a stable board name ("port-daddy",
 * "myapp:fleet") — the same handful of values a project's writers reuse
 * over and over. But `harbor`/`project` are unauthenticated, caller-
 * supplied free text on most write surfaces (`drop_feedback`,
 * `roadmap.promoteFromFeedback`, `POST /roadmap/items`). When a caller
 * passes a per-run identifier instead — a session id, a PR number, a
 * workflow-run id, an agent id — it gets accepted verbatim and the
 * roadmap/feedback board fragments into dozens of one-off harbors that
 * never accumulate real signal. That is the "harbor split" the Planner
 * pane flags.
 *
 * This module is a STRUCTURAL check on a short, controlled identifier
 * field — it recognizes known ID *shapes* (all-digits, UUID, long hex,
 * `session-`/`agent-`/`run-`/`pr-`-prefixed) — not a semantic classifier
 * over free-form prose. Real project names essentially never collide
 * with these shapes (a project would have to be named a bare integer, a
 * UUID, or end in a long hex run), so the false-positive rate is very
 * low; a caller that legitimately hits one can still pass an explicit
 * `--harbor` that doesn't match the flagged shape.
 */

const SUSPICIOUS_PREFIXES = [
  'session-',
  'agent-',
  'sortie-',
  'run-',
  'pr-',
  'workflow-run-',
  'wf-run-',
  // `wf_<hex>-<n>-<n>` (underscore, not hyphen) is the live workflow-run id
  // shape this codebase actually emits — confirmed against the real durable-
  // home DB while grounding this fix: dozens of `wf_...` harbors, all
  // machine-generated, none a real project name.
  'wf_',
];

/** RFC-4122-shaped UUID, with or without dashes. */
const UUID_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
/** Bare integer — the shape of a PR number, workflow-run id, or issue id. */
const NUMERIC_RE = /^\d+$/;
/** A long hex run (git SHA, short hash suffix) with no other characters. */
const LONG_HEX_RE = /^[0-9a-f]{10,}$/i;
/** Agent/session slugs commonly end in a short hex suffix even after a
 *  human-readable prefix (e.g. "roadmap-dedup-cleanup-script-bdf77f43"). */
const TRAILING_HEX_SUFFIX_RE = /-[0-9a-f]{6,}$/i;

/** True when a single ':'-delimited harbor segment looks like a per-run id. */
export function isSuspiciousHarborSegment(segment: string): boolean {
  const s = segment.trim().toLowerCase();
  if (!s) return true;
  if (NUMERIC_RE.test(s)) return true;
  if (UUID_RE.test(s)) return true;
  if (LONG_HEX_RE.test(s)) return true;
  if (SUSPICIOUS_PREFIXES.some((prefix) => s.startsWith(prefix))) return true;
  if (TRAILING_HEX_SUFFIX_RE.test(s)) return true;
  return false;
}

/**
 * A harbor is `segment` or `segment:segment` (e.g. `myapp:fleet`). The
 * whole value is suspicious if ANY segment looks like a run/session/PR
 * id — a real project name never has a segment shaped like one.
 */
export function isSuspiciousHarbor(harbor: string | undefined | null): boolean {
  if (!harbor) return false;
  return harbor.split(':').some((segment) => isSuspiciousHarborSegment(segment));
}

/**
 * Resolve a harbor from caller-supplied `harbor`/`project` inputs,
 * refusing to accept a value that looks like a per-run id. A rejected
 * `harbor` or `project` falls back to `fallback` (typically the
 * project-derived harbor or the module's DEFAULT_HARBOR) and calls
 * `onReject` so the caller can log/warn — silence is exactly the bug
 * this module exists to close.
 */
export function guardHarborInput(input: {
  harbor?: string;
  project?: string;
  fallback: string;
  harborForProject: (project: string | undefined) => string | null;
  onReject?: (rejected: { field: 'harbor' | 'project'; value: string; usedInstead: string }) => void;
}): string {
  const { fallback, harborForProject, onReject } = input;

  let project = input.project;
  if (project && isSuspiciousHarborSegment(project)) {
    onReject?.({ field: 'project', value: project, usedInstead: fallback });
    project = undefined;
  }
  const projectFallback = harborForProject(project) ?? fallback;

  if (input.harbor) {
    if (isSuspiciousHarbor(input.harbor)) {
      onReject?.({ field: 'harbor', value: input.harbor, usedInstead: projectFallback });
      return projectFallback;
    }
    return input.harbor;
  }
  return projectFallback;
}
