/**
 * Path-containment guard for fleet FILE sinks/triggers (ADR-0093 §Phase-1 hardening).
 *
 * WHY THIS EXISTS: `lib/fleet/outputs/file.ts` expanded a recipient path with
 * `resolve(homedir(), withTokens.slice(2))` for `~/...` and bare `resolve()`
 * for everything else — with NO containment. So a declared output like
 *   file:write(~/notes/../../../etc/cron.d/evil)
 *   file:write(/etc/shadow)
 * escaped the intended directory and wrote anywhere the process could. The
 * file TRIGGER had the same unguarded expansion, letting an agent watch
 * ~/.ssh or /etc by traversal.
 *
 * This module resolves a path, expands `{date}/{time}/{iso}` tokens and `~`,
 * then asserts the result is CONTAINED within an allowed root — and that no
 * symlink in an existing prefix escapes that root (realpath check). Pure except
 * for the optional realpath probe (filesystem read only; never writes).
 *
 * HONEST LIMITATION: TOCTOU between the realpath check and the later write is
 * not fully closed here; the sound fix is open-with-O_NOFOLLOW under a
 * confined root (ADR-0093 §Residual). The containment + realpath check defeats
 * the static-traversal and pre-planted-symlink cases, which are the practical
 * attacks.
 */

// Namespace import (not `import { realpathSync }`): existing tests mock
// 'node:fs' with partial factories; a named binding that the mock omits is a
// link-time SyntaxError. A namespace access degrades to `undefined` instead,
// and we guard for that (the symlink check simply no-ops under a mock).
import * as nodeFs from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, resolve, sep } from 'node:path';

/** Sensitive paths that are refused even when they sit INSIDE an allowed root
 *  — home contains ~/.ssh, ~/Library/LaunchAgents, etc., which are persistence
 *  / credential targets. Mirrors the Coast Guard "crown jewels" denylist. A
 *  match is any of these as a path segment (or segment pair). */
const SENSITIVE_SEGMENTS: readonly string[][] = [
  ['.ssh'],
  ['.aws'],
  ['.gnupg'],
  ['.kube'],
  ['.docker'],
  ['.config', 'gcloud'],
  ['.config', 'systemd'],
  ['Library', 'LaunchAgents'],
  ['Library', 'LaunchDaemons'],
  ['.git', 'hooks'],
];

function hitsSensitiveSegment(resolvedPath: string): boolean {
  const segs = resolvedPath.split(sep).filter(Boolean);
  return SENSITIVE_SEGMENTS.some((needle) => {
    for (let i = 0; i + needle.length <= segs.length; i++) {
      if (needle.every((n, j) => segs[i + j] === n)) return true;
    }
    return false;
  });
}

export class PathEscapeError extends Error {
  readonly code = 'PATH_ESCAPE';
  constructor(message: string) {
    super(message);
    this.name = 'PathEscapeError';
  }
}

export interface PathGuardOptions {
  /** Allowed containment roots. A resolved path must be inside ONE of these.
   *  Defaults to [homedir(), tmpdir(), cwd()] — the operator's normal write
   *  locations. Escapes to /etc, /usr, /root, other users' homes, etc. are
   *  refused; sensitive subpaths within a root (see SENSITIVE_SEGMENTS) are
   *  refused too. */
  roots?: readonly string[];
  /** Substitute {date}/{time}/{iso} tokens. Default true. */
  expandTokens?: boolean;
  /** Inject a fixed clock for deterministic tests. */
  now?: Date;
}

/** Expand {date}/{time}/{iso} tokens using the provided (or current) clock. */
export function expandTokens(input: string, now: Date = new Date()): string {
  const iso = now.toISOString();
  const date = iso.slice(0, 10); // 2026-06-27
  const time = iso.slice(11, 19).replace(/:/g, '-'); // 17-38-16
  return input
    .replace(/\{date\}/g, date)
    .replace(/\{time\}/g, time)
    .replace(/\{iso\}/g, iso.replace(/[:.]/g, '-'));
}

/** True if `child` is `root` itself or strictly inside it (path-segment safe,
 *  so `/home/usr2` is NOT inside `/home/usr`). */
export function isContained(root: string, child: string): boolean {
  const r = resolve(root);
  const c = resolve(child);
  if (c === r) return true;
  const prefix = r.endsWith(sep) ? r : r + sep;
  return c.startsWith(prefix);
}

/**
 * Resolve `input` to a safe, contained absolute path or throw PathEscapeError.
 *
 * Steps (order matters):
 *   1. expand tokens (date/time/iso),
 *   2. expand leading `~`,
 *   3. resolve to an absolute path (collapses `..`),
 *   4. assert containment within an allowed root,
 *   5. realpath the longest existing prefix and re-assert containment, so a
 *      pre-planted symlink can't redirect outside the root.
 */
export function containPath(input: string, opts: PathGuardOptions = {}): string {
  const defaultRoots = [homedir(), tmpdir(), process.cwd()];
  const roots = (opts.roots && opts.roots.length > 0 ? opts.roots : defaultRoots).map((r) => resolve(r));
  const tokened = (opts.expandTokens ?? true) ? expandTokens(input, opts.now) : input;

  let candidate: string;
  if (tokened === '~') candidate = homedir();
  else if (tokened.startsWith('~/')) candidate = resolve(homedir(), tokened.slice(2));
  else if (isAbsolute(tokened)) candidate = resolve(tokened);
  else candidate = resolve(roots[0], tokened); // relative paths resolve under the first root

  const containedLexically = roots.some((root) => isContained(root, candidate));
  if (!containedLexically) {
    throw new PathEscapeError(
      `resolved path escapes the allowed root(s); refusing to touch a path outside [${roots.join(', ')}]`,
    );
  }

  if (hitsSensitiveSegment(candidate)) {
    throw new PathEscapeError(
      `path targets a sensitive location (credentials / persistence dir); refused even inside an allowed root`,
    );
  }

  // Symlink-escape check: realpath the longest existing ancestor and compare
  // it against the REAL roots — the roots themselves may sit under a symlink
  // (e.g. macOS /var -> /private/var, /tmp -> /private/tmp), so comparing a
  // realpath'd child against a lexical root would false-positive.
  const realExisting = realpathOfLongestExistingPrefix(candidate);
  if (realExisting) {
    const realRoots = roots.map((root) => {
      try {
        return nodeFs.realpathSync(root);
      } catch {
        return root;
      }
    });
    if (!realRoots.some((root) => isContained(root, realExisting))) {
      throw new PathEscapeError(`path traverses a symlink that escapes the allowed root(s)`);
    }
  }

  return candidate;
}

/** realpath() the longest existing ancestor of `p` (so we can detect a symlink
 *  in the existing prefix without requiring the leaf to exist yet). Returns
 *  null when realpath is unavailable (mocked fs) — the caller then relies on
 *  the lexical containment check alone. */
function realpathOfLongestExistingPrefix(p: string): string | null {
  if (typeof nodeFs.realpathSync !== 'function') return null;
  let cur = p;
  // Walk up until realpathSync succeeds (some ancestor always exists: `/`).
  for (let i = 0; i < 4096; i++) {
    try {
      return nodeFs.realpathSync(cur);
    } catch {
      const parent = resolve(cur, '..');
      if (parent === cur) return null; // reached filesystem root
      cur = parent;
    }
  }
  return null;
}
