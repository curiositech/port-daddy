# Cloudflare Model Roster — the fleet's model menu, verified

Snapshot of developers.cloudflare.com/ai/models (catalog dated **2026-08-12**,
operator-supplied) plus the live pricing page (**verified 2026-08-22**),
filtered to text generation. This file exists because the fleet has been burned
twice by model-id folklore: phantom `@cf/moonshotai/kimi-k2.5`/`k2.6` ids that
never existed and returned silent blanks (#654), and a week of the purser
authoring on a tier nobody had re-justified since the price note that picked it
(#8870). Model choices are made against THIS file and the live stats
(`node scripts/fleet-ship-stats.mjs`), not against memory.

## Admission contract (before the fleet may route to an id)

An id enters `KNOWN_GOOD_CF_MODELS` (apps/fleet-executor/src/fleet.ts) only
with all three:

1. **Existence** — listed as Cloudflare-hosted on the catalog page (this file
   records the snapshot; re-fetch the page when adding).
2. **Rate** — a row in `apps/fleet-executor/src/spend.ts` `WORKERS_AI_RATES`,
   copied from the live pricing page, never guessed. An honored-but-unpriced
   model meters $0 — invisible spend.
3. **Context window** — a `MODEL_CONTEXT_TOKENS` entry, so MAP chunk budgets
   stay derived instead of guessed.

The set guards **existence, not price** (recalibrated 2026-08-22): a declared
ship pin outside the set is remapped to the cheap tier because a nonexistent
Workers AI id returns a blank the parser reads as "clean" — never as a cost
ceiling. Economic direction for MAP fan-out is enforced separately in
`deriveMapModel` (a MAP pin pricier than the ship's REDUCE model is dropped).

## Fleet tier assignments (as of 2026-08-22, evening — repertoire expansion)

| Tier | Model | $/M in | $/M out | Ctx | Used by |
|---|---|---|---|---|---|
| cheap control | `@cf/qwen/qwen3-30b-a3b-fp8` | 0.051 | 0.335 | 32k | spark/spider/snipe + the dormant ships — the A/B control population |
| cheap agentic | `@cf/zai-org/glm-4.7-flash` | 0.060 | 0.400 | 131k | qa, lookout, purser PLAN, code-reviewer MAP — the "repo mechanic" of the 30B class (59.2% SWE-bench vs qwen's 22%) |
| cheap diversity | `@cf/google/gemma-4-26b-a4b-it` | 0.100 | 0.300 | 256k | tautology-sniffer — third cheap-class family for the scoreboard A/B |
| mid (opt-down only) | `@cf/openai/gpt-oss-20b` | 0.200 | 0.300 | 128k | nothing by default — the refuted former AUTHOR tier |
| agentic coder | `@cf/deepseek-ai/deepseek-v4-flash-0731` | 0.440 | 1.320 | 1M | purser AUTHOR (Terminal-Bench 2.1 82.7; beats its own Pro on 9 agent benches) |
| strong util | `@cf/openai/gpt-oss-120b` | 0.350 | 0.750 | 128k | contract-repair + author-repair escalation, `*reviewer` role default — cross-family repairer by design |
| reasoning flagship | `@cf/deepseek-ai/deepseek-v4-pro-0813` | 1.320 | 3.960 | 1M | red-team (80.6% SWE-bench Verified; whole-PR attack surfaces in one window) |
| code frontier | `@cf/zai-org/glm-5.2` | 1.400 | 4.400 | 262k | code-reviewer REDUCE (62.1 SWE-bench Pro — beats GPT-5.5, independently verified) |
| admitted, unassigned | `@cf/moonshotai/kimi-k2.7-code` (0.95/4.00, 262k), `@cf/nvidia/nemotron-3-120b-a12b` (0.50/1.50, 256k) | | | | pin-able candidates; kimi's numbers are vendor-only and disputed, nemotron's agentic tool-reliability profile is strong |
| XO | `@cf/deepseek-ai/deepseek-r1-distill-qwen-32b` | — | — | — | XO synthesis only (src/xo.ts) |

Decision record, 2026-08-22 (operator directives "choose better models,
justify" + "add new models to your repertoire"; full research + sources in
the model-review artifact linked from the PR):

- **Purser AUTHOR: gpt-oss-20b → gpt-oss-120b → deepseek-v4-flash-0731 (same
  day).** The 20b record: 121 NON-EXECUTABLE sets, 83/110 repairs FAILED,
  124 BROKEN runs, 249/584 fleet-neutral (#8870). 120b was the first safe
  upgrade; the repertoire pass replaced it with the model holding the
  strongest *independent agentic-coding* record at comparable cost.
  Author-repair stays on gpt-oss-120b — author and repairer from different
  families, so one family's blind spot can't both write and "fix" a file.
- **The cheap class is now a three-family A/B** (qwen3-30b control /
  glm-4.7-flash agentic / gemma-4 diversity) that `fleet-ship-stats.mjs`
  judges empirically — glm-4.7-flash's 59.2%-vs-22% SWE-bench edge over
  qwen3-30b at the same price is the reason qa/lookout/PLAN/MAP moved first.
- **code-reviewer REDUCE: kimi-k2.7-code → glm-5.2.** Kimi's gains are
  vendor-only benchmarks practitioners publicly dispute; GLM-5.2 has
  independent third-party validation (62.1 SWE-bench Pro, 74.4 FrontierSWE,
  81.0 Terminal-Bench) at a comparable price. Kimi stays admitted/pin-able.
- **red-team: gpt-oss-120b → deepseek-v4-pro-0813.** The yml always declared
  "biggest available" intent; at 21 calls/2wk the reasoning flagship costs
  under a dollar.
- **Dormant/other ships stay on the cheap control** until the scoreboard
  says otherwise; snipe/spark/spider deliberately stay qwen3-30b as the
  control population.

## Accounting for the full 228-model catalog

The catalog's 228 entries break down as: roughly 200 are image, video,
text-to-speech, speech recognition, music, embeddings, reranking,
translation, classification, or safety models — physically not text
generators and therefore not coding-agent candidates in any configuration —
plus ~40 AI-Gateway third-party text models (Claude/GPT/Gemini/Grok/Kimi-K3
etc., unreachable from `env.AI` without a gateway-binding architecture
change) and ~30 Cloudflare-hosted text-generation entries, of which several
are catalog-Deprecated.

**Ruling (operator directive, PR #9249): every CURRENT, non-deprecated,
Cloudflare-hosted text-generation model with a published price is HONORED**
— 23 models as of 2026-08-22. Being honored means a pin runs as declared;
assignments still go to the models the evidence supports, and the
scoreboard judges everything. The named exclusions, each a documented
ruling, not taste:

| Excluded | Why |
|---|---|
| The catalog's Deprecated tier (llama-2/3/3.1 plain, gemma-2b/7b/3-12b, mistral-7b v0.1/v0.2, phi-2, hermes-2-pro, sqlcoder-7b, kimi-k2.5, bart, uform) | Cloudflare can retire them at any time → the silent-blank failure mode the set exists to prevent |
| `@cf/meta/llama-3.1-8b-instruct-fast` | No published price → unmeterable, violates the admission contract's rate leg |
| `@cf/meta/llama-guard-3-8b` | A safety classifier, not a generator — cannot review code |
| `@cf/moonshotai/kimi-k2.6` | The #654 phantom-id tombstone: the identical id once returned silent blanks fleet-wide. Needs one witnessed live call before admission; K2.7-Code covers the family |
| LoRA-base variants (`*-lora`) | Inference scaffolds for adapters, not standalone reviewers |

## Cloudflare-hosted text-generation candidates (current, non-deprecated)

Verified prices from the pricing page 2026-08-22 where shown; others need a
price check before admission.

| Model | $/M in | $/M out | Notes |
|---|---|---|---|
| `@cf/qwen/qwen3-30b-a3b-fp8` | 0.051 | 0.335 | 30B MoE (~3B active). The workhorse. |
| `@cf/zai-org/glm-4.7-flash` | 0.060 | 0.400 | Pinned by Cloudflare; 131k ctx; FC+reasoning. Cheapest credible alternative to qwen3-30b. |
| `@cf/openai/gpt-oss-20b` | 0.200 | 0.300 | Refuted as an authoring tier at fleet scale — see decision record. |
| `@cf/openai/gpt-oss-120b` | 0.350 | 0.750 | Responses-API envelope (ai-response.ts handles it). Proven strongest known-good tier. |
| `@cf/deepseek-ai/deepseek-v4-flash-0731` | 0.440 | 1.320 | Agentic; candidate mid-strong tier. |
| `@cf/nvidia/nemotron-3-120b-a12b` | 0.500* | 1.500* | *rate from lib/cost-tracker.ts, re-verify before admission. Multi-agent focus. |
| `@cf/qwen/qwen2.5-coder-32b-instruct` | 0.660 | 1.000 | Code-specialized dense 32B; the 2026-07-07 hotfix pin, retired as default. |
| `@cf/moonshotai/kimi-k2.7-code` | 0.950 | 4.000 | 1T MoE, 262k ctx, code frontier. Reviewer REDUCE. |
| `@cf/deepseek-ai/deepseek-v4-pro-0813` | 1.320 | 3.960 | 1M ctx reasoning flagship — candidate if a ship ever needs whole-PR context in one call. |
| `@cf/zai-org/glm-5.2` | 1.400 | 4.400 | Z.ai's flagship agentic coder. |
| `@cf/moonshotai/kimi-k2.6` | — | — | REAL on the catalog now — but the `@cf/…/kimi-k2.6` row in cost-tracker.ts is the #654 phantom tombstone from 2026-07. Re-verify by live call before ever admitting. |
| `@cf/google/gemma-4-26b-a4b-it`, `@cf/qwen/qwen3.8-27b`, `@cf/qwen/qwq-32b`, `@cf/meta/llama-4-scout-17b-16e-instruct`, `@cf/mistralai/mistral-small-3.1-24b-instruct`, `@cf/ibm-granite/granite-4.0-h-micro`, `@cf/deepseek-ai/deepseek-r1-distill-qwen-32b` | | | Mid/small field; price before use. |

Deprecated on the catalog (do not adopt): gemma-3-12b-it, kimi-k2.5,
llama-2/3/3.1 non-fast variants, mistral-7b v0.1/v0.2, phi-2, hermes-2-pro,
bart-large-cnn, sqlcoder-7b-2.

## AI Gateway (third-party) text-generation highlights

Reachable only via AI Gateway with provider keys — the fleet executor calls
`env.AI` (Workers AI) today, so these are *future* options, listed so nobody
re-derives the menu: Anthropic (claude-fable-5, claude-opus-5, claude-sonnet-5,
claude-haiku-4.5), OpenAI (gpt-5.x family incl. 5.6 sol/terra/luna), Google
(gemini-3.x flash/pro), xAI (grok-4.x), Moonshot (kimi-k3), Alibaba (qwen3.8-max),
MiniMax (m3), DeepSeek (deepseek-v4-pro via Fireworks). Adopting any of these is
an architecture change (gateway binding + secret custody), not a model swap.

## Reading the live scoreboard

```bash
node scripts/fleet-ship-stats.mjs --days 14
```

Renders, from the relay D1 (`fleet_run_spend` + `fleet_run_steps` +
`fleet_runs`): spend and token volume per ship×model (flagging unpriced
models), broken/no-output/adjudicated/repair health per ship, and the purser
authoring funnel (authored / non-executable / repair healed vs failed). Model
changes land WITH a before-window from this script in the PR, and get judged
on their after-window.

## Update procedure

1. Re-fetch the catalog page (`https://developers.cloudflare.com/ai/models/`)
   and the pricing page; update this snapshot's tables and dates.
2. For a new admission: satisfy the three-part contract above (existence,
   rate, context), extend `KNOWN_GOOD_CF_MODELS`, and mirror the rate into
   `lib/cost-tracker.ts` so daemon-side pricing agrees.
3. Record the decision and its evidence window here, in the decision record.
