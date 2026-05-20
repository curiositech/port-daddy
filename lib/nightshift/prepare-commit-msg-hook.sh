#!/usr/bin/env bash
# Nightshift prepare-commit-msg companion hook.
#
# Appends `Spawned-by: nightshift-runner <run-id>` to the commit message body
# when PD_NIGHTSHIFT_ID is set in the environment. If the trailer is already
# present, no-op. The pre-commit hook verifies the trailer's presence on the
# same commit, so this hook is the producer and pre-commit is the auditor.
#
# Git invokes prepare-commit-msg with arguments:
#   $1 = path to the commit message file
#   $2 = source of the commit (message, template, merge, squash, commit -- empty for default)
#   $3 = commit SHA being amended (only with --amend)
#
# We only modify on default + message + template sources -- never on merge or
# squash to avoid breaking those flows.

set -u

msg_file="${1:-}"
source_kind="${2:-}"
[[ -z "$msg_file" ]] && exit 0
[[ ! -f "$msg_file" ]] && exit 0

RUN_ID="${PD_NIGHTSHIFT_ID:-}"
[[ -z "$RUN_ID" ]] && exit 0

case "$source_kind" in
  merge|squash) exit 0 ;;
esac

# Skip if already present.
if grep -q "^Spawned-by: nightshift-runner ${RUN_ID}" "$msg_file" 2>/dev/null; then
  exit 0
fi

# Append the trailer. Ensure a blank line separator before the trailer block.
{
  cat "$msg_file"
  # Ensure there's a final newline before our trailer line.
  tail -c1 "$msg_file" | od -An -c 2>/dev/null | grep -q '\\n' || echo ''
  echo ''
  echo "Spawned-by: nightshift-runner ${RUN_ID}"
} > "${msg_file}.nightshift-tmp" 2>/dev/null && mv "${msg_file}.nightshift-tmp" "$msg_file"

exit 0
