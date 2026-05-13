# Drift Prevention

The auditor catches drift after it happens. Prevention catches it before it
ships. Three mechanisms, in order of leverage.

## 1. Pre-Commit Hook (Local, Fast)

Run the auditor on every skill bundle that has staged changes. Add to the
repo's `.git/hooks/pre-commit` (or extend an existing one):

```bash
#!/usr/bin/env bash
set -euo pipefail

# Find skill bundles touched by this commit.
touched_bundles=$(git diff --cached --name-only --diff-filter=ACMR \
  | awk -F/ '/^skills\// { print $1 "/" $2 }' \
  | sort -u)

if [ -z "$touched_bundles" ]; then
  exit 0
fi

failed=0
for bundle in $touched_bundles; do
  if [ -f "$bundle/SKILL.md" ]; then
    if ! python3 skills/skill-hygiene/scripts/audit_skill_bundle.py "$bundle" --quiet; then
      echo "DRIFT: $bundle — run: python3 skills/skill-hygiene/scripts/audit_skill_bundle.py $bundle"
      failed=1
    fi
  fi
done

exit $failed
```

This is the highest-leverage mechanism: it catches drift the moment it
enters version control, and the fix is local.

## 2. CI Audit (Remote, Authoritative)

Run the auditor across every skill bundle in CI on every PR. Sample step
for GitHub Actions:

```yaml
- name: Audit skill bundles
  run: |
    failed=0
    for bundle in skills/*/; do
      if [ -f "$bundle/SKILL.md" ]; then
        echo "Auditing $bundle"
        if ! python3 skills/skill-hygiene/scripts/audit_skill_bundle.py "$bundle"; then
          failed=1
        fi
      fi
    done
    exit $failed
```

CI is the safety net for hooks that get bypassed (`--no-verify`) or for
authors who haven't installed the hook yet.

## 3. Authoring Convention (Cultural)

The auditor and the hook only work if the convention is shared:

> **When you add a file to a skill, add a row to the directory's INDEX.md
> in the same commit.**

- New `examples/12-something.md` → new row in `examples/INDEX.md`.
- New whole subdirectory → new row in SKILL.md's "Bundled Assets" table
  AND a new `<subdir>/INDEX.md` listing the contents.
- Rename or delete a file → update or remove its INDEX.md row.

Treat the INDEX.md row as part of the file, not as documentation that can
lag behind. Authors who internalize this never trigger drift in the first
place.

## Mirror Discipline

If a skill is mirrored into other tool roots (e.g. `.codex/skills/...`,
`.claude/skills/...`, `.gemini/extensions/.../skills/...`), audit the
**canonical** bundle first, then re-mirror. Don't audit each mirror
independently — that hides the source of drift.

```bash
# Audit canonical
python3 skills/skill-hygiene/scripts/audit_skill_bundle.py skills/<bundle> || exit 1

# Then re-mirror via your mirror script (skill-architect or pd init usually
# handles this).
```

## What Drift Looks Like In The Wild

Real drift modes seen in this repo's history:

- A new `examples/08-*.md` through `examples/11-*.md` were added; the
  `examples/INDEX.md` table was never updated. Every one of them was
  invisible to agents until the audit caught it.
- A new top-level `subagent-fork/` directory was added with 5 docs and an
  INDEX. SKILL.md was never updated to point at the directory's INDEX, so
  none of the docs were reachable.
- An `INDEX.md` listed `pd-fleet.yml` as a row — but the bundle ships
  `pd-fleet.starter.yml` (the user copies it into their repo to create
  `pd-fleet.yml`). The auditor's table-only ghost check ignores prose
  mentions and only flags first-column entries, so this shape no longer
  produces a false positive.

## When The Auditor Is Wrong

The auditor uses a heuristic ("basename appears as a literal string"). It's
not a parser. Two known limitations:

- A file mentioned only as a URL fragment (e.g. `https://.../foo.md`) is
  considered referenced. That's intentional — external refs are valid.
- A file mentioned only by an alias or rename will be flagged as orphan.
  The fix is to mention the actual basename somewhere reachable.

If the auditor produces a false positive on a real bundle, the right move is
to refine the auditor (see `scripts/audit_skill_bundle.py`'s commit history)
rather than to suppress the warning. Suppressions accumulate into the same
drift problem the auditor was built to solve.
