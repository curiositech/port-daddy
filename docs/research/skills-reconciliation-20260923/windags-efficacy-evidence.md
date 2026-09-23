# WinDAGs skill-graft efficacy: existing evidence and next tests

Audit date: 2026-09-23. Read-only inspection of public artifacts; no models, benchmark runner, external mutations, or Port Daddy runtime were invoked. This corrects an omission in the original manuscript-gap report: WinDAGs already has positive local paired evidence. The next work is replication and extension, not a first attempt to observe benefit.

## Finding

The [first-party article, published 2026-04-29](https://windags.ai/blog/skills-actually-help-the-numbers) introduces a comparison of vanilla Sonnet 4.6 with a skill-grafted configuration. Its public data substantiate an overall preference for grafted answers under both judges. This is evidence for that composite configuration on this Q&A corpus. It does not isolate skill prose, establish executed-task correctness, or demonstrate the efficacy of every skill/version. An adverse hallucination-avoidance result deserves equal visibility.

All numerical analysis below was independently recomputed from the [published JSON bundle](https://windags.ai/data/skill-graft-bench.json), rather than transcribed from the article. Methods were inspected in the linked public scripts. The scripts inspected are a later repository snapshot; their presence does not establish the exact code revision used for the historical run.

## Provenance and integrity

- Public script repository HEAD inspected: `9e2fed3bb42ad027284c5a3342e5487be45bf05e`, commit timestamp `2026-06-26T19:40:35Z`. [Pinned benchmark directory](https://github.com/curiositech/windags-skills/tree/9e2fed3bb42ad027284c5a3342e5487be45bf05e/scripts/bench).
- Published JSON: 2,495,584 bytes; SHA-256 `1f53049597fb893b0589738809e8922f3aa875944091e910ad6ed17494fc714e`. Both apex and www URLs returned identical bytes. `runId=sg-v2`, `generatedAt=2026-04-29T18:54:51.104Z`, `sonnetModel=claude-sonnet-4-6`.
- There are 50 unique prompt IDs, ten categories with five prompts each, 100 nonempty final responses, and 50 verdicts per judge. The IDs match the 50 entries in the pinned `dataset.ts`. Every headline winner tally agrees with recomputation from per-prompt verdicts. This accounts for the published sample, not every historical attempt.
- The export includes 167 distinct skill-pool entries. All 50 cases list four primary and four adjacent skill IDs. Reference manifests and primary bodies are included, but tool-result contents and exact assembled run-time system prompts are not.

| Pinned file | SHA-256 |
|---|---|
| `dataset.ts` | `af200008be606db8904fc63c3680e172df2ebab3bc1bc6a9488e06741c421141` |
| `runner-skill-graft-v2.ts` | `b31d5957673f728984ab0c70619227e0f7be767eba931606c1b1004c66a4ac1d` |
| `judge-pairs.ts` | `0952152e0c9944ce7c4d1985efb694ca6647027462861555870cdf8df2d7cfb5` |
| `export-sg-v2.ts` | `48fe1bd8f2fbc0a156cdc802c3110a64dd4e05aaf226bc671b2cfc8ab5ea4fa8` |
| `README.md` | `5d1492213cb2798a02455b45d6754f3d36ff82a6cf59ecff763d3e0c1aecf21b` |

The dataset hash pins prompt definitions. The JSON hash pins the published answers and resolved judgments. Neither establishes a historical skill-library commit or model-weight revision; those are not recorded in the export. The exporter hardcodes the Sonnet model label and reloads skill bodies from disk at export time, so the label and bundled bodies alone do not prove the precise generation configuration.

## Recounted outcomes

Each cell below is **graft wins / vanilla wins / ties**, out of the same 50 prompts. These are comparative judge preferences, including when a criterion is called correctness.

| Outcome | Opus 4.7 | GPT-5.5-2026-04-23 |
|---|---:|---:|
| Overall winner | 35 / 6 / 9 | 29 / 20 / 1 |
| Addresses actual problem | 11 / 2 / 37 | 14 / 4 / 32 |
| Correctness | 28 / 8 / 14 | 27 / 21 / 2 |
| Respects conventions | 29 / 7 / 14 | 32 / 15 / 3 |
| Avoids hallucinations | 13 / 18 / 19 | 17 / 32 / 1 |
| Actionable | 27 / 10 / 13 | 29 / 18 / 3 |

The overall graft win rates are 70% and 58%; vanilla rates are 12% and 40%. Therefore net win-rate differences are **58 and 18 percentage points**. The article's `+29pt` and `+9pt` correspond to counts of additional winning prompts, not percentage-point differences over 50. The pinned README correctly calls them prompt margins.

Both judges prefer graft overall; they do not agree on every pair. They select the same overall winner on 25/50 prompts: 21 graft and four vanilla. Fifteen cases reverse direction between judges; ten involve a tie under one judge. These are two measurements of the same 50 pairs, not 100 independent task observations. Cross-vendor agreement on the aggregate direction does not establish independent errors or human agreement.

Hallucination avoidance favors vanilla under both judges, even though overall preference favors graft. Preserve that tradeoff. Correctness favors graft under both, with a much smaller margin for GPT. These findings support a mixed outcome, not a claim that graft reliably prevents hallucinations. Judge reasons nominate specific technical errors for follow-up; this audit did not independently execute those code examples or validate every alleged error.

## Controls actually present, and the estimand they support

The [runner](https://github.com/curiositech/windags-skills/blob/9e2fed3bb42ad027284c5a3342e5487be45bf05e/scripts/bench/runner-skill-graft-v2.ts), especially `runVanillaV2`, `runSkillGraftV2`, `buildSystemPrompt`, and `runOne`, documents:

- Same prompt in both conditions and the same model identifier; default per-call `max_tokens=32768` in both. For this Sonnet identifier, temperature is omitted rather than fixed to zero.
- Vanilla receives the user prompt with no system prompt or tools. Graft receives four full skill bodies, four adjacent descriptions, reference manifests, task-handling/escalation/confidence instructions, and reference/search tools. Graft allows up to eight calls; vanilla makes one.
- Default generation condition order is vanilla then graft for each prompt; judge presentation order is separately randomized. No length-matched, protocol-only, tool-only, or equal-total-budget arm is present in this runner. That is appropriate for a product-bundle comparison but cannot identify which component caused the observed preference.
- Prompt reference skills are used for retrieval-hit metadata, not sent to the judge as an answer key. All prompts receive both conditions, reducing prompt-difficulty confounding; the hand-curated corpus still limits population generalization.

The [judge script](https://github.com/curiositech/windags-skills/blob/9e2fed3bb42ad027284c5a3342e5487be45bf05e/scripts/bench/judge-pairs.ts), `judgePair` and `resolve`, uses unlabeled Response 1/2, `Math.random()` presentation order, the same five-criterion rubric, and explicit mapping back to conditions. It records the order in its raw output. Blinding hides explicit condition labels, but full answers retain stylistic and skill/confidence references that can reveal treatment. The export drops the presentation-order field, so its realized balance cannot be independently reconstructed from this bundle. No order-swap replicate is present in the published export.

## Resource accounting from the actual bundle

| Recorded quantity | Vanilla | Graft |
|---|---:|---:|
| Total generation input tokens | 1,408 | 1,256,023 |
| Mean generation input tokens per prompt | 28.16 | 25,120.46 |
| Total generation output tokens | 185,907 | 161,194 |
| Mean generation output tokens per prompt | 3,718.14 | 3,223.88 |
| Mean recorded latency per prompt | 47.07 s | 52.28 s |
| Median recorded latency per prompt | 38.27 s | 51.47 s |
| Mean final response length | 12,102.78 characters | 10,297.28 characters |

The graft runner sums usage across calls. Forty-two cases report two turns and eight report one; none reports the eight-turn cap. There are 56 reference calls and nine catalog searches, spread across 42 prompts. Retrieval hit metadata is true in 43/50 cases. The stored tool logs contain names, inputs, and returned lengths; they do not preserve actual returned text or explicit success status. The article's reference-success/path-error split therefore was not independently verified from complete tool returns.

These are recorded generation usage and per-condition times, not end-to-end billed cost or wall time for the entire concurrent run. Query embedding precomputation, cache construction, judges, and some retrieval work fall outside those fields. The larger input budget is real, but the shorter average graft output also matters. Compute a version-priced cost/quality frontier before asserting cost superiority or inferiority. The study does not include a dump-all-catalog answer arm, so a context-size comparison with such a hypothetical arm is not an observed quality comparison.

## Reproduction and accounting limits verified in source

The [pinned README](https://github.com/curiositech/windags-skills/blob/9e2fed3bb42ad027284c5a3342e5487be45bf05e/scripts/bench/README.md) explicitly says the full cascade needs the private core monorepo. The runner imports `packages/core/...` files absent from the inspected public tree and refers to a missing `scripts/bench/build-tool2vec-cache.ts`. The offered BM25 substitution changes the intervention; its claimed preservation of direction is not established by this export.

The runner writes to repository-root `bench/runs/sg-v2`, while README commands from `scripts/bench` subsequently reference `runs/sg-v2`. Export expects `apps/marketing/public/data/...`. Those paths need reconciliation for an executable public reproduction. The public tree does not contain the original run directory or complete raw verdict files; the site JSON provides a substantial, inspectable subset.

The [exporter](https://github.com/curiositech/windags-skills/blob/9e2fed3bb42ad027284c5a3342e5487be45bf05e/scripts/bench/export-sg-v2.ts) omits errors, stop reasons, raw response-order mappings, exact assembled prompts, and tool-result contents. The runner resumes successful files and can overwrite failed attempts; the judge skips missing/empty pairs, while the exporter keeps nonempty pairs without exporting their error state. The visible sample is complete against the 50 planned IDs. Whether retries, partial-error answers, or exclusions occurred historically is unknown, not evidence that they did. Preserve an append-only attempt ledger in replication.

## Bounded next study and skill-reference transfer

1. Keep this frozen export and a complete historical manifest if recoverable. Reproduce the counts and publish corrected count-versus-percentage labels, both judges' adverse criteria, and resource accounting.
2. Re-run on fresh held-out engineering questions with pinned library/reference/tool/model versions, randomized generation order, balanced judge order, full attempt records, and independent human adjudication of a blinded sample. Repeated generations estimate sensitivity to sampling.
3. Separate product-default efficacy from resource-matched efficacy. Preserve vanilla and full graft, then ablate protocol/tools and skill prose; add length-matched relevant material. Keep safety requirements constant. Predeclare the primary outcome and how ties enter the estimand.
4. Extend to executable repository tasks with hidden checks, tool-side effects, rework, and whole-run cost. Randomize assigned skill availability for reputation estimates, and distinguish individual skill/version contributions from a bundled cascade effect.

For `skill-grader`, cite this as positive local composite-graft Q&A preference evidence, with adverse criteria retained; never attach its win rate to an individual skill. For `empirical-systems-evaluation` and `research-analyst`, use the pinned scripts and export to teach paired controls, sample accounting, instrument limitations, and replication. For `ai-engineer` and `agentic-patterns`, retain the useful graft pattern while treating hallucination reduction, runtime correctness, cost advantage, and cross-model transfer as separate hypotheses requiring measurement.

## Audit validation

Recomputed headline and per-criterion tallies from all 50 exported rows; checked unique IDs/category balance/nonempty responses and matched IDs to the pinned dataset; recomputed usage, turns, calls, and cross-judge agreement. Read the full runner, judge, exporter, README, and dataset definitions. Hashes identify inspected bytes, not independently authenticated historical production logs. Only this report and the targeted manuscript-gap report were edited.
