# Dogfood Stickiness Signals

Use this when deciding whether a "we dogfood our own tool" claim is honest, or when filling in `stickiness` for `scripts/dogfood_bar.mjs`.

## The Honest Metric

The only success metric that matters for a multi-agent authoring product built by its own makers is: **do the people building it reach for it over Claude Code/Codex for real work, and keep coming back.** Not once, as a demo. Repeatedly, on tasks that mattered before the tool existed to help with them.

Everything else is a proxy, and proxies get gamed by accident even without anyone intending to mislead. A team that reports "40 agents launched this week" has told you activity happened. It has not told you whether a single one of those launches replaced a session the maker would otherwise have run in Claude Code or Codex.

## Vanity Metrics To Refuse

| Vanity metric | Why it's hollow |
| --- | --- |
| Agents launched / spawned per day | Counts button presses, not outcomes. A collision-prone swarm can launch five agents and still lose the work. |
| Demos run | A scripted demo path is the easiest thing to make look good and the least representative of daily friction. |
| Lines of code generated | Rewards verbosity; says nothing about whether a human trusted the diff enough to merge it without re-deriving it. |
| Unique users who tried it once | Trial is not retention. The dogfood thesis is about the *second* and *tenth* time, not the first. |
| Uptime / agents-launched-without-crashing | Table-stakes reliability, not a reason to prefer this tool over an incumbent that was also reliable. |

If a team's only reported numbers are from this list, `metricsHonest` should be `false` and `scripts/dogfood_bar.mjs` will flag `vanity-metrics-admitted` at `high` severity, forcing `pass: false` regardless of how good the differentiators look on paper.

## The Comeback Trigger Vocabulary

`stickiness.comebackTriggers` is a controlled, structured tag set — not free text scored by keyword matching. Pick from these because each names a moment a maker can point to and say "that's why I opened this instead of Claude Code":

| Trigger | What it evidences |
| --- | --- |
| `fixed-while-watching` | The maker watched a real bug get fixed live, end to end, without switching tools to verify. |
| `queued-next-task` | The maker queued the next piece of work without waiting for the current agent to finish — parallelism that actually saved wall-clock time. |
| `reverted-cleanly` | A checkpoint/rollback was exercised for real (not just present) and the maker trusted it enough to let the agent take a risk. |
| `swarm-no-collision` | Two or more agents touched adjacent surfaces and the claims/isolation layer prevented a collision that would have happened in a naive multi-terminal setup. |
| `faster-than-incumbent-loop` | A side-by-side, same-task comparison where this tool's single-agent loop was measurably faster or lower-friction than the incumbent — not a vibe. |
| `trusted-receipt-no-rereview` | A receipt was trusted enough that the maker merged or moved on without re-reading the full transcript or re-running the diff by hand. |

An empty `comebackTriggers` array, or one full of triggers outside this vocabulary, means the stickiness claim is aspirational. `scripts/dogfood_bar.mjs` treats zero recognized triggers as `no-comeback-triggers` at `high` severity.

## How To Collect This Honestly

1. **Ask, don't infer.** After a maker uses the tool for real work, ask directly: "would you have done this in Claude Code/Codex instead, and why or why not this time?" Log the answer verbatim before summarizing it into a trigger tag.
2. **Timestamp the claim.** A comeback trigger from six months ago, before a table-stakes regression, doesn't count today. Stickiness is a rolling signal, not a permanent badge.
3. **Prefer negative evidence.** If a maker tried the tool and *reverted to* Claude Code/Codex mid-task, that's the most valuable data point in the whole audit — it names exactly which table-stakes or differentiator axis actually failed. Don't bury it to protect the roadmap narrative.
4. **One real trigger beats five vague ones.** A single, dated, attributable `fixed-while-watching` account is stronger evidence than a survey where five people checked a box for "yes, I like it."
5. **Re-run the audit after any table-stakes regression.** Stickiness earned on last month's latency numbers doesn't survive this month's slower daemon cold-start. Treat `pass: true` as perishable, not a certificate.
