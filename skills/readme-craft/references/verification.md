# Verification — designing a README accuracy gate

A freshness gate and an accuracy gate solve different problems and neither substitutes for
the other.

- A **freshness gate** fires when a watched source file changes without a README change.
  It answers "did you *consider* the README?" It cannot tell whether the resulting README
  is true, and it has a well-known failure mode: because the cheapest way to satisfy it is
  to add something, it drives monotonic README growth.
- An **accuracy gate** parses the README and checks its claims against the code. It answers
  "is the README true *right now*?" It fires without anyone touching the README, which is
  the case that matters, because drift mostly happens through renames and removals
  elsewhere.

Ship both. The freshness gate belongs at commit time (fast, local, advisory-ish). The
accuracy gate belongs in CI and should be release-blocking.

## The verification tiers

Every fenced block gets a tier, declared inline as a `readme-verify:` comment on the first
line of the block, or inherited from a file-level default.

| Tier | Meaning | Cost | Use for |
|---|---|---|---|
| `run` | The block executes in CI; a non-zero exit fails the build | High | The quick start, and any block a reader will paste first |
| `surface` | Every command, subcommand, and flag resolves against the tool's registry | Low | The default for most CLI blocks |
| `skip` | Deliberately not checked; requires a stated reason | Zero | Pseudocode, placeholders, output-only blocks, other languages |

`surface` is the workhorse. It is cheap enough to run on every commit, needs no daemon and
no fixtures, and catches the dominant real-world failure: a verb or flag that was renamed
or removed while the README kept describing it. `run` is expensive and flaky-prone; reserve
it for the handful of blocks whose failure would strand a first-time user.

A `skip` with no reason is itself a finding. The reason is what stops `skip` from becoming
the default that swallows the gate.

## Fence extraction

Parse, do not regex the whole file. The rules that matter:

- Track fence delimiters properly: a block opened with ```` ```` ```` closes only on a
  matching or longer run of backticks. Nested fences inside documentation-about-markdown
  are common and a naive `^```` scan will mis-pair them.
- Record the source line number of every block. A finding without a line number costs the
  reader more than it saves.
- Skip blocks inside HTML comments and inside `<details>` only if you have decided to —
  usually you have not; collapsed content is still content a reader will paste.
- Capture the info string (`bash`, `ts`, `json`) — it selects the checker.

## Surface-checking a CLI

The check is only as good as its registry. Use the same registry the CLI itself uses, never
a hand-maintained list, or the gate becomes one more thing that drifts.

For each candidate command line in a `bash` block:

1. Strip shell noise: leading `$`, comments, `sudo`, environment-variable prefixes
   (`FOO=bar cmd`), and the right-hand side of a pipe if it is a different tool.
2. Skip any line that is not an invocation of the project's own binary.
3. Resolve the verb, then the subcommand, against the registry. Unknown verb is an error;
   suggest the nearest known verb by edit distance, because the overwhelmingly common cause
   is a rename.
4. Resolve long flags (`--foo`) against that verb's declared flags. Treat an unknown flag
   as an error, and unresolvable-because-the-verb-declares-nothing as a skip, not a pass —
   silently passing a check that could not run is how gates become theater.
5. Substitute obvious placeholders (`<id>`, `abc123`, `myapp`) rather than failing on them.

## What else the gate should check

- **Every image path resolves** from the repository root. This is a one-line check and it
  catches the highest-severity defect available.
- **Every relative link resolves** to a file that exists. Anchor links (`#section`) resolve
  to a heading that exists.
- **The first sentence still matches the architecture doc of record.** This one cannot be
  fully automated, but it can be *prompted*: fail when the architecture doc's mtime is newer
  than the README's opening block, and require an explicit acknowledgment.
- **Budget ceilings.** Length, fence count, section count. A gate that enforces a maximum
  is the counterweight that stops a freshness gate from producing monotonic growth.

## CI wiring

Make it release-blocking, not merely PR-blocking, when the README is a distribution
artifact — it ships in the npm tarball and renders on the package page, so a broken README
is a shipped defect.

```yaml
- name: README accuracy
  run: node scripts/check-readme-accuracy.mjs --ci
```

Give it three modes:

- default — human-readable findings, non-zero exit on error
- `--json` — machine-readable, for an agent to consume and fix
- `--ci` — no color, no prompts, exit non-zero on error only (warnings do not block)

Separating warnings from errors is what keeps the gate credible. A gate that fails on style
preferences gets bypassed, and once the bypass is habitual it stops catching the real
defects too.

## The agent loop

Once the gate emits `--json`, a scheduled agent can own README upkeep:

1. Run the accuracy gate in JSON mode.
2. If findings exist, load this skill, fix them, and re-run until clean.
3. Open a PR with the findings as the summary and the gate output as the test plan.

The agent must not be allowed to satisfy the gate by deleting the failing example — that
converts a documentation bug into a documentation hole. Constrain it: a fix either corrects
the example or replaces it with a working one, and a deletion requires the capability
genuinely to have been removed, stated in the PR body.
