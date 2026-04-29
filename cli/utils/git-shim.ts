/**
 * Git shim installer + content for the `~/.port-daddy/bin/git` wrapper.
 *
 * The shim intercepts destructive git verbs that have no native git
 * pre-hook (`reset --hard`, `checkout -- <path>`, `clean -fd`, `add -A`)
 * before they touch the working tree. For each detected verb the shim
 * calls `pd guard check --git-verb <verb> [--paths <paths>]` and refuses
 * to invoke the underlying git when the guard is in enforce mode and
 * affected files are claimed by other sessions.
 *
 * Why a shim instead of a hook: git ships hooks for `pre-commit`,
 * `post-commit`, `pre-push`, etc., but offers no `pre-reset` or
 * `pre-clean`. The shim is the only place to intervene before the
 * destruction happens.
 *
 * Why a separate file (not inline in guard.ts): keeps the shell script
 * payload as a single readable artifact and lets us version it.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const SHIM_BIN_DIR = join(homedir(), '.port-daddy', 'bin');
export const SHIM_GIT_PATH = join(SHIM_BIN_DIR, 'git');
export const SHIM_VERSION = '1';

export const GIT_SHIM_CONTENT = `#!/usr/bin/env bash
# Port Daddy git shim v${SHIM_VERSION}
# Intercepts destructive git verbs (reset --hard, checkout -- ., clean -fd,
# add -A) and consults the Port Daddy coordination guard before letting
# the underlying git touch the working tree.
#
# Activate by prepending ~/.port-daddy/bin to PATH. Disable temporarily
# with PD_SHIM_OFF=1.
set -euo pipefail

# Find the real git binary, skipping ourselves. We can't trust 'which git'
# alone because PATH may include this directory. Walk PATH manually and
# pick the first git that is *not* this script.
SELF="\${BASH_SOURCE[0]:-$0}"
SELF_REAL=$(cd "$(dirname "$SELF")" && pwd)/$(basename "$SELF")
real_git=""
IFS=':' read -ra parts <<< "\${PATH:-}"
for p in "\${parts[@]}"; do
  if [ -z "$p" ]; then continue; fi
  candidate="$p/git"
  if [ -x "$candidate" ]; then
    candidate_real=$(cd "$(dirname "$candidate")" && pwd)/$(basename "$candidate")
    if [ "$candidate_real" != "$SELF_REAL" ]; then
      real_git="$candidate"
      break
    fi
  fi
done
if [ -z "$real_git" ]; then
  echo "pd-shim: cannot find a real git binary on PATH" >&2
  exit 127
fi

# Operator escape hatch — for emergency, recovery, or guard debugging.
if [ "\${PD_SHIM_OFF:-}" = "1" ]; then
  exec "$real_git" "$@"
fi

# Detect destructive verbs. We use cheap argv pattern matching, not a full
# git arg parser — false positives just consult the daemon, false negatives
# are the failure mode the operator will report.
verb=""
case "\${1:-}" in
  reset)
    for arg in "$@"; do
      if [ "$arg" = "--hard" ]; then verb="reset-hard"; break; fi
    done
    ;;
  checkout|switch|restore)
    for arg in "$@"; do
      if [ "$arg" = "--" ]; then verb="checkout-paths"; break; fi
    done
    ;;
  clean)
    for arg in "$@"; do
      case "$arg" in
        -f*d*|-d*f*|-fd|-df|--force) verb="clean-force"; break ;;
      esac
    done
    ;;
  add)
    for arg in "$@"; do
      if [ "$arg" = "-A" ] || [ "$arg" = "--all" ]; then verb="add-all"; break; fi
    done
    ;;
esac

if [ -n "$verb" ]; then
  if command -v pd >/dev/null 2>&1; then
    if ! pd guard check --git-verb "$verb" --hook >/dev/null 2>&1; then
      echo "pd-shim: $verb refused by Port Daddy coordination guard." >&2
      echo "pd-shim: see 'pd guard status' for current mode." >&2
      echo "pd-shim: bypass once with PD_SHIM_OFF=1 git $*." >&2
      exit 1
    fi
  fi
fi

exec "$real_git" "$@"
`;

export interface ShimInstallResult {
  path: string;
  alreadyInstalled: boolean;
  pathHint: string;
}

export function installGitShim(): ShimInstallResult {
  mkdirSync(SHIM_BIN_DIR, { recursive: true });
  const existing = existsSync(SHIM_GIT_PATH) ? readFileSync(SHIM_GIT_PATH, 'utf8') : '';
  const alreadyInstalled = existing === GIT_SHIM_CONTENT;
  if (!alreadyInstalled) {
    writeFileSync(SHIM_GIT_PATH, GIT_SHIM_CONTENT);
    chmodSync(SHIM_GIT_PATH, 0o755);
  }
  return {
    path: SHIM_GIT_PATH,
    alreadyInstalled,
    pathHint: `Add to your shell rc:  export PATH="${SHIM_BIN_DIR}:$PATH"`,
  };
}

export function uninstallGitShim(): { removed: boolean; path: string } {
  if (!existsSync(SHIM_GIT_PATH)) return { removed: false, path: SHIM_GIT_PATH };
  // Remove the shim file. Keep the directory in case other shims live there.
  try {
    unlinkSync(SHIM_GIT_PATH);
  } catch {
    // Ignore — best effort.
  }
  return { removed: true, path: SHIM_GIT_PATH };
}
