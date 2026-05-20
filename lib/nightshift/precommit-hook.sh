#!/usr/bin/env bash
# Nightshift pre-commit hook.
#
# Installed by the runner into the nightshift worktree's
# `.git/worktrees/<id>/hooks/pre-commit`, NOT into the main repo's .git
# directory. The main repo's existing pre-commit hook is preserved.
#
# Enforces commit-shape rules for autonomous spawns:
#   1. Current branch MUST match `night-shift/*`. Refuse anything else.
#   2. Refuse commits touching > 50 files (probably runaway/rebase loop).
#   3. Refuse commits adding > 5000 LOC (5000 lines added across all files).
#   4. Refuse commits deleting > 100 lines from any single file unless that
#      file contains the literal marker `// ALLOW BIG DELETE` (or the
#      commit message body contains `ALLOW-BIG-DELETE: <reason>`).
#   5. Append a `Spawned-by: nightshift-runner <run-id>` trailer to the
#      commit message via a prepare-commit-msg companion (this hook ALSO
#      verifies that trailer is present on commit).
#
# Variables the runner sets in the spawn environment:
#   PD_NIGHTSHIFT_ID         -- the run id (required for the trailer check)
#   PD_NIGHTSHIFT_MAX_FILES  -- override file-count limit (default 50)
#   PD_NIGHTSHIFT_MAX_ADDED  -- override added-LOC limit (default 5000)
#   PD_NIGHTSHIFT_MAX_DELETED_PER_FILE -- override per-file delete cap (default 100)
#
# Exit codes:
#   0  -- commit allowed
#   1  -- commit refused (with reason on stderr)

set -u

MAX_FILES="${PD_NIGHTSHIFT_MAX_FILES:-50}"
MAX_ADDED="${PD_NIGHTSHIFT_MAX_ADDED:-5000}"
MAX_DELETED_PER_FILE="${PD_NIGHTSHIFT_MAX_DELETED_PER_FILE:-100}"
RUN_ID="${PD_NIGHTSHIFT_ID:-}"

refuse() {
  echo "nightshift-precommit: REFUSED -- $*" >&2
  exit 1
}

# -- 1. branch shape ----------------------------------------------------------
branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')"
case "$branch" in
  night-shift/*) ;;
  HEAD)
    refuse "detached HEAD; nightshift spawns must commit on a night-shift/* branch"
    ;;
  *)
    refuse "branch '${branch}' is not night-shift/* (autonomous spawns may only commit on their own branch)"
    ;;
esac

# -- gather diff stats once ---------------------------------------------------
# We diff against HEAD if HEAD exists; otherwise against the empty tree for
# initial commits.
if git rev-parse --verify HEAD >/dev/null 2>&1; then
  base="HEAD"
else
  base="$(git hash-object -t tree /dev/null)"
fi

# Files in the staged changeset.
file_count="$(git diff --cached --name-only --diff-filter=ACMRTUXB "$base" | wc -l | tr -d ' ')"
if [[ "$file_count" -gt "$MAX_FILES" ]]; then
  refuse "commit touches ${file_count} files (cap: ${MAX_FILES}). Override with PD_NIGHTSHIFT_MAX_FILES=N."
fi

# Added LOC summed across all files. `--numstat` reports added\tdeleted\tpath;
# we sum column 1. Binary files appear as "-\t-\t..." -- skip those.
added_loc="$(git diff --cached --numstat "$base" \
              | awk 'NF==3 && $1 ~ /^[0-9]+$/ { sum += $1 } END { print sum+0 }')"
if [[ "$added_loc" -gt "$MAX_ADDED" ]]; then
  refuse "commit adds ${added_loc} LOC (cap: ${MAX_ADDED}). Likely a runaway diff."
fi

# Per-file deletions. Check ALLOW BIG DELETE marker if exceeded.
# Commit message file is passed as $1 (NOT to pre-commit -- pre-commit gets no
# args), so we read the prepare message via COMMIT_EDITMSG if present.
commit_msg_file=".git/COMMIT_EDITMSG"
# In a worktree, .git is a file pointing to the worktree-specific gitdir.
if [[ -f .git ]]; then
  gitdir="$(git rev-parse --git-dir)"
  commit_msg_file="${gitdir}/COMMIT_EDITMSG"
fi
commit_msg_body=""
if [[ -f "$commit_msg_file" ]]; then
  commit_msg_body="$(cat "$commit_msg_file" 2>/dev/null || echo '')"
fi
has_allow_big_delete_in_msg=0
if [[ "$commit_msg_body" == *"ALLOW-BIG-DELETE:"* ]]; then
  has_allow_big_delete_in_msg=1
fi

while IFS=$'\t' read -r added deleted path; do
  # Skip binary diffs reported as "-".
  [[ "$deleted" == "-" ]] && continue
  [[ -z "$deleted" ]] && continue
  if [[ "$deleted" -gt "$MAX_DELETED_PER_FILE" ]]; then
    # Check the file contents for the marker (post-staging, look at the staged version).
    has_marker=0
    if git show ":${path}" 2>/dev/null | grep -q "ALLOW BIG DELETE"; then
      has_marker=1
    fi
    if [[ "$has_marker" -eq 0 ]] && [[ "$has_allow_big_delete_in_msg" -eq 0 ]]; then
      refuse "file '${path}' deletes ${deleted} lines (cap: ${MAX_DELETED_PER_FILE}). Add a '// ALLOW BIG DELETE' marker in the file OR an 'ALLOW-BIG-DELETE: <reason>' trailer to the commit message."
    fi
  fi
done < <(git diff --cached --numstat "$base")

# -- 5. trailer presence ------------------------------------------------------
# Only enforce trailer when PD_NIGHTSHIFT_ID is set (i.e. we're inside a real
# spawn). Local operator testing without the env var skips this check.
if [[ -n "$RUN_ID" ]] && [[ -n "$commit_msg_body" ]]; then
  if ! grep -q "^Spawned-by: nightshift-runner ${RUN_ID}" <<<"$commit_msg_body"; then
    # The companion prepare-commit-msg hook normally injects this. If it's
    # missing here, either the operator stripped it or the companion didn't
    # run; either way refuse so we don't silently lose forensic provenance.
    refuse "commit message lacks 'Spawned-by: nightshift-runner ${RUN_ID}' trailer. The prepare-commit-msg hook should add this automatically."
  fi
fi

exit 0
