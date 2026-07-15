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
| claude-code | cli:claude-code, claude-cli | `claude -p {prompt}` | session: `claude --resume {sessionId} -p {prompt}` | initial prompt | terminal, stream-json, remote-control | harness:claude-jsonl | oauth-subscription, api-key | Native resume requires a Claude session id; another harness must enter through a sanitized handoff capsule. |
| codex-cli | cli:codex, codex | `codex exec --json {prompt}` | session: `codex exec resume {sessionId} {prompt}` | initial prompt | terminal, app-server | harness:codex-rollout-jsonl | oauth-subscription, api-key | Native resume requires a Codex session id; cross-harness continuation creates a successor from a handoff capsule. |
| agy-cli | cli:agy | `agy --print {prompt}` | session: `agy --conversation {sessionId} --print {prompt}` | initial prompt | terminal | harness:agy-log | delegated-cli | Structured transcript streaming is not documented; Port Daddy currently captures prompt plus final output. |
| gemini-cli | cli:gemini | `gemini --prompt {prompt}` | session: `gemini --resume {sessionId} --prompt {prompt}` | initial prompt | terminal, acp | harness:gemini-session-json | oauth-subscription, api-key | Gemini session identifiers are project-scoped and must be resolved before native resume. |
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

## Security and Privacy

- Cross-harness continuation always uses a later sanitized handoff capsule,
  never a raw transcript copy.
- Native resume is allowed only when source and target share an adapter family
  and a valid harness-owned session identifier.
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
