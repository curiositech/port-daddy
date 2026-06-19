# Fleet Loop Runbook — Day One

> The autonomous-fleet loop: from "operator tags a roadmap item" to "PR is
> merged on `origin/main`" without a human keystroke between.  This runbook
> is the operator's first-night guide.  Companion script:
> `scripts/fleet-loop-smoke.sh`.

---

## Loop architecture

```mermaid
flowchart LR
    OP[Operator]
    RM[(roadmap_items)]
    POP[roadmap-popper<br/>actor]
    DQ[(dispatches<br/>queue)]
    RN[dispatch runner]
    SH[Ship<br/>tenderfoot / spider / …]
    PR[GitHub PR]
    AD[adversarial<br/>reviewer ship]
    HM[harbormaster<br/>actor]
    MAIN[(origin/main)]
    CG[cartographer]
    NS[FleetBar / Nightshift<br/>tab]
    GH[GitHub App<br/>webhook receiver]

    OP -- tags 'nightshift-eligible' --> RM
    RM -- popper cron --> POP
    POP -- pd dispatch propose --> DQ
    DQ -- pd dispatch run --> RN
    RN -- spawns --> SH
    SH -- pushes branch --> PR
    PR -- triggers --> AD
    AD -- comment / label --> PR
    PR -- review_pending --> NS
    NS -- pd review --accept --> DQ
    DQ -- accepted --> HM
    HM -- merges --> MAIN
    MAIN -- updates --> CG
    CG -- marks done --> RM
    GH -. webhook .-> POP
    GH -. webhook .-> HM
```

Plain prose, same path:

1. **Operator intent.**  Operator marks a roadmap item `nightshift-eligible`.
2. **Popper.**  The roadmap-popper actor wakes on a cron, finds eligible
   items, and calls `pd dispatch propose` for each.  Each item becomes a
   row in the `dispatches` table in state `proposed`.
3. **Runner.**  The dispatch runner claims `proposed` rows, carves a
   worktree off the configured base branch, and spawns a ship (Claude
   Code / Codex / etc.) with a tightly-scoped goal.  The state goes
   `proposed → claimed → in_progress → produced` as it works.
4. **Ship.**  The ship writes code, commits, pushes a branch, opens a
   PR.  GitHub triggers the **adversarial reviewer ship** which reads the
   diff and either approves or files objections as comments.
5. **Review.**  When the worker finishes, dispatch goes to
   `review_pending`.  FleetBar's Nightshift tab surfaces it; operator
   hits **Approve** (or `pd review <id> --accept`).
6. **Harbormaster.**  On accept, the dispatch transitions to `accepted`.
   The harbormaster actor — the only writer allowed to push to `main` —
   picks it up, fast-forwards `main`, deletes the branch, and writes
   `settled`.
7. **Cartographer.**  The cartographer sees the new commit on `main`,
   reads the linked roadmap item, and marks it `done`.  Loop closes.
8. **Webhook receiver** (Cloudflare Worker, PR #172) forwards GitHub
   events back into the daemon so the popper / harbormaster can react to
   merge conflicts, CI failures, and external reviewer comments.

---

## a. Pre-merge checklist

The loop is the *integration* of work landing across several open PRs.
Until all of these merge, the loop is partial; the smoke script will
clearly mark unavailable verbs as `SKIP`.

| PR   | What it provides                                          | Depends on |
| ---- | --------------------------------------------------------- | ---------- |
| #146 | GitHub App scaffold + auth (`apps/github-app-fleet/`)     | —          |
| #172 | Cloudflare Worker webhook receiver                        | #146       |
| #143 | Dispatch / nightshift queue + runner                      | —          |
| #163 | Dispatch state machine + `pd review --accept/--reject`    | #143       |
| #161 | Destructive-git-ban shim (harbormaster uses this)         | —          |
| #160 | `pd done` requires-PR discipline                          | —          |
| #140 | Fleet transcripts                                         | —          |
| #132 | Fleet retool: ships + GitHub-surface outputs              | —          |

Plus, landing in the same window:

- **Harbormaster** — `lib/harbormaster.ts` + the harbormaster actor migration.
- **Roadmap-popper** — pulls tagged roadmap_items into the dispatch queue.
- **FleetBar Nightshift surface** — operator UI for accept/reject.

A loop is only operational once `#146 + #172 + #143 + #163 + harbormaster
+ popper + nightshift-UI` are all on `origin/main`.

You can verify this in one shot:

```bash
./scripts/fleet-loop-smoke.sh
# Look for "SKIP: pd dispatch / pd review / pd harbormaster / pd popper".
# When every step prints OK (not SKIP), the loop is integrated.
```

---

## b. Post-merge configuration

After the PRs above merge and you've rebuilt the daemon
(`brew upgrade port-daddy` or `npm run build && pd restart`), do the
following once.

### 1. Environment variables

The GitHub App + CLI backends each read env vars at daemon start:

```bash
# in ~/.config/port-daddy/env (or equivalent — pd reads this on start)
GITHUB_APP_ID=…                 # numeric app id from github.com/settings/apps
GITHUB_APP_PRIVATE_KEY="…"      # PEM, one line, \n-escaped or quoted
GITHUB_APP_INSTALLATION_ID=…    # numeric installation id
PD_USE_CLI_BACKEND=claude-code  # default backend; cli:codex also valid
```

Restart the daemon after editing: `pd restart`.

### 2. Migrations

Run:

```bash
pd db migrate         # or whatever the resolved verb is per #143
```

Expected: `083_dispatches.sql`, `084_harbormaster_actor.sql`, and
`085_roadmap_items_dispatch_id.sql` (or equivalent names; the manifest
the popper PR carries is the source of truth) all applied.

Verify:

```bash
pd dispatch list      # should succeed, empty table is fine
```

### 3. Seed the popper

Tag two or three roadmap items as eligible.  The popper looks for the
tag `nightshift-eligible`:

```bash
pd roadmap tag <item-id> nightshift-eligible
```

Start small — one item — on the first night.

### 4. Start the bodies

Two background actors run continuously:

```bash
pd harbormaster start   # serializes merges
pd popper start         # cron that fires propose() on eligible items
```

Check both are alive:

```bash
pd harbormaster status
pd popper status
```

### 5. Deploy the webhook receiver

```bash
cd apps/github-app-receiver
wrangler deploy
```

Wrangler prints the deployment URL (e.g.
`https://github-app-receiver.<account>.workers.dev`).  Paste that into
**Webhook URL** under your GitHub App settings on github.com.  Don't
forget to set the same secret in both places (the App's settings page
and `wrangler secret put GITHUB_APP_WEBHOOK_SECRET`).

---

## c. The first night

Suggested order:

1. **Pre-flight.**  Run `./scripts/fleet-loop-smoke.sh` (default mode).
   Every step should print **OK**.  Any `FAIL` is a blocker; any `SKIP`
   means a PR is still open.

2. **Tag exactly one benign roadmap item.**  Pick something small — a
   README typo, a missing copyright header, a stale link.  Goal:
   confirm the wiring, not stress the loop.

   ```bash
   pd roadmap tag <item-id> nightshift-eligible
   ```

3. **Set the popper to fire soon.**  By default the popper runs every
   4 h.  For the first run, shorten the interval:

   ```bash
   pd popper start --rate=5m
   ```

4. **Open FleetBar → Nightshift tab.**  Watch the dispatch row appear
   (`state: proposed`) and walk through `claimed → in_progress →
   produced → review_pending`.  This typically takes 3–15 minutes for a
   trivial change.

5. **Review.**  In the Nightshift tab, hit **Approve** on the PR.
   Equivalent CLI: `pd review <id> --accept`.

6. **Watch harbormaster merge.**  Run `pd harbormaster status` in
   another shell.  When the dispatch reaches `settled`, the PR is
   merged on `origin/main`.

7. **Confirm cartographer closed the loop.**

   ```bash
   pd dispatch show <id>          # state=settled, resultArtifact=<pr url>
   pd roadmap get <item-id>       # status=done
   git fetch origin && git log origin/main --oneline -3
   ```

If all four signals line up, the loop works.  Restore the popper rate to
something saner (`pd popper start --rate=4h`) and walk away.

---

## d. Steady state

### Pop rate suggestions

| Tempo        | Rate    | Comment                                    |
| ------------ | ------- | ------------------------------------------ |
| Conservative | on-demand only | Run `pd popper kick` manually after lunch |
| Normal       | every 4h | Default. ~6 dispatches/day at most.       |
| Aggressive   | every 1h | Only with `daily_cap_usd` set per ship.   |

### Per-ship daily caps

Set in the ship registry (cartographer maintains it):

```yaml
ships:
  tenderfoot:
    daily_cap_usd: 5.00
  spider:
    daily_cap_usd: 2.00
```

The runner refuses to spawn a dispatch on a ship that has exceeded its
daily cap; the dispatch transitions to `salvage` with a clear reason.

### When to pause the loop

- **Release week.**  Anything that touches the published Homebrew tap
  should land deliberately, not autonomously.
- **Conference travel / weekend without coverage.**  If you cannot
  respond to a `review_pending` notification within ~12 h, halt.
- **Cartographer drift.**  If roadmap items are not closing on merge,
  the loop is producing PRs nobody is reconciling.  Halt and audit.

```bash
pd nightshift halt        # operator-visible "I'm pausing the loop" verb
pd popper stop            # stop accepting new dispatches
pd harbormaster stop      # finish in-flight merges, then quit
```

### Retire a failing ship

If `spider` is producing low-quality PRs:

1. `pd ship status spider` — confirm fail rate.
2. `pd ship retire spider --reason "low-quality output, pending retraining"`.
3. The cartographer marks it ineligible; popper skips items routed to it.

---

## e. The kill switches

In order of escalation:

| Switch                                | Effect                                       | Survives daemon restart? |
| ------------------------------------- | -------------------------------------------- | ------------------------ |
| `pd nightshift halt`                  | Graceful: drain in-flight, refuse new        | No                       |
| `pd popper stop`                      | No new dispatches; existing ones complete    | No                       |
| `pd harbormaster stop`                | No more merges; queue piles up at `accepted` | No                       |
| `touch ~/.pd/nightshift-disabled`     | Hard stop; popper + runner + harbormaster all refuse on boot | **Yes** |
| GitHub label `nightshift:do-not-merge` | Per-PR opt-out; harbormaster respects it    | Yes (the label persists) |

The flag file is the nuclear option — it sticks across reboots and is
the right answer if you don't trust state in the daemon.  Remove with
`rm ~/.pd/nightshift-disabled`.

---

## f. Honest failure modes

Loop failures we've already encountered or expect.  None of these are
hypothetical — each maps to a real incident or known limitation:

- **Cloudflare 7000 + spider failure modes.**  See PR #158.  When the
  spider ship hits a `Cloudflare 7000 — backend not connected` error,
  the receiver retries.  The dispatch will look stuck at
  `in_progress` for the full timeout.  Mitigation: shorter timeouts on
  spider, or route those items to a different ship.

- **`@octokit/auth-app` clock skew.**  See `apps/github-app-fleet/lib/auth.ts`
  in PR #146 — it pins JWT iat/exp tolerance.  If the host clock drifts
  more than ~60s, App-authenticated requests 401.  Mitigation: install
  `chrony` or rely on macOS `timed`; the receiver logs `iat skew`
  warnings.

- **Stale brewed daemon.**  CLI-tube backends (`PD_USE_CLI_BACKEND`)
  only exist on 3.15.0+.  3.14.x will report `Unknown command: backend`
  and the runner will fall back to its default — which on 3.14.x
  doesn't include the CLI backends at all.  Run `pd --version`; if it
  starts with `3.14`, do `brew upgrade port-daddy`.

- **Webhook receiver down.**  The fleet still produces outbound work
  (push branches, open PRs), but it cannot **react** to events
  (external reviewer approval, CI green/red, label changes).  Dispatch
  rows sit at `produced` until manually transitioned.  Mitigation:
  `wrangler tail` on the receiver and an uptime monitor.

- **Roadmap item with a poisoned goal.**  An item that asks the ship
  for something it cannot finish in a single PR — "Refactor the
  permissions system" — burns budget without producing a mergeable
  artifact.  Mitigation: keep the `nightshift-eligible` tag for items
  the operator believes are one-PR-sized.  Tag conservatively.

- **Coordination Guard not enforcing.**  If `pd guard status` returns
  anything but `enforce`, the shim does not block destructive git ops.
  Re-install: `pd guard install --mode enforce`.

---

## Appendix — the smoke script in one line

```bash
# Safe (default) — no spawn, just verifies the verbs respond:
./scripts/fleet-loop-smoke.sh

# Real run — actually fires one benign dispatch end-to-end:
./scripts/fleet-loop-smoke.sh --really-run

# Custom goal / budget:
./scripts/fleet-loop-smoke.sh --really-run \
  --goal="Add CODEOWNERS entry for docs/operator" \
  --budget=1.00 --timeout=900
```

Each step's stdout/stderr lands under
`$HOME/coding/tmp/fleet-loop-smoke-<pid>/`, including the JSON shape of
`propose`, `show`, and `run --dry-run` — useful for filing bug reports
without re-running.
