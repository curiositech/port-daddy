---
name: skill-hygiene
description: "Audit and maintain a skill bundle so every bundled asset is reachable from SKILL.md or its directory's INDEX.md. Use when a skill has accumulated content (references, examples, schemas, scripts, templates, agents, diagrams) that may not be discoverable, when adding new files to a skill, or before publishing a skill bundle. NOT for creating skills from scratch (that's skill-architect) or grading skill quality (that's skill-grader)."
license: Apache-2.0
allowed-tools: Read,Write,Edit,Bash,Grep,Glob
metadata:
  category: Productivity & Meta
  tags: [skill, hygiene, drift, progressive-disclosure, audit, maintenance]
  pairs-with: [skill-architect, skill-grader, skill-creator]
  provenance:
    kind: first-party
    owners: [port-daddy]
  authorship:
    maintainers: [port-daddy]
---

# Skill Hygiene

A skill bundle is a tree of files. Only the ones SKILL.md (or a SKILL-loaded
INDEX.md) names are actually discoverable by an agent at runtime. Files that
are not named are dead weight: they cost disk, they look like they're working,
and they're not.

This skill is for keeping a bundle's reachable surface in sync with what's on
disk — and for catching the drift before it ships.

## NOT For

- Creating new skills. That's `skill-architect`.
- Grading skill quality (clarity, expertise level, examples). That's `skill-grader`.
- Generic doc linting unrelated to skill-bundle structure.
- Fixing prose. The auditor checks reachability, not whether the prose is good.

## When To Use

- A skill has grown several subdirectories and you suspect not all of them are referenced from SKILL.md.
- You added a new file to an existing skill and want to confirm it's discoverable.
- You inherited a skill from another author and don't trust the surface area.
- You're about to publish or mirror a skill and want a clean reachability check first.
- A new INDEX.md was written by hand and may have drifted from the directory.

## The Three Drift Modes

A skill bundle drifts in three ways. The auditor catches all three.

### 1. Orphaned files

A file exists in a subdirectory but no SKILL.md or INDEX.md mentions it. Agents
loading the skill at runtime will never find it. It might as well not be there.

Common causes:
- New leaf doc was added but the directory's INDEX.md wasn't updated.
- File was renamed; the old name still appears in INDEX.md (this is "ghost
  entries" below) but the new name doesn't.
- A whole new subdirectory was added but SKILL.md doesn't reference it at all.

### 2. INDEX drift

An `INDEX.md` lists entries that don't match the directory:
- **missing_from_index**: files on disk the index doesn't mention (the
  orphan's mirror — same problem, viewed from the index side).
- **ghost_entries**: files in the index's table that aren't on disk.
  Filename was changed or deleted; the index wasn't updated.

### 3. Missing INDEX

A subdirectory has multiple bundled files but no `INDEX.md`. SKILL.md has no
hub to point at, so agents either pre-load the whole directory (wasteful) or
skip it entirely (orphans every file inside).

## The Audit Procedure

```bash
python3 skills/skill-hygiene/scripts/audit_skill_bundle.py <path-to-skill-bundle>
```

The script:

1. Walks the bundle, treating each top-level subdirectory as an audit unit.
2. Concatenates SKILL.md plus every INDEX.md into a "reachable text" blob.
3. Flags any non-INDEX file whose basename appears nowhere in that blob → **orphan**.
4. For each existing INDEX.md, checks that every same-directory file appears
   in the index → flags missing entries.
5. For each existing INDEX.md, scans pipe-table first-column backtick-quoted
   filenames; if such a filename isn't on disk anywhere in the bundle, flags
   it as a **ghost entry**.
6. For each subdirectory with >1 file but no INDEX.md → flags **missing INDEX**.

Exit code is `0` if clean, `1` if drift, `2` if the bundle is malformed
(no SKILL.md). Use `--json` for CI integration, `--quiet` to set exit code only.

## Fixing Drift

| Drift | Fix |
|---|---|
| Orphan in a directory that has an INDEX.md | Add the file to INDEX.md with a one-line "when to load" hook. |
| Orphan in a directory that has no INDEX.md | Either create an INDEX.md (preferred when the directory will keep growing) or mention the file directly in SKILL.md. |
| Missing-from-index | Same fix as orphan in directory with INDEX.md. |
| Ghost entry | Either the file should exist (restore it) or the entry is stale (delete the row). Check `git log` for the filename to decide. |
| Missing INDEX | Create one. Use the table format shown in `references/progressive-disclosure.md`. |

## Doctrine

- **SKILL.md is the entry point**, not the encyclopedia. Don't inline what
  belongs in a leaf doc; instead, point at the right INDEX.md with a one-line
  trigger ("when X, open Y").
- **Every subdirectory with more than one file needs an INDEX.md**. The cost
  is one short table; the benefit is discoverability.
- **An INDEX.md row is a contract**: "this file exists, here's when to load
  it." If the file moves, the contract breaks. Run the auditor to catch it.
- **Cross-references are fine**. An INDEX.md can mention a file in another
  directory (e.g. `agents/INDEX.md` mentioning `subagent-fork-template.yaml`).
  The auditor only flags ghost entries when the filename exists nowhere in
  the bundle.

See `references/progressive-disclosure.md` for the full SKILL.md → INDEX.md →
leaf pattern, and `references/drift-prevention.md` for hooking the auditor
into pre-commit and CI.

## Pairing With Other Skills

- After `skill-architect` produces a fresh bundle, run skill-hygiene to confirm
  every file the architect emitted is actually reachable.
- After `skill-grader` flags "this skill could use more examples" and you add
  them, run skill-hygiene to confirm the new examples are surfaced.
- Before mirroring a skill into other tool roots (`.codex/`, `.claude/`,
  `.gemini/extensions/`), audit the canonical bundle first — drift mirrors too.

## Self-Check

```bash
python3 skills/skill-hygiene/scripts/audit_skill_bundle.py skills/skill-hygiene
```

The hygiene skill audits itself. It should always pass; if it doesn't, fix
its own surface area before fixing anyone else's.
