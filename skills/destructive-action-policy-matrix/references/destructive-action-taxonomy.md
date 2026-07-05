# Destructive Action Taxonomy

Use this when classifying a new action into a category and tier, or when deciding whether an existing classification is still correct after a tool surface changes.

## The three tiers

| Tier | Meaning | Human round-trip? | Denial evidence required |
| --- | --- | --- | --- |
| `block` | Automatically denied. The action never reaches a human — it is refused at the pre-tool gate every time. | No | Receipt + transcript event + safe alternative |
| `approve` | Held for a human gate decision before it runs. | Yes | Receipt + transcript event (safe alternative optional — the human's decision *is* the alternative path) |
| `allow` | Proceeds without a gate. | No | None required |

A tier is a property of the *action*, not of the current agent or session. Two different bodies attempting `git push --force` to `main` both hit the same `block` policy; the policy matrix does not get more permissive because the caller "seems trustworthy this time."

## The five categories

| Category | What it covers | Canonical block-tier examples | Canonical approve-tier examples |
| --- | --- | --- | --- |
| `git` | Version-control operations that can destroy history or working-tree state. | `git reset --hard`, `git clean -fd`, `git push --force` to a protected branch, `git branch -D` on an unmerged branch | `git push --force-with-lease` (safer, still risky enough to hold) |
| `filesystem` | Writes/deletes outside the intended output surface. | `rm -rf` outside the worktree/jail root, overwriting a file outside the declared output paths, writing to `~/.ssh`, `~/.aws`, launch agents, cron, git hooks | `rm -rf` inside the jail root but outside the specific task's declared scope |
| `network` | Outbound egress that could exfiltrate data or reach an internal/metadata endpoint. | Any request to a literal cloud-metadata address (`169.254.169.254`, etc.) — see `sandboxed-adversarial-test-harness` for the underlying containment mechanics | A first-time outbound request to a host not on the existing allowlist |
| `shell` | Arbitrary command execution, especially with agent-authored strings interpolated into a shell. | Shell interpolation of untrusted/agent-authored strings (`sh -c "$AGENT_STRING"`), unrestricted `eval` | A fixed-argv command whose arguments include agent-authored values not yet validated |
| `github` | Actions against the hosted repo/PR/issue surface. | `gh repo delete`, `gh pr merge --admin` past a failing required gate (see `agent-pr-authoring`'s `admin-bypass-skips-required-gate`), force-pushing a shared branch | `gh pr merge` on a PR with unresolved high-severity review threads |

Do not extend this taxonomy by improvisation mid-audit. If an action doesn't fit one of the five categories, that is itself a finding — decide deliberately whether to extend the taxonomy or reclassify the action, and update this file when you do.

## Choosing a tier: the decision test

Ask, in order:

1. **Is the action irreversible or does it destroy state a human would want back?** If yes and there is no safe, narrower equivalent → `block`.
2. **Is the action reversible in principle but risky enough that a human should see it before it runs?** → `approve`.
3. **Neither of the above** → `allow`.

An action that *could* be irreversible depending on runtime state (e.g. `rm -rf` on a path that might or might not be inside the jail root) should be classified by its *worst case*, not its typical case. Fail closed on classification the same way the audit fails closed on evidence.

## Common misclassification traps

- **"It's usually fine" reasoning.** `git push --force-with-lease` is safer than `--force`, but it is not `allow` — it can still overwrite another agent's unseen commits. Tier by worst case, not common case.
- **Category creep.** A `gh pr merge --admin` bypass is a `github` action even though its effect (skipping a required CI gate) is really about the `git`/CI surface. Classify by which surface's API executes the action, not by which surface is ultimately affected.
- **Silent allow-by-default for new tools.** When a new MCP tool or CLI is added, it inherits no tier automatically. Its actions are unclassified until someone adds them to the matrix — an unclassified action is not implicitly `allow`.
