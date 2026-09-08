# Substrate study: is the single-writer rail the right collaboration model, and is the enforcement point below the agent the right substrate?

Pre-registered protocol. Written 2026-09-07 before any harness code or data existed. Changes to hypotheses, metrics, or stopping rules after data are logged in `CHANGELOG.md` with the date and the reason; the original text stays.

This directory has no dependency on the Port Daddy product. It imports nothing from the repository outside this directory, and it can be split into its own repository with `git subtree split --prefix studies/substrate-study` without change. It lives here so it survives the ephemeral build container and so the book can cite it.

## 1. The question the book cannot answer from its own results

The kernel chapter argues, from the supervisory-control result, that an interceptor at the tool level (a git shim, a hook that refuses `git add -A`) can observe an agent's writes but cannot regiment them: an agent with a shell reaches the working tree by paths the interceptor never sees. From that it follows that the *confinement* the book prescribes requires an enforcement point below the agent: a per-agent machine, container, or sandbox whose file and network effects pass through a broker. That much is argued in the book and is not what this study tests.

What the book does not know, and the author has asked to be tested rather than asserted, is whether the **single-writer rail** (one serial commit authority, claims registered before writing, conflicting claims refused) is the right *collaboration* model for several coding agents on one repository, as against the model the rest of the industry uses: **a worktree per agent and a merge queue**. The rail is currently a design invariant in the book. This study decides whether it stays one, becomes an empirical result, or is demoted.

Two sub-studies. S2 runs in any Linux container and runs first. S1 needs KVM or unprivileged sandboxes and runs on the author's machine or a CI runner that has them.

## 2. S2: the collaboration model, under bypassable and enforced substrates

### 2.1 Workload (realism comes from real history, not from a generator)

Tasks are real commits replayed from the histories of public repositories. A task is the diff of one commit; the files it touches, their sizes, and the overlap with neighbouring commits come from the actual history, which is the property synthetic generators get wrong. Three corpora, chosen before any run and fixed:

| Corpus | Why | Window |
|---|---|---|
| A mid-size TypeScript service (5k–20k commits, 300–1500 files) | the product's own shape | the most recent 600 commits on the default branch |
| A Python library with a wide contributor base | high file-overlap regime | the most recent 600 commits |
| A documentation-heavy repository | low overlap, many small files | the most recent 600 commits |

The exact repositories and commit ranges are pinned in `corpora.json` at first run and never changed. Commits that touch binary files, that are merges, or that exceed 2,000 changed lines are dropped and the drop count reported.

An agent is a scripted worker, not a language model. It takes a task, "works" for a duration drawn from the task's size (lines changed times a per-line time with a fixed seed), and then attempts to land the task's diff under the substrate's rules. Realism about *what agents edit* comes from the history; realism about *how agents behave under refusal* is a parameter: on refusal, an agent retries after rebasing (cooperative), or abandons (impatient), with the mix fixed per run.

### 2.2 Substrates (the treatment)

| Code | Substrate | What it models |
|---|---|---|
| U | Uncoordinated shared tree | N agents write directly into one working tree; last writer wins at the file level. The floor. |
| B(p) | Advisory claims, bypass rate p | Agents are asked to register a claim on the files before writing and to route writes through a shim; with probability p an agent's write skips the shim (models an agent with a shell). p ∈ {0, 0.05, 0.2}. B(0) is the shim used exactly as designed. |
| C | Enforced single-writer rail | Writes reach the tree only through the rail; a write whose claim conflicts is refused. Models the enforcement point below the agent. |
| D | Worktree per agent, merge queue | Each agent has its own worktree; landing means rebase onto the queue head and merge; conflicts are resolved by the queue's rule (retry after rebase, abandon after k). The industry baseline. |
| CR | Enforced rail, region claims | As C, with claims on line ranges rather than files. Tests whether the rail's cost is the claim granularity. |

Corruption is defined mechanically: after each landing the tree must apply the next task's base diff cleanly, or the tree is scored *torn* for that step. Under U and B(p>0) tearing is possible; under C, D, and CR it should be impossible by construction, and the harness asserts that as a self-check.

### 2.3 Metrics (fixed here; nothing added after data)

1. **Throughput**: tasks landed per simulated hour.
2. **Wasted work**: lines of edits discarded because a task was refused and abandoned, or because a landed edit was overwritten by a torn write.
3. **Conflict incidents**: refusals (C, CR), merge conflicts (D), torn writes (U, B).
4. **Time to land**: simulated seconds from task completion to the tree containing it.
5. **Evidence completeness**: fraction of landed changes with an unbroken record of who claimed what and when. Under C and CR this is 1 by construction; under D it is what the merge queue records; under U and B it is what the shim saw.

### 2.4 Design

Factors: substrate (6 levels), agents N ∈ {2, 4, 8, 16}, corpus (3), agent temperament (cooperative, impatient). 20 seeds per cell. Every cell runs the same 600-task sequence per corpus, so cells differ only in substrate, N, and temperament. Report medians with interquartile ranges and bootstrap 95% intervals for the differences between substrates; no significance tests are used to choose what to report.

### 2.5 Hypotheses, stated before the first run

- **H1 (confinement).** Torn-tree incidents under B(p) grow with p, N, and corpus overlap, and are zero under C, CR, and D at every N. If H1 fails for C, the harness is wrong, not the theory; that is the self-check.
- **H2 (the real question).** At low overlap (the documentation corpus, N ≤ 4), D matches or beats C on throughput and time to land. At high overlap (the Python corpus, N ≥ 8), C beats D on wasted work by at least a factor of two and matches it on throughput within 20%. If instead **D matches or beats C on every metric in every high-overlap cell**, the single-writer rail is not the collaboration model to prescribe, and the book demotes it to a confinement mechanism.
- **H3 (does enforcement matter for coordination, or only for confinement?).** B(0) and C are indistinguishable on every metric. If true, the argument for the enforcement point is confinement alone, and the book must say so; the rail's coordination value does not depend on the hypervisor.
- **H4 (granularity).** CR recovers at least half of C's throughput deficit against D at high overlap, where a deficit exists.

### 2.6 Kill criteria and the write-up rule

The study writes one report, `REPORT.md`, whatever the outcome. If H2's kill condition holds, the report says so in its first sentence and the book's kernel chapter and front matter are amended in the same pull request. Numbers quoted in the book carry the `[verified]` tag only if `run.sh --replicate` regenerates them from the pinned corpora and seeds.

## 3. S1: the substrate, on a machine that can run one

Not runnable in the build container (no KVM, no unprivileged user namespaces). Specified here so it is run rather than re-argued.

- **Candidates**: bare process; container with seccomp and Landlock and a network namespace; gVisor; a Firecracker microVM. Each with a broker for git, package installs, and outbound HTTP.
- **Workload**: clone a corpus repository, run its dependency install, run its test suite, start a language server and answer 50 requests, land 20 tasks through the rail. Same seeds as S2.
- **Measures**: cold start, wall-clock overhead per phase, memory, and, for each of the kernel chapter's ten obstruction paths, whether the effect became *controllable* (the broker can refuse it) or stayed *observable only*. The controllability table is the result; the overhead numbers say what it costs.
- **Decision rule**: the book prescribes the cheapest candidate that makes every write-path obstruction controllable with under 30% overhead on the test-suite phase. If no candidate does, the book says what remains observable-only under the best one.

## 4. Vocabulary

The study speaks the harness-experimentalism vocabulary recorded in `docs/harbor-research/exposition/HARNESS-LIFECYCLE-PROOF.md`, so that the book, the product, and the experiments use one set of words. A **Genesis** is a reproducible initial world-state plus perturbation schedule: here, a pinned corpus, a substrate, N agents, a temperament, and a seed. A **Voyage** is one execution of a Genesis. The **Wake** is the event log the Voyage leaves. The **Logbook** is the per-run CSV. The **Receipt** is `REPORT.md`, the adjudicated claims we are willing to assert afterwards. This harness is a Dream Rig: it creates the world and gives the substrate no special favours. The invariant the study inherits: a claim about a substrate is not established because a mechanism executed; it is established when a controlled Genesis produces a Voyage whose consequential transitions are supported by durable evidence and an adjudication that follows the pre-registered rules above.

## 5. Deliverables

`harness/` (Python 3.11, standard library plus `git`), `corpora.json`, `run.sh`, `results/` (CSV per cell, never hand-edited), `REPORT.md`, `CHANGELOG.md`. A `make check` target runs a two-agent, ten-task smoke of every substrate and asserts H1's self-check.
