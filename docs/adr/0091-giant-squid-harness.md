# 0091. The Giant Squid Harness — Hijack the vendor loop

## Status

Proposed — 2026-06-24. Replaces the earlier 2026-06-20 "Maritime Agent Harness" draft.

Composes with: [ADR-0039](0039-suggestibility-layer.md) (Attention Engine),
[ADR-0050](0050-coast-guard.md) (Coast Guard), [ADR-0086](0086-parley-protocol.md)
(Parley), [ADR-0087](0087-trusted-computing-base-broker.md) (TCB/VM),
[ADR-0088](0088-host-safety-layer.md) (Host Safety Layer).

## Context

The initial draft of this ADR assumed that vendor CLIs (`claude -p`, `codex exec`,
`gemini`) were opaque black boxes. This forced a false choice: either build a brittle
wrapper that fails to inject state between turns, or write our own custom TypeScript
`while` loop (`commandVoyage`) and relegate Pro/Max subscriptions to blind sub-voyages
(the rejected "posture A").

**That assumption was factually incorrect, and it was the central error of the prior
draft.** First-party CLIs expose rich, synchronous lifecycle execution hooks. They
natively support passing state via standard stdin/stdout JSON payloads and respect POSIX
exit codes (e.g., `exit 2` to block a tool execution). We do not need to extract a bare
completion from the CLI — we let the vendor run their own optimized loop and reach *inside*
it through the hook surface.

> **Verification scope (honest).** Claude Code's `PreCompact` lifecycle event and
> `UserPromptSubmit` context admission are verified. The current context-pressure bridge
> configures its turn-time refresh only for Claude Code: the existing prompt tentacle is
> invoked as `pd-hook-prompt --interactive-context-pressure`, while `pd-hook-precompact`
> remains the truthful compaction checkpoint. The turn-time path can return bounded
> `additionalContext`; `PreCompact` may block a manual compaction for a missing plan, but
> Claude discards its `systemMessage` and `continue` fields, so it is not claimed as a
> warning-delivery channel. Registration is not operational packet issuance: a daemon-owned
> provider-session → active `pd plan` binding
> must exist before the hook can enter the pressure machinery. The ingress never selects a
> plan from ambient `PD_SESSION_ID`; an unbound provider session is
> `provider-session-unbound` with no packet. Only after binding can the daemon look for a
> trusted measurement, then complete daemon-owned tool-pair coverage. The hook payload is
> lifecycle metadata, not a token report or transcript. A configured adapter integration may
> use the greater of a separately witnessed provider estimate and its own estimate, or its
> persisted estimate with a known window, but only with a current durable `pd plan`
> checkpoint. Missing measurement is `measurement-unavailable`; missing or invalid coverage
> is `packet-withheld`; neither invents a packet. The default daemon wires no operational
> provider-session binding or usage/tool-pair witnesses, so it issues no packet. Codex
> (`config.toml`) and Gemini
> (`.gemini/settings.json`) having *equivalent* synchronous, exit-code-respecting hooks
> must be **verified before** we claim cross-vendor universality. They, and agy, do not get
> a simulated PreCompact registration. The **Claude Max seat is the guarantee-bearing Prime
> Agent that works now**; the others are validate-then-add.

The daemon derives retry identity from the authenticated plan revision plus a
daemon-owned measurement watermark, never a hook timestamp or provider payload.
That watermark stays stable for a delivery retry and advances when the adapter
or bounded durable-ledger fallback observes later evidence, so unchanged rounded
usage cannot replay an obsolete compaction boundary.

The resolution is the **Giant Squid Harness**. We do not need to build, maintain, or
account for the agent execution loop. Anthropic, Google, and OpenAI have already built
highly optimized token-streaming and retry engines. Instead, we wrap our harness around
their hull. By mapping our port-daddy maritime primitives to their native hook surfaces,
our scripts act as tentacles, reaching inside to steer the execution. The flat-rate
Pro/Max seat becomes the guarantee-bearing Prime Agent, operating entirely on our terms,
with zero API token costs.

## Decision

**Deprecate the custom `commandVoyage` TypeScript loop. Build the Giant Squid Harness: a
suite of POSIX-native hook scripts that intercept, throttle, and steer vendor CLIs from
within their own execution lifecycles.**

The system relies on a flat POSIX Environment Matrix (`~/.port-daddy/matrix.env`) for
stigmergic coordination, ensuring blazing-fast reads for native Mac/Linux tools (`grep`,
`awk`). The port-daddy UI layer renders from a **tokenized design system** whose visual
specifics are chosen separately (deferred — see Step 5); this ADR prescribes the
*architecture*, not the *look*.

### 1. The POSIX Stigmergic Matrix (The Ink Cloud)

To support the *Jamie Madrox* pattern of highly parallelized, ephemeral agents without deep
JSON parsing overhead, all coordination happens through atomic file locks and an
append-only environment matrix. Agents leave traces (ink) in the water for others to read.

> **Path note (hard rule):** the matrix lives at `~/.port-daddy/matrix.env` with a
> sibling `flock` lockfile — **never `/tmp`.** `/tmp` is purged by macOS and is banned in
> this operation; all PD runtime state (tube history, transcripts) already lives under
> `~/.port-daddy/`, and the Ink Cloud joins it. A per-fleet matrix may shard as
> `~/.port-daddy/matrix/<fleet>.env`.

```bash
# ==============================================================================
# PORT DADDY STIGMERGIC ATTENTION ENVIRONMENT MATRIX  (~/.port-daddy/matrix.env)
# ==============================================================================

PD_TASK_AUTH_REFRACTOR_STATUS="in_progress"
PD_PHEROMONE_WARNINGS_01="auth.ts uses deprecated v1_hook | intensity:3 | age:2m"
PD_LOCK_SRC_AUTH_TS="dupe_04"
```

The matrix is the fast read/write surface for the hooks; it is reconciled with the durable
attention/pheromone state (`lib/attention.ts`, `lib/pheromone.ts`) by the daemon — the flat
file is the hot cache the tentacles read, not a second source of truth.

### 2. The Tentacles (The Hook Topography)

We map the established Maritime Lifecycle directly onto the vendor CLI hook definitions. Our
daemon dynamically generates the necessary configuration files for Claude Code, Codex, or
Gemini, pointing their internal lifecycle triggers at our Universal `pd-hook-*` binaries.

| Maritime Concept | CLI Hook Surface | Action Taken by port-daddy Giant Squid |
|---|---|---|
| **Suggestibility Envelope** | `UserPromptSubmit` | CLI passes the prompt to `pd-hook-prompt`. Claude Code alone adds `--interactive-context-pressure`, which records a bounded daemon-witnessed pressure observation and can prepend a bounded plan/packet directive; all providers retain the ordinary matrix read. |
| **Quartermaster (File Locks)** | `PreToolUse` | CLI passes the requested tool + file target to `pd-hook-pre-tool`. We verify `PD_LOCK` flags via vsock. If locked, `exit 2` safely aborts the CLI's tool attempt. |
| **Coast Guard (Egress/Safety)** | `PreToolUse` | We intercept and validate egress boundaries on the host. On a violation we exit and inject a firm denial into the CLI's context stream via stderr. |
| **Heaving the Log (Pheromones)** | `PostToolUse` | When the CLI successfully mutates a file, `pd-hook-post-tool` executes `flock` and appends a `PD_PHEROMONE` trace to the matrix. |
| **Drydock & Salvage** | Claude Code `UserPromptSubmit` / `PreCompact` / `Stop` | The Claude-only turn-time prompt refresh provides the .60/.75/.85/.92 pressure ladder where bounded `additionalContext` is admitted; `pd-hook-precompact` sends bounded local lifecycle metadata at the actual compaction checkpoint and can block only a manual missing-plan case. Both first require a daemon-owned provider-session → active `pd plan` binding; `provider-session-unbound` yields no packet and ambient `PD_SESSION_ID` is never used to select one. A configured adapter integration may then use a known daemon window/estimate, a current durable plan checkpoint, and complete daemon-owned tool-pair coverage to write a cited CompactionPacket from `max(provider, daemon)`. Missing measurement yields `measurement-unavailable`; missing or invalid coverage yields `packet-withheld`. The default daemon has none of those operational witnesses and writes no packet. Neither path extracts or sends a raw transcript or splits a tool call from its result. |

### 3. The Cephalopod Adapter (Config Generator)

Because the execution loop is handled entirely by the vendor binaries, the `ModelAdapter`
interface no longer needs a `generate()` function. Its sole responsibility is configuring
the host environment before spawning the CLI.

```typescript
export interface GiantSquidAdapter {
  providerName: string;
  binaryName: string;

  // Sinks its hooks into ~/.claude/settings.json or config.toml
  injectHooks(workspaceRoot: string): Promise<void>;

  // Spawns the CLI with the target task
  spawnVoyage(taskDirective: string): Promise<void>;
}
```

When `spawnVoyage` is called, the vendor CLI boots up. Before it reads the `taskDirective`,
it natively hits the `UserPromptSubmit` hook, invokes our `pd-hook-prompt` script, and
absorbs the Stigmergic Matrix. The CLI runs the loop; the Squid dictates the rules of
physics inside the sandbox.

### 4. Steering DMs and Enforcement

Human DMs and steering overrides map perfectly to this structure. When an operator issues a
steering command via the port-daddy UI:

1. The daemon writes the command to the host's active attention file.
2. The very next time the CLI hits *any* hook (`PreToolUse`, `PostToolUse`, or
   `UserPromptSubmit`), the hook script injects the un-acked DM directly into the CLI's
   standard output stream as an imperative system interruption.
3. If the DM requires a hard stop, `pd-hook-pre-tool` simply issues `exit 2` on all
   subsequent tool requests until the agent acknowledges the steering override.

This is where the honest advisory-vs-enforced line lands cleanly: the **suggestibility
prepend (step 2) is advisory** — the model reads it and may still choose its own action;
but the **`exit 2` gate (step 3) is enforced** — the CLI obeys the exit code and the tool
simply does not run, regardless of the model's intent. Enforcement lives inside the
vendor's own loop, at the hook boundary, not in our prose.

## Consequences

- **Positive:** We achieve unlimited, zero-marginal-cost compute on frontier models
  (Pro/Max seats) with deterministic, per-turn state injection and strict host-side
  enforcement. We delete thousands of lines of fragile TypeScript execution loop.
  Cross-vendor compatibility becomes (mostly) a matter of writing JSON/TOML config
  generators.
- **Cost / Risk:** We are tightly coupled to the stdin/stdout schema of the vendor hook
  implementations. If a vendor severely breaks their hook JSON schema in an update, our
  `pd-hook-*` parsers will fail. And cross-vendor parity is *assumed, not yet proven*, for
  Codex and Gemini (see the Context verification note).
- **Mitigation:** The hook parsers must be defensively written with generous try/catch
  fallbacks, returning an **unmodified** state to the CLI rather than crashing the loop if
  an unknown JSON shape is encountered. A hook that fails open (lets the turn proceed
  un-steered) is degraded coordination; a hook that crashes the CLI is a broken product —
  always prefer the former.

## Implementation Roadmap

Each step promotes to a `roadmap_items` row (`adr-0089-<slug>`).

1. **Drop the Loop** (`adr-0089-drop-commandvoyage`) — delete `commandVoyage` and the custom
   `ModelAdapter.generate()` machinery.
2. **Build the Ink Cloud** (`adr-0089-ink-cloud-matrix`) — the atomic `~/.port-daddy/matrix.env`
   reader/writer using native `flock`; reconciled with `lib/attention.ts` / `lib/pheromone.ts`.
3. **Ship the Tentacles** (`adr-0089-hook-tentacles`) — `pd-hook-prompt`, `pd-hook-pre-tool`,
   `pd-hook-post-tool`, and the Claude-only `pd-hook-precompact` script. **Claude Code first**
   (verified hooks).
4. **Write the Config Generators** (`adr-0089-cephalopod-config-gen`) — the adapter layer that
   translates our tool schema into `.claude/settings.json`, Codex `config.toml`, and
   `.gemini/settings.json`. Verify codex/gemini hook parity here before claiming them.
5. **Wire the UI** (`adr-0089-binnacle-quartermaster-ui`) — display the Binnacle and
   Quartermaster locks mapped from the matrix, rendered from the **tokenized design system**
   selected via static-HTML style exploration. The look is deliberately *not* prescribed
   here (not Windows 3.1, not neobrutalism) — the design system is built first so specifics
   stay swappable.

## Success Criteria (SMART) — how we *prove* it worked, not assert it

Each criterion is Specific, Measurable, Achievable, Relevant, and Time-bound — and,
critically, produces a **showable artifact** (a live transcript, a reproducible test, a
screen recording, a screenshot). **Time-bound is enforced concretely: a slice's PR does not
merge until its goal's artifact is attached to that PR.** Nothing here is satisfied by
assertion; the artifact is the gate.

| # | Goal (Specific) | Measure / threshold | Showable artifact | Slice |
|---|---|---|---|---|
| G1 | Per-turn suggestibility injection on a **live** Claude Code voyage | an injected matrix token (a Parley Alert) appears in the model's `UserPromptSubmit` context on the intended turn in **3/3** live runs | the captured `pd transcripts` record showing the injected text in that turn's input | Tentacles |
| G2 | **Enforced lock gate** (the load-bearing claim) | agent B's Edit of a file agent A holds locked is blocked by `PreToolUse` `exit 2`; the file content/mtime is unchanged in **10/10** trials; the block is logged | a reproducible test + the hook stderr the agent received | Tentacles |
| G3 | Steering DM hard-stop | an operator steering DM appears in-context within the agent's **next** hook fire (≤1 turn), and a hard-stop blocks all tool calls via `exit 2` until ack, in a live run | a screen recording: operator sends DM → agent halts → acks → resumes | Tentacles + UI |
| G4 | **Zero-marginal-cost** on the Max seat | a completed `cli:claude-code` voyage shows **$0.00** PD-wallet API spend in the live `pd transcripts` ledger, vs a metered backend showing `>$0` on the same task | the two ledger rows side by side | Config Gen |
| G5 | Matrix concurrency (*Jamie Madrox*) | **K≥8** concurrent agents append pheromones via `flock` with **0** corrupted/torn lines, grep read latency **<5ms** over a 1k-entry matrix | the stress-test output + the intact `~/.port-daddy/matrix.env` | Ink Cloud |
| G6 | Evidence-gated Drydock → continuation | an adapter-equipped Claude `PreCompact` observation with a daemon-owned provider-session → `pd plan` binding, measurement, current plan checkpoint, and complete tool-pair coverage emits a cited packet; an explicit governed continuation reads that packet, the last plan, and bounded evidence handles. An unbound session, missing measurement, plan, or coverage yields no packet, and no raw transcript is copied. | the durable receipt/packet plus the adversarial binding, coverage, and restart proof | Tentacles |
| G7 | Cross-vendor parity (**honest**) | Claude Code hooks verified in the Tentacles slice; codex + gemini parity either verified **or documented as a concrete gap** in the Config-Gen slice — no silent universality claim | the config-generator test matrix (pass/gap per vendor) | Config Gen |
| G8 | UI renders from the matrix | the Binnacle + Quartermaster panels render **live** matrix state in the chosen design-system theme | screenshot **+ GIF** (per the repo's visual-artifact rule) | UI |

**Definition of done for ADR-0089:** delivered only when G1–G8 each have their artifact
checked in or linked from the slice PR that claims it. This is deliberate — the program's
credibility has been hurt by features asserted-but-never-shown; these goals make "shown"
the merge gate.

## References

- ADR-0039 — the Attention Engine / suggestion-broker the matrix projects from.
- ADR-0050 — the Coast Guard egress/safety boundary the `PreToolUse` tentacle enforces.
- ADR-0086 — Parley; the Parley Alert prepended at `UserPromptSubmit`.
- ADR-0087 — the TCB/VM the hooks run inside; `exit 2` is the in-loop gate, the vsock is the host boundary.
- ADR-0088 — `pd safe`, the host-side detection layer.
- `lib/attention.ts`, `lib/pheromone.ts` — the durable coordination state the flat matrix caches.
- `lib/agent-harbor/context-continuity.ts` — cited packet validation, tool-pair integrity, and the bounded packet-derived continuation capsule.
- `pd-hook-prompt`, `pd-hook-pre-tool`, `pd-hook-post-tool`, `pd-hook-precompact` — the tentacle scripts created by this ADR's roadmap. <!-- cite-exempt: proposed; created by ADR-0089 roadmap -->
