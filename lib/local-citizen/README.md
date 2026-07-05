# Local Citizen Runner

A **hookless** good-citizen runner that owns the agent loop for OpenAI-compatible
local/cloud models — **Groq, LM Studio, Ollama**. These substrates expose no
lifecycle hooks (no daemon to intercept tool calls or inject coordination on
each turn), so here **the system prompt + per-turn injection IS the citizenship
mechanism.** The runner composes every request as:

```
[ Port Daddy Citizenship system prompt ]   (prompts/port-daddy-citizen.md)
+ [ LIVE COORDINATION STATE block ]        (read from the Ink Cloud each turn)
+ [ the task ]
```

## Files

| File | Role |
|---|---|
| `../../prompts/port-daddy-citizen.md` | the citizenship system prompt (suggestibility envelope) |
| `ink-cloud.ts` | reads `~/.port-daddy/matrix.env`, parses `PD_LOCK_*` / `PD_PHEROMONE_*` / `PD_ALERT_*`, builds the injection block; `lockKeySuffix()` implements the path→key algorithm |
| `backends.ts` | Groq (curl + browser UA, key via a 0600 `--config` file under `~/coding/tmp`), LM Studio + Ollama (direct, graceful when the server is down) |
| `runner.ts` | composes the request, owns the loop, CLI entry |

## Invoke

```bash
# Groq (default model llama-3.1-8b-instant)
npx tsx lib/local-citizen/runner.ts \
  --backend groq --model qwen/qwen3-32b \
  --task "Edit lib/foo.ts to add a retry around the fetch" \
  --target-file lib/foo.ts \
  --self-actor "claude:my-task"

# Inspect what would be injected without calling a model:
npx tsx lib/local-citizen/runner.ts --backend groq --print-prompt --target-file lib/foo.ts

# LM Studio (start its local server first; otherwise a clear message, no crash)
npx tsx lib/local-citizen/runner.ts --backend lmstudio --task "..." --target-file ...

# Ollama (requires `ollama serve` + a pulled model)
npx tsx lib/local-citizen/runner.ts --backend ollama --task "..." --target-file ...
```

`--target-file` may be repeated. A `PD_LOCK_<suffix>` in the Ink Cloud whose
suffix matches a target file and whose actor differs from `--self-actor` is
surfaced as a conflict in the injected block — steering the model to coordinate
instead of clobber.

### Secrets

The Groq key is read from `~/coding/workgroup-ai/.env.local` at call time and
passed to curl via a `chmod 600` config file (never argv, never logs, never
committed). Plain `fetch`/`urllib` to Groq returns a Cloudflare 403
("error 1010", bot fingerprint); the browser User-Agent is what gets a 200.

---

## Model recommendation — 128 GB Mac (RAM-bound multiplex)

One heavy local **prime** is fine; multiplexing *many* heavy instances is
RAM-bound. A 30B-class coder at Q4 is ~18–22 GB resident; run three or four and
you have eaten the box. The fix is a **cheap multiplex tier** for the swarm of
ephemeral coordinator / parley / reviewer dupes, keeping local RAM for the one
prime.

**Tier A — the prime (one instance).**
- **Qwen 3 Coder (30B-class)** in LM Studio. This is your high-quality local
  coder for the real edit. Budget ~20 GB. Run exactly one.

**Tier B — local multiplex (several cheap instances, if you want it all local).**
- **Qwen3-Coder-30B-A3B** — an MoE with ~3B *active* params. Near-30B quality
  on coding, but only ~3B compute-active per token, so several can run for the
  RAM/throughput cost of one dense 30B. Best "many cheap citizens locally" pick.
- Or small **dense** models when you want the simplest footprint:
  **Qwen2.5-Coder-7B** (~5 GB Q4) or **Qwen3-8B**. Run 4–6 of these for
  coordinator/parley duty alongside the prime.

**Tier C — offload the swarm to Groq (recommended default for ephemeral dupes).**
- Push the throwaway coordinator/parley/reviewer agents to Groq:
  **`llama-3.1-8b-instant`** (cheapest, instant) for routing/coordination
  chatter, **`qwen/qwen3-32b`** when a dupe needs more reasoning. Groq is
  seconds-fast and cheap per call, and it keeps **all** local RAM for the one
  prime. This is the best blend on a 128 GB box: one heavy local prime +
  unlimited cheap ephemeral citizens on Groq.

**Rule of thumb:** local RAM is the scarce resource, not tokens. Spend it on the
*one* model whose output you ship; rent the swarm of coordinator dupes from Groq
(or run them as MoE/7B locally) where instant + cheap matters more than peak
quality.
