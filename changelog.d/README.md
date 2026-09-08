# `changelog.d/` — one changelog entry per PR

Your changelog entry goes in **its own file here**, not in `CHANGELOG.md`.

`CHANGELOG.md`'s `## [Unreleased]` section is *assembled* from these files at
release time by `scripts/assemble-changelog.mjs`. You never edit `[Unreleased]`
by hand, and the release train deletes the fragments in the same commit that
writes their text into the dated version section.

## Why

`## [Unreleased]` is line 8 of `CHANGELOG.md` and `### Added` is line 10, so
every feature PR inserts its bullet at line 11. 29 of the last 200 commits touch
that file and effectively all of them write those same three lines. Two branches
cut from the same base conflict on nearly every pair — and when a resolver takes
"ours", the other PR's entry is silently dropped. **Nothing fails**: no test reads
`CHANGELOG.md`, and the release gate only greps for a heading, not for content.

One file per PR means two branches never touch the same file. There is no
conflict to mis-resolve, and no branch can carry a stale copy of another branch's
entry.

(`merge=union` in `.gitattributes` is *not* the fix. `.gitattributes`' own header
block records that merge-driver configuration was measured and does not rescue
silent-side-loss, and union merging a changelog interleaves and duplicates entries
without ever conflicting — a quieter version of the same bug.)

## Filename

```
changelog.d/<pr>-<slug>.md        e.g. changelog.d/9754-source-is-text.md
changelog.d/draft-<slug>.md       before you have a PR number
```

`<slug>` is lowercase alphanumerics separated by single hyphens. Rename
`draft-…` to `<pr>-…` once the PR exists — ordering in the assembled section is
derived from the filename alone (PR number ascending, `draft-` last), so no `git
log` call is involved and the order is identical on a shallow CI clone, in a
linked worktree, and in the public mirror.

## Contents

Two lines of header, a blank line, then **the bullet exactly as it should appear
in `CHANGELOG.md`**:

```markdown
type: fixed

- **Source files can no longer go binary to git, repo-wide.** Six files carried literal NUL bytes as join/sentinel separators, which is legal JavaScript that compiles fine but makes git classify the blob as binary … `tests/unit/source-is-text.test.js` is now the guard.
```

Rules the gate enforces (`npm run check:changelog`):

- **Line 1** is exactly `type: <token>`, where `<token>` is one of
  `added`, `changed`, `deprecated`, `removed`, `fixed`, `security`.
  These are the Keep a Changelog sections and nothing else is accepted — no
  synonyms, and the type is never inferred from your branch name or commit
  message. There is deliberately no `docs` / `tests` / `ci` type: a changelog is
  for user-visible change, and a docs-only PR takes the exemption marker below.
- **Line 2** is blank.
- **Line 3 onward** is the body, copied into `CHANGELOG.md` byte-for-byte. It
  must start with `- `, and every line must be either another `- ` bullet or an
  indented `  - ` sub-bullet. No blank lines inside the body, no continuation
  lines (one bullet is one physical line — the file has zero hard wrapping), no
  trailing whitespace, LF endings, exactly one newline at the end.

House style for the prose itself, which the gate does **not** check and a reviewer
does: open with a bolded declarative sentence ending in a period, then several
sentences of mechanism with backticked paths and verbs — name the incident and the
measurement. Read the recent entries in `CHANGELOG.md` before writing yours.

## Commands

```bash
npm run check:changelog                              # validate every fragment
node scripts/assemble-changelog.mjs --print          # preview the assembled section
node scripts/assemble-changelog.mjs --notes 3.30.2   # one release's body, for gh release
```

## When a fragment is required

`scripts/check-pr-requirements.mjs` fails a PR that changes a user-visible surface
(the release train's `DAEMON_PATHSPEC` plus the visual surfaces — see
`scripts/lib/user-visible-surfaces.mjs`) and adds no file here. It auto-skips
tests-only and markdown-only diffs and the release train's own bump commit. If your
change genuinely ships nothing a user would notice, put

```
<!-- changelog-exempt: <reason> -->
```

in the PR body. The reason is required and is visible in the PR, so the exemption
is auditable rather than blank.
