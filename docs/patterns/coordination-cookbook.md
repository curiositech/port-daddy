# Port Daddy Coordination Cookbook

A pattern catalog for composing multi-agent workloads on top of the primitives
Port Daddy already ships. The reader: a senior engineer who has heard the elevator
pitch, has `pd` on their `$PATH`, and now wants to decompose a real workload —
adversarial QA, code-review-as-debate, blackboard research, partitioned refactors —
onto the daemon without inventing a coordination layer from scratch.

The thesis is small: **the daemon does the boring part — leases, claims, durable
notes, pub/sub, salvage — so you can spend your tokens on the parts that matter.**
What follows is a translation guide between the multi-agent literature you already
know (Foundation Models for Multi-Agent Systems, AutoGen, ChatDev, the
critique-refine and debate papers) and the actual flags Port Daddy exposes.

If you are looking for an introduction to the primitives themselves, read
[ADR-0028](../adr/0028-actor-fleet-agent-session-three-layers.md) first; this
document assumes you know that an *actor* is a durable role, a *fleet agent* is
an optional live body, and a *session* is an ephemeral `pd begin` / `pd done`
work-slice.

---

## How to read this catalog

Each entry is built the same way so you can grep, skim, or paste-and-go:

1. **What it is** — the pattern in protocol terms, one paragraph.
2. **PD command sequence** — the actual flags an operator runs.
3. **Primitive mapping** — which PD primitive plays which role.
4. **When to use / When NOT to use** — decision criteria.
5. **Failure mode + PD-native mitigation** — the most likely thing that breaks.
6. **Worked example** — a concrete scenario with end-to-end commands.

Identities in examples follow the project's `<runtime>:<task>` convention
(`claude:auth-rewrite`, `codex:test-gen`, `aider:sweep`). Real worktrees, real
file paths, no placeholder `agent-1`s.

A short glossary, then the patterns.

---

## Primitive cheat sheet (verified against the CLI)

| Primitive     | Verb                                                         | Persistence                                               | Selector                                                     |
| ------------- | ------------------------------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------ |
| Session       | `pd begin` / `pd done` / `pd whoami`                         | DB row, files released on `done`                          | `--identity`, `--purpose`, `--files`, `--agent`              |
| File claim    | `pd session files add` / `pd session files rm`               | DB row scoped to session                                  | `<path>`, `--start-line/--end-line`, `--symbol-path`, `--symbol` |
| Note          | `pd note` / `pd say`                                         | DB row, Merkle-chained per session                        | `--type`, `--session`, `--agent`                             |
| Pub/sub       | `pd pub` / `pd sub` / `pd watch`                             | Ephemeral SSE; messages live on the channel until cleared | `<channel>` (logical or physical), `--signal`, `--sender`    |
| Tube          | `pd tube`                                                    | Same channel storage; long-polling crank-handle           | `--reply`, `--reply-to`, `--send`, `--wait-for`, `--tail`    |
| Tuple space   | `pd tuple out` / `pd tuple rd` / `pd tuple in`               | DB row, optional TTL                                      | `--harbor`, JSON-array pattern, `--limit`                    |
| Inbox (DM)    | `pd inbox send` / `pd inbox` / `pd inbox watch`              | DB row per agent                                          | `--agent`                                                    |
| Actor mailbox | `pd actor <id> --message`                                    | DB row per canonical actor                                | actor id                                                     |
| Spawn         | `pd spawn --backend <b> --identity <id> --budget <usd> -- <task>` | Sub-process; agent registered                             | `--backend`, `--model`, `--tier`, `--budget`, `--purpose`    |
| Watch         | `pd watch <channel> --exec <script>`                         | Long-running SSE subscriber                               | `--once`, `--max-concurrent`, `--timeout`, `--min-interval`  |
| Quorum        | `pd quorum propose` / `pd quorum vote`                       | Durable tuple rows, threshold-driven                      | `--role`, `--threshold`, `--stance`, `--ttl-ms`              |
| Salvage       | `pd salvage` / `pd salvage claim` / `pd salvage complete`    | Reads stale agents, transfers context                     | `--project`, `--bucket`, `--claim`                           |
| Briefing      | `pd briefing` / `pd briefing --json`                         | Writes `.portdaddy/briefing.md`                           | `--full`, `--project`                                        |
| Guard         | `pd guard check --staged`                                    | Pre-commit enforcement                                    | `--hook`, `--mode enforce`                                   |
| Lock          | `pd with-lock <name> <cmd...>`                               | DB row with TTL                                           | `--ttl`, `--owner`                                           |
| Pheromone     | `pd pheromone spray <table> <id> <key> <strength>`           | Decaying scalar                                           | `files` / `services` / `sessions`                            |

That table is the rosetta stone for what follows.

---

# Five topologies

The topology is the *shape of the conversation graph*. Five shapes cover almost
everything practical agents do.

## 1. STAR — one coordinator, N workers

**What it is.** A single coordinator session decomposes the work, hands subtasks
out, gathers results. Workers don't talk to each other; they talk to the
coordinator. This is AutoGen's `GroupChatManager`, ChatDev's CEO, every "lead
agent + tool-using subagents" you've ever written.

**PD command sequence.**

```bash
# Coordinator
pd begin "ship v4.2" --identity claude:lead --lifecycle durable --files docs/ROADMAP.md
pd spawn --backend claude-cli --identity claude:auth-rewrite \
  --purpose "rewrite token refresh" --budget 2.50 \
  -- "Refactor refreshToken() in lib/auth.ts. Acceptance: tests pass, no Date.now()."
pd spawn --backend codex --identity codex:test-gen \
  --purpose "generate missing tests" --budget 1.00 \
  -- "Add unit tests for refreshToken() — must exercise the 401 retry path."
pd spawned                                # poll until both report status=completed
pd done "v4.2 work dispatched"
```

**Primitive mapping.**

- Coordinator state lives in a `pd begin` session; the session id is the star's center.
- Each worker is a `pd spawn` row. The spawner auto-injects PD coordination env vars
  so the spawned agent registers and runs `pd begin` on its own.
- Worker completion shows up in `pd spawned` and in the activity log; the
  coordinator polls instead of being told.

**When to use.** The task naturally decomposes into independent sub-jobs, and
you want one accountable owner who reads all the outputs. Code review with a
human-in-the-loop is a star. So is "run these 12 tests in parallel."

**When NOT to use.** Subtasks need to talk to each other (use mesh). Or the
"coordinator" is just a router — at that point a worker pool driven by tuples
is leaner.

**Failure mode.** Coordinator dies mid-flight, the workers complete, nobody
reads their output. PD's response: `pd salvage --project <name>` shows the
orphan coordinator with its session notes intact; a fresh coordinator can
`pd salvage claim <agent-id>` and pick up the dangling worker results from the
activity log.

**Worked example — "Sharded test suite, 12 packages."**

```bash
# Coordinator
pd begin "shard jest run across 12 packages" --identity claude:test-runner --lifecycle durable

for pkg in apps/* packages/*; do
  pd spawn --backend claude-cli --identity claude:shard-$(basename $pkg) \
    --purpose "run tests in $pkg" --budget 0.40 \
    -- "cd $pkg && npm test --json > .test-out.json; pd note \"shard $pkg \$(jq -r .success .test-out.json)\""
done

# Block until they're all in
until [ "$(pd spawned -j | jq '[.agents[] | select(.status=="running")] | length')" = "0" ]; do
  sleep 5
done

pd notes --type shard --limit 50         # gather the per-shard results
pd done "12-shard run complete"
```

---

## 2. MESH — peers, no central coordinator

**What it is.** Every agent is a peer. There is no privileged "manager"; agents
discover each other through a shared rendezvous (channel, tuple space, actor
mailboxes) and coordinate by leaving signed traces. Useful for genuinely
distributed work where any agent is allowed to grab any unit of work, and the
*ordering* of who-does-what is decided by who-shows-up-first.

**PD command sequence.**

```bash
# Every peer registers and subscribes — symmetric
pd begin "harvest stale TODOs" --identity codex:harvest-${SHARD} --lifecycle durable
pd watch coord:harvest --exec ./peer-tick.sh --max-concurrent 1 &
# inside peer-tick.sh: try to claim a TODO via the tuple space
#   pd tuple in '["todo","pending","*"]' --limit 1 --harbor harvest
#   ...do the work...
#   pd tuple out '["todo","done","'$id'","'$peer'"]' --harbor harvest
```

**Primitive mapping.**

- Rendezvous: a tuple space scoped by `--harbor`, OR a declared channel.
- Mutual exclusion on work units: `pd tuple in` is atomic-take — only one peer
  wins per pattern match.
- Cross-peer announcements: a shared channel (`pd pub coord:harvest …`) plus
  `pd watch coord:harvest --exec …` on every peer.
- Cross-peer durable context: `pd note --type discovery` so the audit trail
  survives any single peer dying.

**When to use.** The work is genuinely homogeneous (every peer can do any
shard), peer count varies at runtime, and you want graceful degradation when
peers die. Crawlers, swarm refactors, harvest jobs.

**When NOT to use.** The work has real dependencies between steps — at that
point you want a tree or a DAG, not a mesh. Also: mesh with two peers is just
two strangers fighting over a tuple; don't bother below three.

**Failure mode.** Two peers race on the same work unit because one of them
forgot to `pd tuple in` (take) and used `pd tuple rd` (read-only) instead. PD's
response: `pd tuple in` is destructive by design — only one of the racing peers
can succeed. If a peer dies *between* taking the tuple and writing the result,
the work item is "leaked" and shows up nowhere; budget for a reaper that
periodically `pd salvage`s peers and re-emits their pending units back into the
tuple space.

**Worked example — "Three peers harvest stale TODO comments from a monorepo."**

```bash
# Seed step (any peer, idempotent)
for f in $(rg -l 'TODO\(stale\)' --type-add 'src:*.{ts,tsx}' -tsrc); do
  pd tuple out "[\"todo\",\"pending\",\"$f\"]" --harbor harvest --ttl 3600000
done

# Each peer (run on three workstations)
pd begin "harvest" --identity codex:peer-$HOSTNAME --lifecycle durable
while true; do
  claimed=$(pd tuple in '["todo","pending","*"]' --harbor harvest --limit 1 -j)
  [ "$(echo $claimed | jq '.taken | length')" = "0" ] && break
  path=$(echo $claimed | jq -r '.taken[0].fields[2]')
  pd session files add "$path"
  ./rewrite-stale-todo.sh "$path" && \
    pd say "harvested $path" --pin --harbor harvest && \
    pd tuple out "[\"todo\",\"done\",\"$path\",\"$HOSTNAME\"]" --harbor harvest
done
pd done "peer $HOSTNAME drained the queue"
```

---

## 3. TREE — hierarchical decomposition with depth > 1

**What it is.** A star where the workers are themselves coordinators. Lead
agent spawns sub-leads, each sub-lead spawns leaf workers. The literature
calls this "hierarchical delegation" or "supervisor of supervisors." It's how
ChatDev's "Designer → Coder → Tester" really runs when each layer can fan out.

**PD command sequence.**

```bash
# Depth-0 lead
pd begin "v5 platform migration" --identity claude:platform-lead --lifecycle durable

# Depth-1 sub-leads spawn from inside the lead
pd spawn --backend claude-cli --identity claude:sublead-frontend \
  --purpose "drive frontend migration" --budget 5.00 \
  -- "You are sub-lead for FE migration. Use pd spawn to fan out per package. Budget 5 USD."

pd spawn --backend claude-cli --identity claude:sublead-backend \
  --purpose "drive backend migration" --budget 5.00 \
  -- "You are sub-lead for BE migration. Use pd spawn for db, api, workers."

# Inside the sub-lead's prompt, the model itself runs pd spawn for its leaves.
```

**Primitive mapping.**

- Each level is a `pd begin` session whose `--identity` encodes the depth:
  `claude:platform-lead` → `claude:sublead-frontend` → `claude:leaf-fe-checkout`.
- Parent/child linkage lives implicitly in the spawn chain (the spawning agent
  is recorded in the activity log) and explicitly via `pd note --type
  delegation` on the parent when it dispatches.
- Aggregation up the tree: each level reads `pd notes --type result --limit 50`
  filtered to the project, and (when needed) re-filters client-side by
  child agent id from the activity log.

**When to use.** The decomposition has natural strata (frontend / backend /
infra; or design / implement / test) and each stratum benefits from a
domain-specific lead who can re-decompose. Anything that would be a 30-step
flat star is probably better as a 3-deep tree.

**When NOT to use.** Two levels deep is a star with a hat. Don't add tree depth
to make the diagram look smart.

**Failure mode.** A sub-lead dies and its leaves keep running with no one to
report to — orphan work. PD's response: sub-leaf agents detect missing parent
via `pd whoami --agent <parent>`; on stale, they fall through to the
depth-0 lead's identity and write notes directly there. The `pd salvage`
queue surfaces the dead sub-lead so a human can replace it.

**Worked example — "Migrate 60 packages across FE/BE/infra in one sweep."**

```bash
# L0
pd begin "v5 sweep" --identity claude:l0-lead --lifecycle durable
pd note "Decomposition: 3 sub-leads, ~20 packages each" --type plan

# L1 — FE sub-lead (spawned by L0)
pd spawn --backend claude-cli --identity claude:l1-fe --budget 8 \
  --purpose "lead FE 20-pkg migration" \
  -- "Spawn one claude:l2-fe-<pkg> per FE package. Aggregate their pd notes type=result. Report up via pd note --agent claude:l0-lead --type result when 100%."

# L2 — leaves (spawned by L1 inside its prompt)
# e.g. pd spawn --backend claude-cli --identity claude:l2-fe-checkout --budget 0.50 -- "migrate checkout"

# L0 watches roll-up notes
pd notes --type result --limit 50 -j | \
  jq '.notes[] | select(.sessionPurpose | test("FE"))'
```

---

## 4. BROADCAST — one-to-many event-driven

**What it is.** A producer emits events; an arbitrary number of subscribers
react. The producer doesn't know who's listening; the subscribers don't know
each other. This is observability, alerting, the "fan-out" half of pub/sub.

**PD command sequence.**

```bash
# Producer
pd say "build broken on main — rolling back" --broadcast alerts

# Subscribers — long-running, declarative
pd watch alerts --exec ./pager.sh
pd watch alerts --exec ./slack-bridge.sh --max-concurrent 1 --min-interval 5000
pd watch alerts --exec ./auto-rollback.sh --once
```

**Primitive mapping.**

- Event surface: a declared logical channel via `pd channels ensure alerts
  --scope repo --description "build/deploy alerts"`.
- Producer: `pd pub alerts <payload>` or the consolidated `pd say --broadcast alerts`.
- Subscriber: `pd watch <channel> --exec <script>` is the idiomatic shape; it
  reconnects with backoff, rate-limits with `--min-interval`, caps concurrency
  with `--max-concurrent`, and exits cleanly on `--once`.
- For a human-paced terminal subscriber, `pd sub alerts` streams formatted
  radio messages; for an agent that just needs the latest event, `pd tube
  alerts --once` returns and exits so the agent's tool loop yields.

**When to use.** Events are the natural shape (deploys, builds, alerts), the
producer should not block on consumers, and you don't care about ordering
guarantees beyond "newer messages overtake stale ones."

**When NOT to use.** You need at-least-once delivery with acknowledgement. The
channel is best-effort — subscribers that were offline when the message landed
do not get it on reconnect. Use a tuple space or `pd note` for durable replay.

**Failure mode.** A subscriber's `--exec` script takes 90 seconds, blocks the
next event behind it, and you flood your concurrency cap. PD's mitigation:
`--max-concurrent` and `--timeout` are the brakes; tune them. For genuinely
slow consumers, write the event to a tuple in the same fanout (`pd say
"…" --broadcast alerts --pin`) so the consumer can dequeue at its own cadence.

**Worked example — "Auto-rollback agent listening for build-broke."**

```bash
# Once, on the CI host
pd channels ensure alerts --scope repo --description "build/deploy alerts"

# Producer (CI)
pd pub alerts '{"severity":"high","commit":"abc1234","author":"erich"}' \
  --signal mayday --sender ci

# Consumer (autorollback host)
pd watch alerts \
  --exec 'jq -r "select(.severity==\"high\") | .commit" <<< "$PD_MESSAGE_CONTENT" \
          | xargs -r git revert --no-edit && git push' \
  --max-concurrent 1 --timeout 60000 --min-interval 30000
```

---

## 5. FAN-OUT/FAN-IN — partitioned parallel work with a gather step

**What it is.** Star, but the gather step is explicit and load-bearing. The
coordinator partitions input, dispatches in parallel, then blocks on
aggregation before doing anything with the results. Map-reduce, parallel
search, redundant-execution-with-vote.

**PD command sequence.**

```bash
# Fan out
pd begin "audit all 47 routes" --identity claude:audit-lead --lifecycle durable
pd channels ensure audit:results --scope repo

for route in $(rg -l '/api/v[0-9]+/' --type ts | sort -u); do
  pd spawn --backend claude-cli --identity claude:audit-$(basename $route .ts) \
    --purpose "audit $route" --budget 0.30 \
    -- "Audit $route for OWASP top-10. Append findings: pd pub audit:results \
        '{\"route\":\"$route\",\"issues\":N}' --sender audit-$(basename $route .ts)"
done

# Fan in — block until 47 messages land or budget expires
pd tube audit:results --tail --json | \
  awk -v target=47 '
    /./ {n++; print; if (n==target) exit 0}
  '

pd done "47-route audit aggregated"
```

**Primitive mapping.**

- Dispatch: a loop of `pd spawn` calls.
- Worker result emission: `pd pub` to a single results channel, OR `pd tuple
  out` if you need durable replay.
- Gather: `pd tube <ch> --tail` (long-poll loop), or `pd watch <ch> --exec` with
  a counter, or `pd tuple rd '["result","*"]'` polled with `--limit`.

**When to use.** The work is naturally batch-parallel and the aggregation step
has real logic (vote, merge, rank). Anything map-reduce-shaped.

**When NOT to use.** You don't actually need the gather barrier — if every
worker's result is independently committable, you want broadcast, not fan-in.

**Failure mode.** 45 of 47 workers reply, two die silently, your `awk` waits
forever. PD's mitigation today: enforce a soft deadline with `pd tube
--wait-for=<seconds>` rather than `--tail`; on timeout, list missing identities
from `pd spawned -j` and decide whether to retry or accept partial. The blunt
truth: **PD does not yet expose a `pd spawn` gather policy** (`--gather
all|majority|first|N`) — the gather logic is yours to write. See gaps below.

**Worked example — "Three concurrent code-review agents, take the first
clean approval."**

```bash
pd begin "first-clean PR review" --identity claude:review-lead --lifecycle durable
pd channels ensure review:verdict --scope branch

for r in claude codex gemini; do
  pd spawn --backend $r --identity $r:review-pr-482 --budget 0.80 \
    --purpose "review PR 482" \
    -- "Run lint, tests, and a security check on PR 482. \
        On approval: pd pub review:verdict '{\"verdict\":\"approve\",\"by\":\"$r\"}' --signal roger. \
        On reject: pd pub review:verdict '{\"verdict\":\"reject\",\"by\":\"$r\",\"reason\":...}' --signal pan-pan."
done

first=$(pd tube review:verdict --once --json --wait-for=600 | jq -s 'first(.[] | select(.body | test("approve")))')
[ -n "$first" ] && echo "First approval: $first" && pd done "approved by $(echo $first | jq -r .body | jq -r .by)"
```

---

# Seven patterns

The topology is the shape; the pattern is the *protocol*. The same star can
host a debate or a critique-refine; the same mesh can run consensus or
blackboard. What follows are the seven recurring protocols.

## 1. FAN-OUT/FAN-IN (redundant or partitioned execution)

**What it is.** Already covered as a topology; the *pattern* version emphasizes
the protocol contract: every worker's output lands on a single rendezvous, and
the lead applies a deterministic gather policy (all / majority / first / N).
The redundant variant runs the same task on three backends; the partitioned
variant runs different inputs on the same backend.

**PD command sequence.** See topology #5. Add a discriminator: pin durably so
late-arriving results can still be aggregated.

```bash
pd say "shard 7 complete: 3 failing tests" \
  --pin --harbor audit \
  --broadcast audit:results
```

**Primitive mapping.** `pd spawn` for dispatch; `pd say --pin --broadcast` for
the dual-write (tuple + channel) so the gather step has both real-time and
durable views.

**When to use.** Variance in worker quality is high and you want to vote;
inputs are independent and you want to parallelize.

**When NOT to use.** You only have one worker. (You'd be surprised.)

**Failure mode.** Silent stragglers. Mitigation: `pd spawned -j` to enumerate
all dispatched agents, diff against received results, declare partial.

**Worked example.** See topology #5.

## 2. SUPERVISOR-WORKER (delegation chains)

**What it is.** A single supervisor session that issues structured task orders
to specific workers via direct messaging, and tracks completion against an
acceptance criterion *it wrote down*. This is the AutoGen `AssistantAgent +
UserProxyAgent` shape, the OpenAI Swarm "hand off to specialist," the ChatDev
project manager pattern.

**PD command sequence.**

```bash
# Supervisor
pd begin "schedule release" --identity claude:supervisor --lifecycle durable

# Direct dispatch via actor mailbox (durable, addressable)
pd actor cartographer --message "Re-run cartographer scan over apps/marketing for the v4.2 promote."

# Or via spawn for ephemeral worker
pd spawn --backend codex --identity codex:release-notes --budget 1.50 \
  --purpose "draft v4.2 release notes from changelog" \
  -- "Read CHANGELOG.md, draft the v4.2 notes section, pd note --type result on completion."

# Watch for completion
pd inbox watch --agent claude:supervisor &
```

**Primitive mapping.**

- The "task order" goes into a structured note or actor message — not chat.
- Acceptance criteria live as a `pd note --type acceptance` on the supervisor's
  session. Workers `pd notes --session <supervisor>` to read them.
- Completion comes back via `pd inbox send claude:supervisor` (DM) or via
  `pd note --type result` on the worker session.

**When to use.** Tasks have a single accountable owner and the supervisor must
verify before declaring done. Code review with a defined checklist.

**When NOT to use.** The supervisor has nothing to verify against. Then it's a
router, not a supervisor — use the star topology with no acceptance gate.

**Failure mode.** Supervisor dies mid-flight; workers complete and report to a
ghost mailbox. PD's mitigation: actor mailboxes (`pd actors` roster) are
durable and survive session death — the messages are still readable when a new
supervisor takes over via `pd salvage claim`.

**Worked example — "Two-author code review on a feature branch."**

```bash
# Author opens session
pd begin "feature: TOTP login" --identity claude:author-totp --lifecycle durable \
  --files apps/auth/totp.ts apps/auth/totp.test.ts

# Author signals "ready for review"
pd say "TOTP login ready for review on branch feat-totp" \
  --pin --broadcast review:requests \
  --kind review-request

# Reviewer claims
pd begin "review feat-totp" --identity codex:reviewer-totp --lifecycle durable
pd note --type acceptance \
  "Acceptance: TOTP window=30s, secret length=160 bits, test covers replay" \
  --session $(pd whoami -q | cut -d: -f2)

# Reviewer reads author's session notes & files
pd sessions --agent claude:author-totp -j | jq -r '.sessions[].id' | \
  xargs -I {} pd notes {} --limit 50
pd files | grep totp                    # see what author claimed

# Reviewer issues findings
pd inbox send claude:author-totp "Block: replay test missing. See note 14b3."
pd note "Found 1 blocking issue: missing replay test" --type review

# Author fixes, signals re-review
pd say "re-pushed: replay test added (commit abc1234)" --pin --broadcast review:requests
# Reviewer re-runs the acceptance check, then:
pd inbox send claude:author-totp "Approved. Merge when green."
pd done "approved feat-totp"
```

## 3. DEBATE (adversarial refinement with judge)

**What it is.** Two or more agents argue opposite positions; a third agent
judges and writes the resolution. The literature (Du et al. "Improving
Factuality and Reasoning"; Khan et al. "Debate Helps Supervise") shows this
beats single-agent CoT on math, code review, and factual tasks. The protocol
is rigid: argue → rebut → judge → record.

**PD command sequence.**

```bash
# Convening agent
pd begin "decide: rewrite vs patch the auth module" --identity claude:moderator --lifecycle durable
pd channels ensure debate:auth --scope branch

pd spawn --backend claude-cli --identity claude:advocate-rewrite \
  --purpose "advocate for full rewrite" --budget 1.50 \
  -- "Argue for rewriting lib/auth.ts. Post each argument: pd pub debate:auth …"

pd spawn --backend codex --identity codex:advocate-patch \
  --purpose "advocate for in-place patch" --budget 1.50 \
  -- "Argue for patching lib/auth.ts. Post each argument: pd pub debate:auth …"

# Moderator long-polls and serializes the back-and-forth
pd tube debate:auth --tail --wait-for=900

# Judge step
pd spawn --backend gemini --identity gemini:judge-auth \
  --purpose "judge the auth debate" --budget 0.80 \
  -- "Read pd tube debate:auth --once and pd notes --type argument. \
      Write final verdict via pd note --type verdict. Cite specific arguments by id."
```

**Primitive mapping.**

- Debate channel: a logical `pd channels ensure debate:<topic>`.
- Each turn: `pd pub debate:<topic>` with `--signal report`; rebuttals use the
  tube's `--reply-to` correlation so the judge can reconstruct the thread.
- Arguments-as-evidence: `pd note --type argument` on each advocate session so
  the chain is Merkle-attestable.
- Verdict: `pd note --type verdict --session <moderator>`; this is the
  load-bearing artifact and lives in the durable note chain.

**When to use.** The decision is genuinely contested, single-model bias is a
known risk, and you can afford 3-5x the tokens of a single CoT pass.

**When NOT to use.** The question has a single right answer that a linter can
check. Don't burn tokens debating tabs vs spaces.

**Failure mode.** One advocate dominates, the other gives up, you get a
rubber-stamp not a real debate. PD's mitigation is upstream of PD: enforce
turn-taking in the prompt by giving each advocate a `--budget` ceiling that
runs out before they can dominate, and have the judge explicitly score
*balance* in its verdict note.

**Worked example — "Should we adopt React Server Components in apps/marketing?"**

```bash
pd begin "RSC adoption decision" --identity claude:moderator --lifecycle durable
pd channels ensure debate:rsc --scope repo

pd spawn --backend claude --identity claude:pro-rsc --budget 2.00 \
  -- "Make the strongest case for RSC in apps/marketing. 3 arguments max, each as \
      pd pub debate:rsc with structure {position:'pro', point:N, claim:…, evidence:…}."

pd spawn --backend codex --identity codex:anti-rsc --budget 2.00 \
  -- "Make the strongest case against. Same shape, position:'anti'. \
      Use pd tube debate:rsc --once between turns to read the latest pro argument and rebut."

pd tube debate:rsc --tail --wait-for=1200 | tee /dev/stderr | \
  jq -c 'select(.body | fromjson? | .point == 3)' | head -2  # wait for both 3rd points

pd spawn --backend gemini --identity gemini:rsc-judge --budget 1.00 \
  -- "Read the debate. Score balance (0-1), name the strongest unanswered argument, \
      issue verdict. Write via pd note --type verdict."

pd notes --type verdict --limit 1
pd done "decided"
```

## 4. CRITIQUE-REFINE (iterative improvement)

**What it is.** One agent drafts, another critiques, the first revises. Loop
until the critic signs off or the budget runs out. Self-Refine and Reflexion
patterns at their cleanest. Different from debate: critic and author have
asymmetric roles and they're cooperating, not opposing.

**PD command sequence.**

```bash
pd begin "draft v4.2 announcement" --identity claude:author --lifecycle durable
pd channels ensure refine:announce --scope branch

# Author posts draft N
pd pub refine:announce '{"round":1,"draft":"…"}' --signal report

# Critic
pd spawn --backend codex --identity codex:critic-announce --budget 1.20 \
  -- "Loop: pd tube refine:announce --once → critique latest draft against \
      style guide → pd tube refine:announce --reply '{...feedback...}'. \
      Exit when you can sign off."

# Author loop
while [ "$(pd tube refine:announce --once --json | jq -r 'select(.body|fromjson?|.signoff==true) | .id')" = "" ]; do
  feedback=$(pd tube refine:announce --once --wait-for=600 --json)
  ./revise.sh "$feedback"
  pd pub refine:announce "$(jq -c --arg r "$(cat draft.md)" '{round:.round+1,draft:$r}' state.json)"
done
```

**Primitive mapping.**

- Round-trip channel: a logical `refine:<topic>` channel with `pd tube`'s
  reply-correlation so each critique is tied to a draft id.
- Signoff: a structured payload field (`signoff: true`) the author polls for.
- Audit trail: `pd note --type draft` and `pd note --type critique` on each
  side so the iteration history is durable beyond the channel.

**When to use.** Output quality benefits from a second pair of eyes and you
control both prompts. Documentation, marketing copy, careful code review.

**When NOT to use.** Ground truth is checkable (tests, types, lints) — at
that point you don't need a critic, you need a verifier. Run the verifier.

**Failure mode.** Infinite politeness loop: critic keeps finding tiny issues,
author keeps revising, neither will sign off. PD's mitigation: enforce a max
round count by counting `pd notes --type draft --limit 100` and have the author
bail with `pd note --type abandon` when it crosses N. Budgets on spawn help
too — when the critic's `--budget` runs out, it's done arguing.

**Worked example — "Draft the v4.2 release blog post."**

```bash
pd begin "v4.2 release blog" --identity claude:blog-author --lifecycle durable --files content/blog/v4.2.md

# Spawn critic — long-running loop
pd spawn --backend codex --identity codex:blog-critic --budget 2.00 \
  --purpose "iterate v4.2 blog with author" \
  -- "Critique style/voice/accuracy vs other posts in content/blog. Sign off when ready."

for round in 1 2 3 4 5; do
  cat content/blog/v4.2.md | pd tube refine:blog --send -
  pd note "draft round $round posted" --type draft

  feedback=$(pd tube refine:blog --once --wait-for=600)
  echo "$feedback" | grep -q '"signoff":true' && break

  # Apply critic's suggestions, write next draft
  ./apply-critique.sh "$feedback"
done

pd note "v4.2 blog signed off in $round rounds" --type result
pd done
```

## 5. VOTING / CONSENSUS (democratic selection)

**What it is.** N agents propose or judge; a threshold decides. PD ships this
as a first-class primitive — `pd quorum` — because it shows up everywhere:
selecting one of three candidate plans, gating an autonomous merge,
authorizing a destructive operation.

**PD command sequence.**

```bash
# Convener
pid=$(pd quorum propose \
  --role merge-pr-482 \
  --reason "PR-482 reviewed by 3 agents, requesting merge" \
  --threshold 2 \
  --ttl-ms 3600000 -q)

# Voters — each command is attributed from that agent's stored actor credential
pd quorum vote --proposal $pid --stance yes
pd quorum vote --proposal $pid --stance yes
pd quorum vote --proposal $pid --stance abstain

# Check
pd quorum show $pid    # passed: true/false, remainingNeeded: N
```

**Primitive mapping.**

- Proposal: `pd quorum propose` writes a durable tuple with role, reason,
  threshold, verified actor authority scope, optional TTL, and optional
  auto-spawn-on-pass. Authorship comes from the stored actor credential; there
  is no `--as` identity override.
- Vote: `pd quorum vote --stance yes|no|abstain` appends a unit-weight vote for
  the credentialed canonical actor. Re-voting appends evidence and the latest
  durable tuple from that same actor determines its ballot.
- Verdict: `pd quorum show` returns `passed` once `yesWeight >= threshold`.

**Identity limit (not Sybil resistance).** One daemon-minted actor soul gets one
effective ballot, even when that soul has several display aliases. That proves
which local soul voted; it does not prove one human, one organization, or an
eligible electorate member. The public actor-registration door can mint
multiple newcomer souls (subject to its separate admission/spend controls), so
this quorum primitive alone is not safe for high-stakes one-person-one-vote.
Such decisions need a separately governed eligible-actor set or external
personhood/account authority before votes are admitted; IDENTITY does not
pretend to supply that policy.

**When to use.** Decisions where you want explicit, auditable group consent.
Autonomous merges, budget approvals, choosing one of N candidate
implementations.

**When NOT to use.** Decisions where a single accountable owner exists and is
qualified. Don't vote on what color the button should be when the designer is
in the room.

**Failure mode.** Quorum never resolves because not enough voters show up.
Mitigation: `--ttl-ms` on the proposal so it expires; `pd quorum show` reports
`expired: true`, and the convener can re-propose with a lower threshold or a
different voter pool.

**Worked example — "Three reviewers vote on PR 482; majority approves; auto-merge."**

```bash
# Setup (the convener — could be CI)
pid=$(pd quorum propose \
  --role merge-pr-482 \
  --reason "Auto-merge if 2 of 3 reviewers approve" \
  --threshold 2 \
  --ttl-ms 7200000 \
  --auto-spawn -q)

# Watch for pass — CI polls every minute
while sleep 60; do
  passed=$(pd quorum show $pid -j | jq -r '.passed')
  expired=$(pd quorum show $pid -j | jq -r '.expired')
  [ "$passed" = "true" ] && pd say "auto-merging PR-482" --broadcast alerts && \
    gh pr merge 482 --squash && break
  [ "$expired" = "true" ] && pd say "quorum expired on PR-482" --broadcast alerts && break
done

# Reviewers (any time before TTL, from each reviewer's own actor context)
pd quorum vote --proposal $pid --stance yes
pd quorum vote --proposal $pid --stance yes
# Third reviewer optional — threshold already met after #2
```

## 6. BLACKBOARD (shared state accumulation)

**What it is.** No central coordinator and no direct messages — agents publish
findings to a shared knowledge surface, and other agents read what's relevant
to them. The classic Hearsay-II pattern; modern incarnations include shared
"world model" buffers and the RAG-style scratchpad. The blackboard is *append
mostly*, *read by all*.

**PD command sequence.**

```bash
# Any agent writes findings
pd note "lib/cache.ts uses Date.now() in 4 places — flaky in tests" \
  --type discovery

pd say "Found duplicated retry logic in services/http and lib/api-client" \
  --pin --kind duplication --harbor refactor-2026

# Any agent reads
pd notes --type discovery --limit 50
pd tuple rd '["duplication","*",{"text":"*"}]' --harbor refactor-2026 --limit 20
```

**Primitive mapping.**

- The blackboard *is* `pd notes` filtered by `--type` (and optionally
  `--project`). Notes are durable, Merkle-chained, and free-form on the `type`
  column.
- For cross-session findings that should survive note-pruning, also pin to the
  tuple space (`pd say --pin` does both in one shot).
- For heat-map intuition over which files are getting attention, sprinkle
  `pd pheromone spray files <path> heat 0.6` — pheromones decay, which is
  exactly right for "what's hot right now."

**When to use.** Genuine swarm research, audits, refactor surveys, code-tour
output. Any time you want N agents to *accumulate* knowledge without
synchronizing.

**When NOT to use.** Strict ordering matters. Notes are append-mostly but the
read order is "by createdAt" — if two agents must observe the *exact* same
sequence, use a channel with `pd tube --tail` instead.

**Failure mode.** Blackboard pollution — agents write speculative junk that
crowds out real findings. PD's mitigation: scope reads with `--type` (so
`discovery` and `speculation` live separately) and use the activity log
(`pd history --agent <name>`) to audit who's flooding.

**Worked example — "Five agents audit a 50k-line monorepo for security
issues."**

```bash
# Seed the blackboard with the threat model
pd note "Threat model: OWASP Top-10 + supply-chain. Pin findings with --type vuln." --type plan

# Spawn five auditors with non-overlapping scopes
for scope in routes models services workers config; do
  pd spawn --backend claude-cli --identity claude:audit-$scope --budget 1.50 \
    --purpose "audit $scope" \
    -- "Audit apps/**/$scope/** for OWASP issues. For each finding: \
        pd say '<one-line>' --pin --harbor sec-audit --kind vuln \
        --heat <path>=0.8 \
        --broadcast sec:findings."
done

# Cross-cutting consumer (read-only, runs while auditors work)
pd watch sec:findings --exec 'echo "$PD_MESSAGE_CONTENT" >> .audit/live-feed.log'

# Read the consolidated blackboard
pd notes --type vuln --project port-daddy --limit 200
pd pheromone files --limit 20    # which files are hottest right now
```

## 7. REQUEST / RESPONSE (synchronous handoff)

**What it is.** Agent A asks B a specific question, blocks on the answer, then
continues. The simplest possible coordination — but easy to do badly. Most
"two agents collaborating" really wants this, not chat.

**PD command sequence.**

```bash
# Requester
pd tube ask:reviewer --send "Is this commit safe to deploy to prod? sha=abc1234"

# Block on reply (default --wait-for is 600s; the tube long-polls)
reply=$(pd tube ask:reviewer --once --wait-for=300 --json | \
  jq -r 'select(.inReplyTo) | .body')

# Responder (long-running)
pd tube ask:reviewer --tail | while read -r line; do
  msg=$(echo "$line" | jq -r .body)
  verdict=$(./safety-check.sh "$msg")
  pd tube ask:reviewer --reply "$verdict" --send
done
```

**Primitive mapping.**

- The channel + the tube's `--reply-to` correlation give you request/response
  semantics over the daemon's pub/sub: each reply carries the parent id, so
  the requester can filter responses to its own questions.
- For direct one-to-one calls where the responder is a known actor, prefer
  `pd actor <id> --message "..."` — the actor mailbox is durable and
  addressable.

**When to use.** Tight question/answer turns with one known responder. Tool
calls that happen to be implemented by another agent. Quick "is this safe?"
gates.

**When NOT to use.** The conversation has more than two turns. Then you want
the tube in its full crank-handle mode (debate, critique-refine), not a
one-shot.

**Failure mode.** Responder is offline; requester blocks until `--wait-for`
expires. Mitigation: always pass `--wait-for` explicitly with a number you can
defend; on timeout, fall through to a fallback path. For genuinely critical
requests, fan out to multiple responders and take the first (see fan-out/fan-in
worked example with `--signal roger`).

**Worked example — "Deploy gate: ask the on-call reviewer if a hotfix is safe."**

```bash
# Deployer
question='{"sha":"abc1234","files":["lib/auth.ts"],"diff_url":"https://…","severity":"high"}'
pd tube ask:safety --send "$question"

# Block up to 5 minutes for a response
verdict=$(pd tube ask:safety --once --wait-for=300 --json | \
  jq -r 'select(.inReplyTo and (.body | test("^(approve|reject)"))) | .body')

case "$verdict" in
  approve*) ./deploy.sh ;;
  reject*)  pd say "deploy blocked: $verdict" --broadcast alerts; exit 1 ;;
  *)        pd say "deploy gate timed out; falling back to canary" --broadcast alerts
            ./canary.sh ;;
esac

# On-call responder (always-on)
pd tube ask:safety --tail --json | while read -r line; do
  q=$(echo "$line" | jq -r .body)
  if ./safety-check.sh "$q"; then
    pd tube ask:safety --reply "approve: passed safety-check.sh" --send
  else
    pd tube ask:safety --reply "reject: failed safety-check.sh" --send
  fi
done
```

---

# Gaps PD does not yet cover cleanly

Honesty section. The patterns above bend the primitives where the primitives
bend; where they don't, you write glue. These are the gaps a future ADR should
close.

- **No gather policy on `pd spawn`.** There is no `--gather all|majority|first|N`
  flag. The fan-in step is shell-glue (`awk`, `jq -s`, a `while` loop with a
  counter). For redundant-execution patterns this is the biggest friction.
  Track as: `pd spawn --gather` or a sibling `pd gather <spawn-ids> --policy`.
- **No termination policy on sessions.** Sessions don't carry a `--max-tokens`,
  `--max-time`, or `--max-rounds` ceiling that the daemon enforces. Workers
  rely on the spawn-level `--budget` (USD) as a proxy; for non-cost ceilings
  (e.g., "stop after 5 critique rounds"), you count notes yourself.
- **No cycle detection in spawn chains.** A sub-lead can `pd spawn` its parent's
  identity by mistake, creating a delegation loop. The activity log records
  it; the daemon does not refuse it. For deep trees, enforce naming discipline
  (`l0-`/`l1-`/`l2-` prefixes) and audit with `pd history --agent`.
- **Channel scope is logical, not transactional.** `pd pub` is fire-and-forget;
  there is no commit/abort. For protocols that need *exactly-once* semantics
  on a result write, pair the publish with a tuple `out` and dedupe on the
  reader side.
- **No first-class "panel of judges."** Public quorum is voter-flat: each
  credentialed canonical actor has one unit-weight ballot. Callers cannot
  assert `--weight`; reputation-weighted voting would need a trusted internal
  policy module that records how it derived each weight. PD does not ship that
  policy today, and pheromone reputation signals are never treated as voting
  authority.
- **Blackboard read order is by createdAt only.** If you need a topic-sorted
  blackboard ("show me all `vuln` notes about files under `apps/auth/`"), you
  filter client-side. A `pd notes --files-match <glob>` flag would help.
- **No durable replay on channels by default.** Subscribers that came up late
  miss earlier events unless the publisher also pinned via `--pin`. The tube's
  history cursor mitigates this for tube clients but not for `pd watch`
  consumers.
- **Actor message-typing is freeform.** `pd actor <id> --message` takes a string;
  it does not enforce a schema. For RPC-shaped supervisor-worker, both sides
  must agree on a JSON shape out-of-band.

None of these are blockers. They're the seams. When you hit one, the answer is
almost always "wrap a thin shell loop around the primitive that's closest" —
not "abandon the pattern."

---

# Composition notes

The patterns aren't mutually exclusive. The richest real workloads compose:

- **Tree + critique-refine** at each leaf: the lead decomposes, each leaf runs a
  draft/critic loop.
- **Mesh + voting** to elect a temporary coordinator: peers `pd quorum propose
  --role coordinator-this-shift`, the winner runs a star for the next hour.
- **Blackboard + broadcast**: every `pd say --pin --broadcast` is both a
  durable note and a real-time event — readers pick which side they want.
- **Star + debate at the gate**: the supervisor dispatches normally, but
  before merge, spawns a debate between "ship it" and "hold it." The verdict
  note is the merge gate.

The daemon does not enforce any of these compositions. It supplies leases,
claims, durable notes, channels, and salvage. The shape is yours.

---

# Coordination hygiene (read this before you ship)

Every pattern above assumes the basics. The basics:

- `pd briefing` at session start. Read live state before you write to it.
- `pd session files add <path>` before you edit. Region-claim with
  `--start-line/--end-line` or `--symbol-path` when you only own part of a file.
- `pd guard check --staged` before commit. The pre-commit hook is the floor.
- `pd salvage` when interrupted. Other people's WIP is your dirty-tree problem
  until you ack it.
- `pd done "<outcome>"` at the end. Anonymous dangling sessions are a tax
  everyone else pays.

The daemon does not require any of this. The patterns do.
