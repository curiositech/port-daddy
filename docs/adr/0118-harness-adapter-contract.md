# ADR-0118: Harness Adapter Contract for N:N Session Portability

- **Status:** Accepted
- **Date:** 2026-07-15
- **Roadmap:** `durable-agent-n-n-harness-adapter-contract`

## Context

Port Daddy can launch many model providers and agent CLIs, but launchability is
not session portability. Claude, Codex, Gemini, Agy, Aider, API providers, and
local model servers expose different session identifiers, transcript stores,
auth boundaries, and live-control channels. Pairwise bridges would require
N×(N-1) integrations and would still conflate native resume with reconstructed
continuation.

Beacon needs one durable path in and one durable path out for each harness. A
source session is compacted into a sanitized handoff capsule. A target adapter
either resumes the same native session when it owns the source identifier or
starts a successor from that capsule. The capsule is the interoperability
boundary; raw provider transcripts are evidence inputs, not the wire format.

## Decision

`lib/backend-catalog.ts` is the single source of truth for both provider routing
and harness portability mechanics. Every backend row declares an `adapter`
with:

- a stable adapter family and spawn transport;
- an argv template when a concrete CLI is involved;
- native resume support and whether it preserves a session or only chat history;
- initial-prompt acceptance for sanitized handoff capsules;
- available interactive control channels;
- transcript format, owner, stability, and local root when observable;
- auth modes and explicit limitations;
- optional side-effect-free help evidence for local probing.

Command templates are argv arrays, never shell fragments. The defined
placeholders are `{prompt}`, `{sessionId}`, `{model}`, `{cwd}`, and
`{historyFile}`. A later executor must substitute them as individual argv
values and must never evaluate them through a shell.

Provider or billing rows may share an adapter family. For example,
`cli:codex` and the legacy `codex` route share `codex-cli`; this is one adapter,
not two bridges. API and local model-server rows do not claim native session
resume. Port Daddy owns their transcript and reconstructs continuation from a
capsule.

## Generated Capability Matrix

This table is generated from the catalog. Run
`node --import tsx scripts/generate-harness-adapter-doc.ts --write` after
changing adapter mechanics. The unit drift gate compares this section with the
renderer used by `pd backend adapters`.

<!-- BEGIN GENERATED HARNESS ADAPTER TABLE -->
| Adapter family | Backend routes | Spawn | Native resume | Handoff input | Live channel | Transcript | Auth | Known limitation |
|---|---|---|---|---|---|---|---|---|
| claude-code | cli:claude-code, claude-cli | `claude -p {prompt}` | session: `claude --resume {sessionId} -p {prompt}` | initial prompt | terminal, stream-json, remote-control | harness:claude-jsonl | oauth-subscription, api-key | Native resume requires a canonical UUID, an explicit Claude JSONL transcript reference, and daemon-witnessed session metadata bound to the canonical source workspace; another harness must enter through a sanitized handoff capsule. |
| codex-cli | cli:codex, codex | `codex exec --json {prompt}` | session: `codex exec resume {sessionId} {prompt}` | initial prompt | terminal, app-server | harness:codex-rollout-jsonl | oauth-subscription, api-key | Native resume requires a canonical UUID, an explicit Codex rollout reference, and daemon-witnessed session_meta bound to the canonical source workspace; cross-harness continuation creates a successor from a handoff capsule. |
| agy-cli | cli:agy | `agy --print {prompt}` | session: `agy --conversation {sessionId} --print {prompt}` | initial prompt | terminal | harness:agy-log | delegated-cli | Native resume requires a canonical UUID, the conversation-keyed brain transcript, and an exact workspace-to-conversation binding in Antigravity last_conversations metadata. Structured transcript streaming is not documented; Port Daddy currently captures prompt plus final output. |
| gemini-cli | cli:gemini | `gemini --prompt {prompt}` | session: `gemini --resume {sessionId} --prompt {prompt}` | initial prompt | terminal, acp | harness:gemini-session-json | oauth-subscription, api-key | Gemini UUID resume is project-scoped and requires an explicit chat reference; Port Daddy witnesses the canonical UUID, project hash, registry entry, chat file, and canonical workspace before launch. |
| groq-cli | cli:groq | `groq -p {prompt}` | handoff-only | initial prompt | terminal | none:none | delegated-cli, api-key | No stable session-id resume or structured transcript surface is documented for the installed Port Daddy integration. |
| grok-claude-proxy | cli:grok | `grok -p {prompt}` | handoff-only | initial prompt | terminal | none:none | delegated-cli | The current grok command is a Claude proxy, not an independent durable harness. Resume ownership remains with the underlying Claude session and is not exposed by the wrapper. |
| anthropic-api | claude | provider-sdk | handoff-only | initial prompt | http | port-daddy:port-daddy-jsonl | api-key | Provider calls have no native harness session identity; continuation is reconstructed from a handoff capsule. |
| gemini-api | gemini | provider-http | handoff-only | initial prompt | http | port-daddy:port-daddy-jsonl | api-key | Provider calls have no native harness session identity; continuation is reconstructed from a handoff capsule. |
| cloudflare-workers-ai | cloudflare | provider-http | handoff-only | initial prompt | http | port-daddy:port-daddy-jsonl | api-token | Provider calls have no native harness session identity; continuation is reconstructed from a handoff capsule. Workers AI model calls are stateless; Cloudflare Agents durable state is a separate runtime adapter, not implied by this row. |
| openai-api | openai | provider-http | handoff-only | initial prompt | http | port-daddy:port-daddy-jsonl | api-key | Provider calls have no native harness session identity; continuation is reconstructed from a handoff capsule. |
| groq-api | groq | provider-http | handoff-only | initial prompt | http | port-daddy:port-daddy-jsonl | api-key | Provider calls have no native harness session identity; continuation is reconstructed from a handoff capsule. |
| deepseek-api | deepseek | provider-http | handoff-only | initial prompt | http | port-daddy:port-daddy-jsonl | api-key | Provider calls have no native harness session identity; continuation is reconstructed from a handoff capsule. |
| xai-api | xai | provider-http | handoff-only | initial prompt | http | port-daddy:port-daddy-jsonl | api-key | Provider calls have no native harness session identity; continuation is reconstructed from a handoff capsule. |
| ollama | ollama | model-server-http | handoff-only | initial prompt | http | port-daddy:port-daddy-jsonl | local-none | A model server is not an agent harness; Port Daddy must own tools, transcript, state, and continuation. |
| lmstudio | lmstudio | model-server-http | handoff-only | initial prompt | http | port-daddy:port-daddy-jsonl | local-none | A model server is not an agent harness; Port Daddy must own tools, transcript, state, and continuation. |
| aider | aider | `aider --message {prompt}` | history: `aider --restore-chat-history --chat-history-file {historyFile} --message {prompt}` | initial prompt | terminal | harness:aider-chat-history | api-key, delegated-cli | History restoration replays messages but does not preserve a stable Aider session identity. |
| custom-command | custom | custom-command | handoff-only | initial prompt | none | port-daddy:custom | custom | Capabilities are operator-declared and remain unverified until a concrete adapter probe exists. |
<!-- END GENERATED HARNESS ADAPTER TABLE -->

## N:N Continuation Compatibility

The grid below is generated from the same adapter catalog. It expands every
source family against every target family and applies the exact `auto` rule the
continuation route uses: stable same-family session resume is native; every
other target that accepts initialization context receives a sanitized successor
handoff. The symbols describe mechanical paths, not conformance grants.

<!-- BEGIN GENERATED HARNESS CONTINUATION MATRIX -->
```text
Source                   01 02 03 04 05 06 07 08 09 10 11 12 13 14 15 16 17
01 claude-code            N  H  H  H  H  H  H  H  H  H  H  H  H  H  H  H  H
02 codex-cli              H  N  H  H  H  H  H  H  H  H  H  H  H  H  H  H  H
03 agy-cli                H  H  N  H  H  H  H  H  H  H  H  H  H  H  H  H  H
04 gemini-cli             H  H  H  N  H  H  H  H  H  H  H  H  H  H  H  H  H
05 groq-cli               H  H  H  H  H  H  H  H  H  H  H  H  H  H  H  H  H
06 grok-claude-proxy      H  H  H  H  H  H  H  H  H  H  H  H  H  H  H  H  H
07 anthropic-api          H  H  H  H  H  H  H  H  H  H  H  H  H  H  H  H  H
08 gemini-api             H  H  H  H  H  H  H  H  H  H  H  H  H  H  H  H  H
09 cloudflare-workers-ai  H  H  H  H  H  H  H  H  H  H  H  H  H  H  H  H  H
10 openai-api             H  H  H  H  H  H  H  H  H  H  H  H  H  H  H  H  H
11 groq-api               H  H  H  H  H  H  H  H  H  H  H  H  H  H  H  H  H
12 deepseek-api           H  H  H  H  H  H  H  H  H  H  H  H  H  H  H  H  H
13 xai-api                H  H  H  H  H  H  H  H  H  H  H  H  H  H  H  H  H
14 ollama                 H  H  H  H  H  H  H  H  H  H  H  H  H  H  H  H  H
15 lmstudio               H  H  H  H  H  H  H  H  H  H  H  H  H  H  H  H  H
16 aider                  H  H  H  H  H  H  H  H  H  H  H  H  H  H  H  H  H
17 custom-command         H  H  H  H  H  H  H  H  H  H  H  H  H  H  H  H  H

N = same-family native session path is mechanically available; H = sanitized successor handoff; — = unsupported.
Symbols describe mechanics only. Runtime proof appears separately as durable witnesses.
```
<!-- END GENERATED HARNESS CONTINUATION MATRIX -->

## Runtime Evidence Report

The generated grid is a mechanical ceiling, not a compliance badge. The daemon
serves `GET /harness-adapters/continuation-matrix` using
`pd.agent-harbor.harness-continuation-matrix.v0`. Each adapter exposes separate
catalog, discovery, spawn, exact-live-interaction, native-resume, and handoff
predicates. Completed `fleet_transcripts` witness spawn; completed
`agent_continuations` witness native or successor continuation. A future exact
live-control path must emit its own durable control receipt before that predicate
can become witnessed.

Every witness includes its durable id, observation time, age, and freshness.
Evidence older than seven days remains visible but stale. Catalog declarations,
help output, path existence, and agent self-report cannot become runtime proof.
Port Daddy therefore emits no aggregate numeric conformance level: mechanics,
discovery, transcript fidelity, and observed execution remain independently
inspectable facts.

### Interactive compaction evidence

Interactive context pressure is a separate, deliberately narrow witness. Claude
Code has the only registered interactive producer pair: a `UserPromptSubmit`
turn-time refresh, which can return bounded `additionalContext`, and the verified
`PreCompact` checkpoint. Both send bounded lifecycle metadata, never usage or raw
transcript text, to the local daemon. PreCompact may block a manual missing-plan
compaction but does not claim to deliver a warning through its discarded
`systemMessage` or `continue` fields. Registration alone grants no packet authority: before any event is
recorded, the daemon must resolve a daemon-owned provider-session → active,
verified `pd plan` binding. The hook cannot select a plan from ambient
`PD_SESSION_ID`; an unbound provider session is `provider-session-unbound` with
no receipt or packet. After binding, the absence of a trusted daemon/provider
measurement is `measurement-unavailable`; only then may an adapter-equipped
daemon apply `max(provider, daemon)` when a separately witnessed provider report
exists, or use its known daemon measurement. A cited packet additionally needs
the current durable plan checkpoint and daemon-owned complete tool-pair coverage;
unavailable or malformed coverage is `packet-withheld`. The default daemon wires
no operational binding or usage/tool-pair witnesses, so it issues no interactive
packet. Codex, Gemini, and agy have no simulated PreCompact registration. An
explicit governed packet-derived continuation reads the durable plan plus bounded
packet handles, never an exported provider transcript; it is not process
resurrection and the hook does not itself launch a successor.

Each trusted adapter measurement carries an opaque daemon-owned
`measurementRef`. The daemon binds that reference, plus any accepted native
measurement time, into the observation identity. A retry of the same watermark
replays its existing envelope and packet; a later adapter or durable-ledger
watermark creates a new boundary even when rounded usage and plan revision have
not changed. The durable fallback watermark is derived only from the same
bounded provider-work rows it measures, never from the plan, coverage, envelope,
or packet receipts it writes itself.

## Discovery Probe

`pd backend adapters --probe` is deliberately side-effect-free. It may:

1. resolve a declared executable using the same augmented CLI search path as
   backend readiness;
2. invoke help commands with a five-second timeout;
3. locate declared spawn/resume flag advertisements in help output; and
4. check whether an observed transcript root exists.

It never sends a model prompt, tests credentials, exercises spawn or resume,
parses transcript contents, or claims remote health. Results are `discovered`,
`unavailable`, `unverified`, or `not-supported`. `discovered` means only that a
binary advertises expected help tokens or a declared path exists. The JSON
report says `evidenceLevel: "discovery-only"` and `provesCapabilities: false` so
consumers cannot mistake this inventory for conformance. Provider readiness and
end-to-end continuation belong to higher conformance levels; help text and path
presence never earn them.

## Continuation Execution

`POST /memory/handoffs/:episodeId/continue` is the first executable conformance
level above discovery. Callers choose a concrete target backend and may request
`auto`, `native`, or `handoff` mode. `auto` restores the native session only when
the source and effective target share a session-scoped adapter family; every
other compatible target starts a successor from the sanitized capsule. An
explicit `native` request never falls back silently, while explicit `handoff`
always creates a successor even inside one adapter family.

The daemon revalidates the stored capsule and sanitizes the operator prompt,
resolves the effective backend after every persisted, environment, or preflight
override, and determines the mode against that effective adapter. Handoff mode
renders a versioned `pd.agent-harbor.handoff-successor-brief.v0` envelope with
durable identity, lineage, objective, every preserved operator turn, decisions,
coordination evidence, workspace state, artifacts, recent compacted context,
and explicit omission counts. The envelope marks historical content as data,
not new system or tool authority, and is scanned again before durable
acceptance. Raw provider transcripts never cross the boundary.

Workspace routing has a separate current-authority boundary. Paths inside the
historical capsule remain context only and never select the child cwd. A
handoff successor reuses the source's reverified canonical workspace when a
native witness exists. History-only, API, and model-server sources instead
require the caller to provide an explicit current `targetWorkdir`; the daemon
accepts only a user-owned absolute directory, captures its canonical
device/inode identity, hashes that binding into idempotency, and checks it again
immediately before spawn. An explicit target that conflicts with an available
source witness fails closed rather than redirecting the durable identity into a
different checkout.

Native mode remains conservative. A foreign family, history-only adapter,
stateless provider, or malformed session identifier becomes a durable
`unsupported` receipt without starting a child.

The source session is not trusted merely because a capsule names it. Native
session identifiers must have the UUID grammar exposed by these four harnesses,
so option-shaped values never reach an argv parser. Claude, Codex, and Gemini
require an explicit transcript reference rather than a harness-store scan.
Immediately before spawn the daemon repeats the bounded evidence check and
compares it with the stored witness. Claude and Codex bind JSONL metadata to the
canonical workspace, agy requires both its conversation-keyed brain transcript
and an exact `last_conversations` workspace binding, and Gemini binds the UUID
to its project registry, project hash, explicit chat file, and canonical
workspace. Evidence is opened once with no-follow semantics, read through that
descriptor under fixed byte and entry caps, and bound to file and workspace
device/inode identity. Paths outside harness roots, mismatched ids, stale
witnesses, and unavailable bindings fail closed without discarding the sanitized
handoff. The witnessed device/inode crosses the route boundary with the spawn
spec and is checked again immediately before the CLI child process is created,
closing the post-verification path-replacement window.

Accepted work is written to the canonical SQLite database before spawn. Each
receipt carries a daemon-generation owner and lease. Startup recovery orphans
only expired work owned by a prior generation; a second live connection cannot
take over an unexpired row. The `accepted` to `running` transition is a
compare-and-swap that must succeed before the child starts, and success is
returned only after the same owner durably advances the row to `completed`.
An idempotent retry against `accepted` or `running` returns HTTP 202 with
`success: false` and `pending: true`; it is never represented as completed work.
The receipt stores idempotency keys and prompts as SHA-256 hashes only; the
sanitized prompt still belongs to the ordinary governed spawn transcript.
Receipts preserve source episode, capsule,
session, agent, predecessor run, requested/effective backend and model, and the
successor run/session lineage. Acceptance uses one conflict-safe SQLite insert,
so concurrent callers with the same key recover the same receipt instead of
surfacing a raw uniqueness error or starting a second child.

The executable argv follows the catalog contract: Claude uses `--resume`, Codex
uses `exec resume`, agy uses `--conversation`, and Gemini uses `--resume`.
Codex resume does not inherit the fresh-spawn `--sandbox workspace-write` or
`-C` flags because the installed resume subcommand rejects those options; the
child process working directory remains the workspace boundary.

## Security and Privacy

- Cross-harness continuation always uses a sanitized handoff capsule,
  never a raw transcript copy.
- Runtime choice is explicit and receipt-backed: `auto` selects native only for
  a compatible session-scoped family, `native` never degrades, and `handoff`
  always initializes a successor through the target's ordinary governed spawn.
- Native resume is allowed only when source and target share an adapter family
  and adapter-specific local evidence witnesses the harness-owned session and
  source workspace both at handoff ingestion and immediately before spawn.
- Handoff successors never execute from a capsule-supplied path alone. They use
  the reverified source workspace or an explicit current `targetWorkdir`, with
  canonical device/inode revalidation before the child side effect.
- Native continuation records acceptance before the child side effect. Its
  receipt stores no raw operator prompt or idempotency key.
- Adapter templates remain argv data and cannot introduce shell evaluation.
- Auth modes describe ownership only. Credentials never enter the capability
  table, generated documentation, or probe report.
- Cloud and API rows remain handoff-only until a concrete runtime adapter can
  prove durable session identity and control semantics.

## Consequences

Adding a new harness now means implementing one catalog adapter, one capsule
ingress, and one conformance profile. Existing backends immediately gain an
honest compatibility view through the CLI and `/fleet/models`. The matrix is
intentionally conservative: missing evidence appears as unverified rather than
being inferred from provider marketing or a successful one-off model call.
