#!/usr/bin/env bash
# Install the skill-hygiene pre-commit guard into the active git hooks dir.
#
# Idempotent: if the guard is already present (detected by the marker
# `>>> Skill Hygiene Audit`), this script does nothing. Otherwise it appends
# the guard to .git/hooks/pre-commit (creating the hook if missing). The
# guard runs the per-bundle auditor on every skill bundle touched by the
# staged set.
#
# Works correctly in linked worktrees: uses `git rev-parse --git-common-dir`
# so the hook lives in the shared hooks directory and all worktrees pick
# it up.
#
# Bypass once with: git commit --no-verify
set -euo pipefail

MARKER_START="# >>> Skill Hygiene Audit"
MARKER_END="# <<< Skill Hygiene Audit"

repo_root() {
  git rev-parse --show-toplevel
}

hook_path() {
  echo "$(git rev-parse --git-common-dir)/hooks/pre-commit"
}

ensure_hook_exists() {
  local hook
  hook=$(hook_path)
  if [ ! -f "$hook" ]; then
    cat > "$hook" <<'STUB'
#!/usr/bin/env bash
# Auto-generated stub for skill-hygiene + future hooks.
set -euo pipefail

STUB
    chmod +x "$hook"
    echo "Created empty pre-commit hook at $hook"
  fi
  # Always ensure executable.
  chmod +x "$hook"
}

already_installed() {
  local hook
  hook=$(hook_path)
  grep -qF "$MARKER_START" "$hook"
}

append_guard() {
  local hook
  hook=$(hook_path)
  cat >> "$hook" <<'GUARD'

# >>> Skill Hygiene Audit
# Audit any skill bundle whose contents are staged. Each touched bundle
# must pass skills/skill-hygiene/scripts/audit_skill_bundle.py.
# Bypass with --no-verify when the drift is intentional and a follow-up
# fix is coming.
HYGIENE_AUDITOR="skills/skill-hygiene/scripts/audit_skill_bundle.py"
if [ -f "$HYGIENE_AUDITOR" ]; then
  touched_bundles=$(git diff --cached --name-only --diff-filter=ACMR \
    | awk -F/ '$1=="skills" && NF>=3 { print $1 "/" $2 }' \
    | sort -u)
  hygiene_fail=0
  if [ -n "$touched_bundles" ]; then
    while IFS= read -r bundle; do
      [ -z "$bundle" ] && continue
      if [ -f "$bundle/SKILL.md" ]; then
        if ! python3 "$HYGIENE_AUDITOR" "$bundle" --quiet; then
          printf 'Skill hygiene drift in %s\n' "$bundle" >&2
          printf '  Run: python3 %s %s\n' "$HYGIENE_AUDITOR" "$bundle" >&2
          hygiene_fail=$((hygiene_fail + 1))
        fi
      fi
    done <<EOF_HYGIENE_LIST
$touched_bundles
EOF_HYGIENE_LIST
  fi
  if [ "$hygiene_fail" -gt 0 ]; then
    printf '\nCommit blocked: %s skill bundle(s) failing the hygiene audit.\n' "$hygiene_fail" >&2
    printf 'If this is intentional, use: git commit --no-verify\n' >&2
    exit 1
  fi
fi
# <<< Skill Hygiene Audit
GUARD
  echo "Appended skill-hygiene guard to $hook"
}

main() {
  cd "$(repo_root)"
  ensure_hook_exists
  if already_installed; then
    echo "skill-hygiene guard already installed in $(hook_path); nothing to do."
    return 0
  fi
  append_guard
  echo
  echo "Installed. Test it: stage a skill change and run \`git commit\`."
  echo "Bypass once with --no-verify if you ever need to."
}

main "$@"
