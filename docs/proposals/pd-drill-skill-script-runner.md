# Proposal: `pd drill` — the governed skill-script runner

Status: proposed. Owner: unassigned. Spawned from binder ch. 27 (W16) and
`pd feedback a2292a14`.

## Why

Skills bundle executable procedures (`scripts/*.py|mjs|sh|ts`) that an agent
should be able to **run and read the verdict of, without loading the script's
source into its context window**. Today that already works one way — the agent
calls `python3 skills/<s>/scripts/x.py` with the Bash tool, and only stdout and
the exit code enter context. The twelve core UI skills now point at
`layout-overflow-guard` exactly this way.

That baseline has four gaps a first-class verb closes:

1. **No governance.** A raw `python3 …` runs outside the daemon's budget/kill
   chain. `pd shipwright` already meters and can kill skill work; ad-hoc script
   runs cannot.
2. **No discoverability.** An agent cannot ask "what runnable scripts does this
   skill expose, and how do I call them?" without reading the SKILL.md.
3. **No cross-runtime parity.** The Bash idiom is Claude/Codex-shell-specific.
   Gemini and future bodies need the same capability through one contract.
4. **No usage signal.** Script invocations are exactly the out-of-band outcome
   label that ch. 27 W9's skill-usage logging needs, and there is nowhere to
   record them today.

Neither windags nor Port Daddy has such a verb. windags's `skill_reference`
does the opposite — it reads a script's *source* into context.

## Name

`pd drill`. A drill is a standing procedure executed on command and reported —
the exact semantics. `drill <skill>/<script>` reads as "run this skill's
procedure." Runner-up considered: `pd rig` (operate equipment; less obviously
"run to completion"). The `pd salvage drill` subcommand (drill *into* raw) is a
different verb sense and namespace; no collision.

## Command surface

```
pd drill <skill>[/<script>] [-- <script args...>]
pd drill <skill> --list            # list this skill's runnable scripts
pd drill --list                    # list all skills exposing runnable scripts
pd drill <skill>/<script> --dry-run  # resolve + print the plan, run nothing
```

Flags: `--json` (wrap output in the result envelope below), `--timeout <s>`
(default from skill manifest, hard cap from daemon policy), `--dry-run`,
`--list`, `--cwd <dir>` (default: the invoking session's worktree).

### Resolution

1. Discover `<skill>` candidates across repo `skills/`,
   `~/.claude/skills`, and `~/.claude/plugins/*/skills`. Exactly one candidate
   must match. Zero matches is not found; multiple matches fail closed with an
   explicit disambiguation error listing every candidate. Root order never
   silently selects one duplicate over another.
2. Resolve `<script>`: if omitted and the skill declares exactly one runnable
   script, use it; else require the name. Scripts are declared in SKILL.md
   frontmatter (`runnable-scripts:`) or, absent that, discovered under
   `scripts/` with a known interpreter extension.
3. Interpreter by extension: `.py`→`python3`, `.mjs`/`.js`→`node`,
   `.ts`→`npx tsx`, `.sh`→`bash`. No `#!`-based arbitrary exec.

### Governance (the point of the verb)

- Runs as a daemon-supervised child, same budget/kill machinery `pd shipwright`
  uses (`lib/shipwright`): a wall-clock timeout, an output-byte cap (spill to a
  blob + pointer past the cap, matching ch. 27 W8), and a kill switch.
- **Allowlist, not denylist.** Only scripts reachable through a resolved skill
  manifest are runnable. No arbitrary path execution; `..` and absolute paths in
  `<script>` are rejected (canonicalize, then verify the path is inside the
  resolved skill dir).
- Network and write scope follow a per-skill capability declaration (default:
  no network, cwd-write only), so a drill can't quietly exfiltrate or roam.
- Every invocation appends a `skill_drill` event to the skill-usage log
  (ch. 27 W9): `{skill, script, args-hash, exit, durationMs, bytesOut,
  session, agent}`. This is the metered substrate W9 needs.

### Output contract

Default: stdout/stderr pass through untouched, process exit code becomes
`pd drill`'s exit code (so it drops into CI gates unchanged). With `--json`:

```json
{
  "skill": "layout-overflow-guard",
  "script": "check_layout.py",
  "exit": 1,
  "durationMs": 4120,
  "bytesOut": 2211,
  "stdout": "…",
  "stdoutBlob": null,
  "truncated": false
}
```

When output exceeds the cap, `stdout` holds the preview and `stdoutBlob` a
capability-scoped pointer (ch. 27 W8) to the full text.

## Agent surface (MCP)

`mcp__port-daddy__skill_drill({ skill, script?, args?, json? })` — the same
resolution, governance, and envelope, so an agent invokes a skill's script
through one tool without reading its source. `skill_drill_list({ skill? })`
mirrors `--list`.

## What changes in the skills

Once `pd drill` ships, the layout-QA block added to the twelve UI skills gains a
governed form (the Bash form stays as the pre-`drill` fallback):

```bash
pd drill layout-overflow-guard -- <file> --widths 1280,1100,860,720,390 --themes light,dark
```

## Registration surfaces (do all up front)

Per the repo's "new CLI command" discipline: `ALL_COMMANDS`, permission tier,
the three shell completions, the command manifest, an e2e test, and the
pr-comments-guard allowlist. Plus the MCP tool registration and a `pd doctor`
check that the skill roots resolve.

## Tests

- Resolve a repo skill, a `~/.claude` skill, and an ambiguous name (error).
- Run `layout-overflow-guard` through `pd drill` against a fixture page; assert
  exit code passes through and a `skill_drill` usage event is logged.
- Reject `../` and absolute `<script>` paths (allowlist).
- Timeout kills a runaway fixture script; output cap spills to a blob.
- `--dry-run` resolves and prints the plan without executing.
- MCP `skill_drill` returns the envelope for the same fixture.

## Non-goals

Not a general shell (only manifest-declared skill scripts run). Not a package
installer (interpreters must already be present; `pd doctor` reports missing
ones). Not a replacement for `pd shipwright` (which runs the *skill*, i.e. an
agent guided by it; `pd drill` runs a skill's *bundled tool*).
