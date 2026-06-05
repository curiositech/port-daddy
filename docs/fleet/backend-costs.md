# Fleet Backend Costs (2026-05)

A comprehensive table of fleet backends, their per-token rates, latency
expectations, and when to use each. All prices in USD. Rates change —
treat this doc as the spec; the source of truth for live rate matching
is `lib/cost-tracker.ts`.

Three operator-relevant cost regimes exist now:

1. **Hosted, per-token** — Cloudflare Workers AI, OpenAI, Anthropic
   SDK, Gemini. Each spawn bills exactly what it costs. Use the table
   below to budget.
2. **Local-process, flat-rate** — `cli:claude-code` and `cli:codex`
   route the prompt through the operator's already-paid Claude Max
   ($200/mo) or ChatGPT Pro subscription. PD's wallet sees ~zero
   marginal cost, but the subscription has rate limits.
3. **Local-host, free** — Ollama (currently telemetry-blocked). Costs
   nothing per call but lives on your machine's RAM/CPU.

## At a glance

| Backend            | Tier     | Input $/M | Cached input $/M | Output $/M | Latency       | Use when                                                  | Avoid when                                  |
|--------------------|----------|-----------|------------------|------------|---------------|-----------------------------------------------------------|---------------------------------------------|
| **Cloudflare Workers AI** |     |           |                  |            |               |                                                           |                                             |
| `glm-4.7-flash`    | low      | 0.060     | —                | 0.400      | 0.5–2s        | High-volume cheap classification, simple gardener pings   | Long-context reasoning                      |
| `qwen3-30b-a3b-fp8`| mid      | 0.051     | —                | 0.335      | 1–3s          | QA review, test-hunter, simplifier — most fleet defaults | Multi-modal, very long output               |
| `kimi-k2.6`        | high     | 0.950     | 0.160            | 4.000      | 2–6s          | Cartographer / Spider deep analysis                       | Burst high-frequency triggers (cost spikes) |
| `nemotron-3-120b-a12b` | high | 0.500    | —                | 1.500      | 3–8s          | Premium reasoning when you can wait                       | Tight latency budgets                       |
| `llama-4-scout-17b`| mid      | 0.270     | —                | 0.850      | 1–3s          | English-language summarization                            | Code-heavy tasks                            |
| `gpt-oss-120b`     | mid      | 0.350     | —                | 0.750      | 2–5s          | OSS-licensed alternative for compliance                   | When latency matters                        |
| **OpenAI**         |          |           |                  |            |               |                                                           |                                             |
| `gpt-5-nano`       | low      | 0.05      | 0.005            | 0.40       | 0.5–1.5s      | Smoke tests, "is this even valid English"                 | Anything requiring reasoning depth          |
| `gpt-5-mini`       | mid      | 0.25      | 0.025            | 2.00       | 1–3s          | General-purpose fleet work, scripted ops                  | Long codebase refactors                     |
| `gpt-5`            | high     | 1.25      | 0.125            | 10.00      | 2–6s          | Hard reasoning, architectural decisions                   | High-volume jobs (cost spirals)             |
| `gpt-4.1-nano`     | low      | 0.10      | 0.025            | 0.40       | 0.5–1.5s      | Cheap legacy fallback                                     | Reasoning-heavy work                        |
| `gpt-4.1-mini`     | mid      | 0.40      | 0.10             | 1.60       | 1–3s          | Tool-use heavy agents                                     | Compared to gpt-5-mini, no reason now       |
| `gpt-4.1`          | high     | 2.00      | 0.50             | 8.00       | 2–5s          | Long-context (1M+) work                                   | When cheaper gpt-5-mini suffices            |
| `gpt-4o-mini`      | low      | 0.15      | 0.075            | 0.60       | 0.5–1.5s      | Image+text input cases                                    | Pure text — gpt-5-nano is cheaper           |
| `gpt-4o`           | mid      | 2.50      | 1.25             | 10.00      | 1–3s          | Multimodal pipelines                                      | Text-only — gpt-5 dominates per dollar      |
| `o4-mini`          | high     | 1.10      | 0.275            | 4.40       | 5–30s         | Hard reasoning at moderate cost                           | Latency-sensitive triggers                  |
| `o3`               | high     | 2.00      | 0.50             | 8.00       | 5–60s         | Premium reasoning                                         | Frequent triggers                           |
| `o1`               | premium  | 15.00     | 7.50             | 60.00      | 15–120s       | Hardest verifiable-reasoning problems                     | Anything you'd run 100 times                |
| **Anthropic**      |          |           |                  |            |               |                                                           |                                             |
| `claude-haiku-4-5` | low      | 0.80      | —                | 4.00       | 1–2s          | Cheap Claude-quality output                               | Compared to gpt-5-mini, similar tier        |
| `claude-sonnet-4-6`| mid      | 3.00      | —                | 15.00      | 2–5s          | Default operator-quality work                             | Cost-sensitive bulk ops                     |
| `claude-opus-4`    | high     | 15.00     | —                | 75.00      | 5–15s         | Critical reasoning / planning                             | High-volume jobs                            |
| **CLI-backed (flat rate)** |  |           |                  |            |               |                                                           |                                             |
| `cli:claude-code`  | flat     | ~0*       | ~0*              | ~0*        | 3–30s         | You have Claude Max ($200/mo); zero marginal $            | No active subscription; rate-limited        |
| `cli:codex`        | flat     | ~0*       | ~0*              | ~0*        | 3–30s         | You have ChatGPT Pro; zero marginal $                     | No subscription; codex CLI not installed    |
| **Gemini** (REST `generateContent`; thinking tokens billed as output) | |  |       |            |               |                                                           |                                             |
| `gemini-2.5-flash-lite` | low | 0.10   | —                | 0.40       | 0.5–2s        | Cheapest current Gemini                                   | Hard reasoning                              |
| `gemini-2.5-flash` | mid      | 0.30      | —                | 2.50       | 1–4s          | Default Gemini; multimodal + thinking                     | Ultra-cheap bulk ops                        |
| `gemini-2.5-pro`   | high     | 1.25      | —                | 10.00      | 2–8s          | Long-context multimodal reasoning                         | Vs. gpt-5 for raw cost                       |
| **Groq** (OpenAI-compatible; LPU, 500+ tok/s) |  |  |             |            |               |                                                           |                                             |
| `llama-3.1-8b-instant` | low  | 0.05      | —                | 0.08       | <1s           | Fastest cheap completions                                 | Code-quality matters                        |
| `llama-3.3-70b-versatile` | mid | 0.59  | —                | 0.79       | <1s           | Fast quality open-weight                                  | Need multimodal                             |
| `openai/gpt-oss-120b` | high  | 0.15      | 0.075            | 0.60       | 1–2s          | Strong reasoning, very cheap, very fast                   | Need a closed frontier model                |

\* Rate-limited by the operator's subscription. PD's wallet sees ~zero
marginal cost. A 0.001 USD/spawn session estimate is still recorded so
project daily budgets and call-rate-limits can throttle the CLI.

## Per-spawn budgets, recommended defaults

| Backend tier              | Recommended `per_spawn_budget_usd_cap` |
|---------------------------|----------------------------------------|
| Cloudflare low (Qwen/GLM) | 0.02                                   |
| Cloudflare mid (Kimi)     | 0.05                                   |
| OpenAI gpt-5-nano         | 0.02                                   |
| OpenAI gpt-5-mini         | 0.10                                   |
| OpenAI gpt-5              | 0.50                                   |
| OpenAI o-series           | 1.00                                   |
| Anthropic Haiku           | 0.05                                   |
| Anthropic Sonnet          | 0.20                                   |
| Anthropic Opus            | 1.00                                   |
| `cli:*` (flat-rate)       | 0.01 (advisory; cost is ~zero)         |

The `lib/spawner/backends/openai.ts` adapter defaults to 0.10 USD per
spawn and a 5-minute timeout. Override per-agent in `pd-fleet.yml`.

## Monthly budget at 1000 spawns/month

Worked example for a representative fleet (7 hot agents firing on commits
+ schedules). Assume each spawn averages **~2,000 input tokens** of
context and **~800 output tokens** of response, with no cache hits.

| Backend                | Per-spawn cost ($) | 1000 spawns/mo ($) |
|------------------------|-------------------:|-------------------:|
| Cloudflare Qwen3-30B   |              0.0004 |              0.40 |
| Cloudflare GLM-4.7     |              0.0004 |              0.44 |
| Cloudflare Kimi K2.6   |              0.0051 |              5.10 |
| OpenAI gpt-5-nano      |              0.0004 |              0.40 |
| OpenAI gpt-5-mini      |              0.0021 |              2.10 |
| OpenAI gpt-5           |              0.0105 |             10.50 |
| OpenAI gpt-4.1-mini    |              0.0021 |              2.08 |
| Anthropic Haiku 4.5    |              0.0048 |              4.80 |
| Anthropic Sonnet 4.6   |              0.0180 |             18.00 |
| Anthropic Opus 4       |              0.0900 |             90.00 |
| `cli:claude-code`*     |              ~0     |              ~0   |
| `cli:codex`*           |              ~0     |              ~0   |

\* Subject to Claude Max / ChatGPT Pro rate limits.

### Recommended fleet allocation (gives the lowest monthly bill while keeping quality)

```
gardener        → custom         (shell, $0)
qa              → cloudflare/qwen3-30b      ($0.40 / mo)
test-hunter     → cloudflare/qwen3-30b      ($0.40 / mo)
simplifier      → cloudflare/qwen3-30b      ($0.40 / mo)
documentarian   → cloudflare/qwen3-30b      ($0.40 / mo)
cartographer    → cloudflare/kimi-k2.6      ($5.10 / mo)  -- deep reasoning
spark           → cloudflare/kimi-k2.6      ($5.10 / mo)  -- ideation
spider          → cloudflare/qwen3-30b      ($0.40 / mo)
```

Total: **~$12/month for 8000 spawns**. The fleet's budget cap is set
at $9.76/day (~$300/mo); this allocation leaves 96% headroom for
project-specific work.

### Claude Max / ChatGPT Pro override

Set `PD_USE_CLI_BACKEND=claude-code` (or `codex`) in your environment
and **every spawn**, regardless of `pd-fleet.yml`, routes through the
local CLI:

```sh
export PD_USE_CLI_BACKEND=claude-code
pd fleet up
```

Monthly cost: **$0 incremental** (you already pay $200/mo for Claude
Max). Trade-off: bound by Claude Max's hourly rate limits — bursts may
queue. Suitable for solo operators whose fleet doesn't exceed Max's
budget.

For ChatGPT Pro subscribers, substitute `codex`:

```sh
export PD_USE_CLI_BACKEND=codex
```

## Implementation notes

- **OpenAI**: `lib/spawner/backends/openai.ts` — reads `OPENAI_API_KEY`
  and `OPENAI_BASE_URL` (test/proxy/Azure friendly). Exact token
  telemetry per response. Default model `gpt-5-mini`. Accepts an
  optional `{ apiKey, baseUrl }` override so OpenAI-compatible providers
  (Groq) can reuse it without env-var shadowing.
- **Groq**: `lib/spawner/backends/groq.ts` — reuses the OpenAI adapter
  with `apiKey=GROQ_API_KEY` + `baseUrl=https://api.groq.com/openai/v1`
  (override `GROQ_API_BASE`). Exact token telemetry. Default model
  `llama-3.3-70b-versatile`.
- **Gemini**: `lib/llm-call.ts:geminiAdapter` — REST `generateContent`
  (v1beta), `x-goog-api-key: GEMINI_API_KEY` (or `GOOGLE_API_KEY`). NO
  SDK dependency. Exact telemetry from `usageMetadata`; 2.5 thinking
  models' `thoughtsTokenCount` is folded into output (it is billed as
  output). Default model `gemini-2.5-flash` (`gemini-2.0-flash` was shut
  down 2026-06-01).
- **CLI-tube**: `lib/spawner/backends/cli-tube.ts` — drives the local
  `claude` (claude-code) or `codex` CLI as a child process. Optional
  `tube` channel publishes the result for observers; suppress with
  `tube: null`. Default 5-minute timeout.
- **Env override**: `PD_USE_CLI_BACKEND=claude-code|codex` forces all
  spawns through the CLI regardless of yml config (see
  `resolveCliBackendOverride` in `lib/spawner.ts`).
- **Cost recording**: per-token rates live in
  `lib/cost-tracker.ts:MODEL_RATES`. Update when providers publish new
  pricing. CLI-tube backends record a 0.001 USD/spawn flat-rate session
  estimate.

## Authentication caveats

- `cli:claude-code` requires that `claude` is on `$PATH` AND that the
  user has authenticated. The wrapper detects auth failures from
  stderr (`unauthorized`, `not authenticated`, `please log in`, `api
  key`) and surfaces actionable next-step copy. Auth: `claude
  setup-token` or `claude auth`.
- `cli:codex` requires `codex` on `$PATH` AND OpenAI auth (key or
  ChatGPT Pro session). Auth: `codex auth login` or set
  `OPENAI_API_KEY`.
- Both CLIs are owned by their respective vendors. PD does not parse
  their internal protocols; it invokes them non-interactively and
  captures stdout. If the vendor changes the CLI's flags, the wrapper
  needs an update.

## Canonical key plumbing (how a backend's API key reaches the daemon)

Every metered backend resolves its key through
`lib/secret-env.ts:getSecret(KEY)`, which checks, in order:

1. An in-process cache populated at daemon boot by `snapshotSensitiveEnv()`
   (reads the key out of `process.env`, then scrubs it from the live env).
2. The OS keychain (`pd secret set <KEY>` → `saveManagedSecret`).

The daemon usually runs under **launchd**, whose environment is NOT your
shell's — it does not see `~/.port-daddy-env` or a project `.env.local`
unless those were present when the daemon was launched. Worse, a key that
was present at an *earlier* boot stays cached even after you rotate it,
so a stale token survives until the daemon restarts.

**Canonical fix — use the keychain, not boot env:**

```sh
pd secret set CLOUDFLARE_API_TOKEN   # paste current token
pd secret set GEMINI_API_KEY
pd secret set GROQ_API_KEY
```

`pd secret set` writes to the keychain AND updates the running daemon's
in-process cache (it goes through the `/secrets` route), so the new value
takes effect immediately — no restart, and it cannot be shadowed by a
stale boot-env value. Allow-listed keys live in
`SENSITIVE_KEYS` (`lib/secret-env.ts`); `GROQ_API_KEY` is included.
