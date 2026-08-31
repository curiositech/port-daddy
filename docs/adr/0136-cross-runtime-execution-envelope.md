# ADR-0136: Cross-Runtime Execution Envelope

- **Status:** Proposed
- **Date:** 2026-08-30
- **Decision owners:** Port Daddy runtime, harness, Relay, and transcript maintainers
- **Roadmap:** `cross-runtime-execution-envelope-adr`; downstream implementation
  epic: `cross-runtime-execution-envelope`
- **Builds on:** [ADR-0040](0040-non-forgeable-actor-identity.md),
  [ADR-0045](0045-loud-fail-invariants-and-honest-attestation.md),
  [ADR-0049](0049-relay-architecture.md),
  [ADR-0091](0091-giant-squid-harness.md),
  [ADR-0092](0092-suggestibility-ladder-and-cloud-coordination-federation.md),
  [ADR-0095](0095-agent-run-saga-and-backend-authority.md),
  [ADR-0108](0108-port-daddy-harness.md),
  [ADR-0118](0118-harness-adapter-contract.md), and
  [ADR-0124](0124-transcript-redaction.md)
- **Related, disjoint work:** in-flight ADR-0135 owns Porthole's body-neutral
  stage, perspectives, completeness, disclosure, and replay model. This ADR
  owns execution identity and authority before those events become evidence.

## Context

Port Daddy currently uses several words as if they answered the same question:

- “OpenAI,” “Anthropic,” or “Cloudflare” may name a model provider.
- “local,” “Codex cloud,” “Claude Code on the web,” or “Worker” may name the
  place code executes.
- “Codex,” “Claude Code,” “Project Think,” or a custom Dream-style harness may
  name the component that owns the agentic loop.
- “Squid” may name lifecycle interception around somebody else's loop.
- “daemon,” “Relay,” or an embedded peer may name coordination authority and
  transport.
- “transcript” may mean a vendor's raw history, Port Daddy's operator
  projection, a handoff capsule, or a disclosed replay artifact.

Those are different coordinates. Collapsing them creates false statements such
as:

- a Codex cloud body is using the local Codex CLI because both are “Codex”;
- a Cloudflare Workers AI call is durable because Cloudflare Agents can be;
- `pd squid on` proves a lifecycle event fired;
- a cloud telemetry event proves Giant Squid governed the turn;
- a provider session id proves Port Daddy identity or authority;
- a transcript was governed merely because Port Daddy imported it afterward.

The present source already contains the pieces of a better answer, but not the
top-level contract:

- `lib/backend-catalog.ts` models adapter family, spawn transport, native
  resume, interactive channels, transcript ownership, authentication, and
  limitations. It intentionally says that Workers AI model calls are stateless
  and that Cloudflare Agents are a separate runtime.
- `lib/squid/hook-shape.ts` models verified vendor lifecycle events. Claude Code
  alone currently has the verified interactive `PreCompact` path; other
  adapters do not receive simulated parity.
- `lib/harness-conformance.ts` distinguishes catalog/discovery claims from
  witnessed spawn, interaction, resume, handoff, and transcript behavior.
- `lib/transcripts.ts` says the Fleet transcript is an operator projection and
  that caller-supplied producer metadata is not authority.
- `apps/fleet-executor/src/squid-events.ts` and
  `apps/fleet-executor/src/transcript-capture.ts` provide cloud telemetry and
  transcript capture. Their use of “squid” does not establish that the local
  Giant Squid hook pack governed a remote vendor loop.
- ADR-0118 defines same-harness native resume and sanitized cross-harness
  handoff, but it deliberately does not identify the execution substrate.

The external runtime landscape makes inference even less safe:

- Codex cloud creates a container, checks out the selected repository state,
  runs setup, then runs the agent loop. Agent internet access is off by default
  and secrets are removed before the agent phase, while ordinary configured
  environment variables persist. A local macOS daemon or Unix socket is not
  implied by that environment. See the official
  [OpenAI Codex cloud-environment documentation](https://developers.openai.com/codex/cloud/environments).
- Claude Code on the web runs on Anthropic-managed cloud infrastructure or a
  configured self-hosted environment, and its sessions persist independently
  of the browser. Claude Code separately documents lifecycle hooks, including
  HTTP hook delivery. Neither fact proves that a particular remote session
  reached Port Daddy. See
  [Claude Code on the web](https://code.claude.com/docs/en/claude-code-on-the-web)
  and [Claude Code hooks](https://code.claude.com/docs/en/hooks-guide).
- Cloudflare distinguishes the Agents SDK runtime from the agent harness. The
  runtime provides durable infrastructure; the harness owns the turn loop,
  prompt construction, model calls, tools, persistence, streaming, and
  lifecycle. The documented first-party harness is Project Think, and custom
  loops are supported. See
  [Cloudflare Agents harnesses](https://developers.cloudflare.com/agents/harnesses/).

As of 2026-08-30, Cloudflare's current harness catalog does not identify a
first-party product named Dream. “Dream” is therefore a custom harness identity
until a concrete implementation and manifest prove otherwise.

## Decision

Adopt a versioned, provider-neutral **Execution Envelope** as the sole canonical
answer to “what is this agent, where is it running, who governs it, and who owns
its record?”

The envelope is an attested description of one execution body. It is not a
prompt persona, a model card, a backend catalog row, a process environment dump,
or a transcript. An agent may read its envelope, but it may not mint or upgrade
its own authority by editing it.

### 1. Separate the six coordinates

Every execution is described along six independent axes:

```text
model provider
    -> execution locus
    -> agent-loop owner
    -> lifecycle governor
    -> coordination authority and transport
    -> transcript authority
```

The vocabulary is normative:

| Coordinate | Question answered | Examples |
| --- | --- | --- |
| Model provider | Who performs inference? | OpenAI, Anthropic, Workers AI, local model |
| Execution locus | Where does the body run? | local machine, Codex cloud container, Anthropic cloud, Cloudflare Worker, Cloudflare Sandbox |
| Loop owner | Who decides prompt/tool/continue/stop? | Codex CLI, Codex cloud, Claude Code, Project Think, `custom:dream`, Port Daddy |
| Governor | Who observes or constrains lifecycle phases? | local Squid, remote Squid adapter, embedded PD adapter, observe-only, none |
| Coordination authority | Who authorizes sessions, claims, notes, locks, and receipts? | local daemon, Relay peer, embedded isolated daemon, none |
| Transcript authority | Who owns the canonical raw conversation? | vendor harness, Port Daddy, remote provider, none |

No field is derived solely from another field. In particular, model provider
does not determine execution locus or loop owner, and execution locus does not
prove coordination authority.

### 2. Canonical envelope

`ExecutionEnvelopeV1` has this logical shape. The implementation may use a
generated JSON schema and TypeScript types, but it must preserve these fields
and semantics:

```ts
interface ExecutionEnvelopeV1 {
  schema: 'pd.execution-envelope.v1';
  executionId: string;
  parentExecutionId?: string;
  issuedAt: string;
  expiresAt?: string;

  model: {
    provider: string;
    modelId?: string;
  };

  execution: {
    locus:
      | 'local-machine'
      | 'codex-cloud'
      | 'anthropic-cloud'
      | 'cloudflare-worker'
      | 'cloudflare-sandbox'
      | 'self-hosted-remote'
      | 'unknown';
    controller: string;
    nativeSessionId?: string;
  };

  loop: {
    owner: string;
    protocol?: string;
  };

  governor: {
    owner: 'squid-local' | 'squid-remote' | 'embedded-port-daddy' | 'observe-only' | 'none';
    mode: 'enforced' | 'observed' | 'projected' | 'none';
  };

  coordination: {
    authority: 'local-daemon' | 'relay-peer' | 'embedded-isolated-daemon' | 'none';
    transport: 'unix-socket' | 'tcp-loopback' | 'relay' | 'https-hooks' | 'mcp' | 'none';
    projectId?: string;
    pdSessionId?: string;
    runId?: string;
  };

  transcript: {
    authority: 'harness' | 'port-daddy' | 'remote-provider' | 'none';
    format?: string;
    reference?: string;
    digest?: string;
    disclosure: 'raw-local' | 'sanitized-projection' | 'handoff-capsule' | 'none';
  };

  lifecycle: Partial<Record<LifecyclePhase, LifecycleCapability>>;

  attestation: {
    issuer: string;
    assurance: 'attested' | 'observed' | 'unattested';
    capabilityRef?: string;
    envelopeDigest: string;
    signature?: string;
  };
}

type LifecyclePhase =
  | 'session-start'
  | 'prompt'
  | 'pre-tool'
  | 'post-tool'
  | 'pre-compact'
  | 'post-compact'
  | 'stop'
  | 'resume'
  | 'transcript';

interface LifecycleCapability {
  state: 'enforced' | 'observed' | 'unsupported' | 'unknown';
  producer?: string;
  witness?: string;
}
```

Identifiers are links, not authority. `nativeSessionId`, `pdSessionId`, and
`runId` remain distinct because they are minted by different owners and have
different trust domains.

The envelope contains no bearer secret. A capability reference may identify an
attenuated credential held outside the transcript and agent-visible prompt.

### 3. Resolution is fail-closed

An agent resolves its execution identity in this order:

1. **Attested envelope.** Consume an envelope signed or otherwise
   daemon-verifiable by the local daemon, Relay controller, or embedded
   coordinator.
2. **Native lifecycle evidence.** Add observations from authenticated vendor
   events or controller metadata. Native evidence may fill an unknown field or
   lower confidence; it may not grant coordination authority or expand a
   capability.
3. **Local discovery.** Process, environment, configuration, and socket
   discovery may explain a body for diagnostics. They do not prove governance.
4. **Unattested/direct.** If the authority cannot be proved, emit an envelope
   with `assurance: 'unattested'`, unknown or `none` fields, and no invented
   lifecycle capabilities.

Environment variables are transport, not proof. A proposed
`PD_EXECUTION_ENVELOPE` variable may carry a signed envelope or an immutable
reference to one, but an unsigned value is self-assertion. This matters in Codex
cloud, where configured environment variables can persist into the agent phase
but setup-time secrets do not.

The system must never infer any of the following from a provider name, model id,
CLI executable, current working directory, or marketing label:

- Squid enforcement;
- access to the operator's local daemon;
- a valid Port Daddy session;
- transcript completeness;
- resumability;
- permission to claim, edit, spawn, disclose, or recover.

### 4. Nested harnesses form an execution graph

Subsumption is explicit rather than magical. A parent controller that launches
or observes a child execution creates a directed edge between two envelopes.

The graph obeys these invariants:

1. One execution has exactly one loop owner.
2. Each lifecycle phase has at most one authoritative producer. Other layers
   may observe the phase but may not re-emit it as a second authoritative event.
3. An outer governor may constrain, observe, normalize, archive, or stop a child.
   It may not silently replace the child's loop or claim an unsupported phase.
4. Child capabilities and authority are subsets of the capability granted by
   the parent edge. Delegation attenuates; it never amplifies.
5. Parent edges bind the child envelope digest, subject, action, expiry, and
   replay identity. Envelope graphs reject cycles and bounded-depth overflow.
6. Lifecycle events deduplicate by `(executionId, phase, nativeEventId | seq)`.
7. A `tool_use` and its matching `tool_result` are one transcript/compaction
   unit. No governor, handoff, or truncation boundary may split the pair.

This lets Port Daddy wrap a vendor loop without claiming to own that loop, and
lets a durable cloud harness use Port Daddy coordination without pretending a
macOS daemon is inside the Worker.

### 5. Normalize lifecycle evidence, not raw transcripts

Every adapter projects witnessed lifecycle activity into
`pd.execution.event.v1`:

```ts
interface ExecutionEventV1 {
  schema: 'pd.execution.event.v1';
  executionId: string;
  phase: LifecyclePhase;
  nativeEventId?: string;
  seq?: number;
  occurredAt: string;
  producer: string;
  authority: 'authoritative' | 'observer';
  payloadRef?: string;
  payloadDigest?: string;
  redaction: 'none' | 'sanitized' | 'withheld';
}
```

The raw transcript stays with its declared authority. Port Daddy stores:

- the execution envelope and its digest;
- normalized, idempotent lifecycle events;
- bounded sanitized projections needed for operator status and receipts;
- immutable references and digests for externally owned records;
- disclosure and truncation receipts required by ADR-0124 and Porthole.

Port Daddy does not copy a provider's raw transcript merely to claim ownership.
Cross-harness continuation uses ADR-0118's sanitized handoff capsule. An imported
historical transcript is `observed`; import does not retroactively make the run
governed, enforced, complete, or resumable.

### 6. Canonical case matrix

| Case | Execution locus | Loop owner | Governor | Coordination | Transcript authority | Current truth |
| --- | --- | --- | --- | --- | --- | --- |
| Local Claude Code | local machine | Claude Code CLI | local Squid for witnessed phases | local daemon over socket/TCP | harness, PD projection | Partial: Claude prompt, pre-tool, stop, and PreCompact paths exist; firing and daemon evidence must still be witnessed |
| Local Codex/Gemini/agy | local machine | vendor CLI | local Squid for registered phases | local daemon over socket/TCP | harness or adapter, PD projection | Partial: do not infer Claude's PreCompact parity |
| Codex cloud | Codex cloud container | Codex cloud | none until a controller/adapter produces an attested witness | proposed Relay/MCP/HTTPS peer | remote provider | Proposed integration; a repository checkout and environment variable alone do not prove Squid |
| Claude Code web | Anthropic cloud or configured self-hosted environment | Claude Code web | proposed remote adapter using authenticated lifecycle hooks where configured | proposed Relay/HTTPS peer | remote provider | Proposed integration; an HTTP hook is observed or enforced only after its response/event is witnessed |
| Cloudflare Project Think | Cloudflare Agents runtime | Project Think | embedded Port Daddy adapter, not a second agent loop | Relay peer or embedded isolated daemon | Think/Durable Object store, PD projection | Proposed integration; runtime durability and harness behavior remain separate fields |
| Custom Dream-style harness | declared runtime | `custom:dream` | manifest-declared adapter | declared, attested peer or none | manifest-declared | Unverified until a concrete harness supplies a signed manifest and conformance evidence |
| Provider API called by Port Daddy | caller's runtime | Port Daddy | embedded Port Daddy | daemon or embedded coordinator | Port Daddy | Harnessed, not “raw direct”: the provider call may be stateless while PD owns the loop and record |
| Foreign raw provider call | unknown/caller | none or unknown | none | none | caller or none | Direct/unattested. May be imported later only as observed evidence |

The matrix is not a promise of feature parity. Each row is resolved at runtime
from an envelope plus witnessed lifecycle capabilities.

### 7. “Direct” has one precise meaning

“Direct” means no declared agent-loop owner or lifecycle governor is available
to Port Daddy for that call. It does **not** mean “the model was reached through
an HTTP API.”

- A Port Daddy loop calling the OpenAI, Anthropic, Gemini, or Workers AI API is
  harnessed by Port Daddy.
- Project Think calling a model API is harnessed by Think.
- A one-off foreign model request with no declared loop, governance, or durable
  record is direct.
- Importing its output later does not change its historical classification.

This definition removes the false opposition between “API” and “harness.” The
question is who owns the loop and its lifecycle, not which network client sent
the inference request.

### 8. Operator and agent surfaces

Implementation must expose one canonical read model through:

- `GET /execution/context` for the current authenticated body;
- `pd execution status --json` for agents and diagnostics;
- an `execution_status` MCP tool;
- FleetBar and dashboard copy answering, in plain language:
  - where the agent runs;
  - who owns its loop;
  - which lifecycle phases Port Daddy actually governs;
  - how it coordinates;
  - who owns the raw transcript;
  - whether each claim is attested, observed, or unknown.

These surfaces are **proposed**, not shipped by this ADR. Until implemented,
existing adapter, Squid, session, relay, and transcript status remain separate
witnesses and must not be summarized as stronger authority than they prove.

Example operator copy:

> This agent runs in Anthropic Cloud. Claude Code owns its loop. Port Daddy has
> observed prompt and tool events through an authenticated remote hook, but it
> does not own the raw transcript. Coordination uses a Relay peer.

The UI must never reduce this to a green “Squid on” badge.

## Security and trust boundaries

- The envelope issuer must bind project, actor/body subject, execution id,
  parent digest, capability set, expiry, and replay identity.
- Native vendor identifiers are evidence links, not Port Daddy principals.
- A remote adapter receives only the capability needed to submit its declared
  events or coordination operations.
- Relay federation remains a peer under ADR-0092; it does not become universal
  authority merely because a body is remote.
- The envelope and normalized event projection must not contain provider API
  keys, hook bearer tokens, operator credentials, or raw secret values.
- Transcript references must obey ADR-0124 redaction and disclosure boundaries.
- Missing, expired, malformed, cyclic, over-broad, or unverifiable envelopes
  fail closed to `unattested`, never open to ambient local authority.
- A remote HTTP hook transport that fails open at the vendor boundary must be
  represented as observed or unknown, not enforced.

## Implementation sequence

Each phase is independently testable and must retain current-vs-target labels:

1. Add `lib/execution-envelope.ts`, generated schema, validation, digesting,
   authority attenuation, and spoof/cycle/replay tests.
2. Separate runtime adapter identity from model/backend catalog identity without
   preserving a legacy inference path.
3. Add the normalized execution-event projection and idempotent transcript
   references. Preserve tool-call/result atomicity.
4. Make local hook installation mint or retrieve an attested local envelope;
   conformance tests must prove actual event firing, not configuration presence.
5. Add remote adapters independently:
   - Codex cloud controller/environment bootstrap carrying a signed non-secret
     envelope reference;
   - Claude authenticated HTTP lifecycle adapter where the remote environment
     supports it;
   - Cloudflare Think/custom-harness extension that emits events without
     becoming a second loop.
6. Add CLI, MCP, FleetBar, and dashboard read models.
7. Add conformance fixtures for every matrix row, including missing daemon,
   missing Relay, spoofed environment, duplicate events, unsupported phases,
   nested attenuation, raw direct import, and transcript-owner disagreement.
8. Update the public and internal Port Daddy skills only when the corresponding
   surfaces are implemented and verified. Do not teach proposed commands as
   shipped behavior.

This ADR does not retain a compatibility mode that guesses the execution type
from the backend name. The explicit envelope supplants that inference once its
read path ships.

## Consequences

### Positive

- Every local and remote case has the same reasoning model without pretending
  they have the same capabilities.
- Agents can state what they are from attested context instead of self-diagnosis.
- Squid becomes an explicit governor, not an overloaded synonym for agent,
  daemon, transcript, or cloud telemetry.
- Nested harnesses compose through authority attenuation and event deduplication.
- Transcript import, continuation, governance, and disclosure stop collapsing
  into one ambiguous “captured” state.
- Operator UI can explain mixed local/cloud execution without exposing terminal
  archaeology.

### Negative

- Every launcher and remote adapter must carry more explicit metadata.
- There is no honest universal “harnessed: true” boolean; lifecycle capability
  status is a matrix.
- External provider changes require conformance refresh and may lower a row from
  enforced to observed or unknown.
- Remote enforcement may be impossible when the vendor's hook failure semantics
  are fail-open. The envelope must expose that limitation.

### Risks

- If the envelope becomes decorative metadata instead of verified authority, it
  recreates the ambiguity under a new name.
- If Port Daddy stores raw remote transcripts by default, it violates the
  ownership and privacy separation this ADR establishes.
- If outer governors double-emit events, receipts and context-pressure decisions
  can replay or count twice.
- If UI compresses per-phase truth into one badge, operators will again confuse
  installation, observation, and enforcement.

## Alternatives considered

### Infer runtime from the backend catalog

Rejected. A model backend does not identify execution locus, loop owner, or
coordination authority. The same provider may be called by Port Daddy, Think,
Claude Code, Codex cloud, or a raw script.

### Treat every remote body as a small Port Daddy daemon

Rejected. Some cloud runtimes can host an isolated daemon, but that is one
coordination topology, not the universal case. Forcing it onto every provider
duplicates loop ownership, misstates local socket authority, and couples agent
identity to a process that may not exist.

### Treat Relay as the harness

Rejected. Relay transports and federates coordination. It does not construct
prompts, choose tools, or decide when the model loop stops.

### Copy every transcript into Port Daddy

Rejected. Copying is not authority, does not prove completeness, and expands the
privacy boundary. Normalized events, immutable references, digests, sanitized
handoff capsules, and explicit disclosure receipts are sufficient.

### One `harnessed: boolean`

Rejected. A body can have prompt observation, pre-tool enforcement, no
PreCompact support, Relay coordination, and a provider-owned transcript at the
same time. The boolean destroys the exact information operators and agents need.

## Acceptance criteria

The architecture is complete only when the implementation can demonstrate:

1. the same provider under two loop owners produces different envelopes;
2. local Codex and Codex cloud cannot be confused;
3. Workers AI direct inference and Project Think cannot be confused;
4. a configured hook without a witnessed event cannot claim enforcement;
5. a child cannot expand parent authority;
6. duplicate remote lifecycle delivery is idempotent;
7. compaction and handoff preserve tool-call/result pairs;
8. raw transcript ownership remains external when declared external;
9. imported direct output remains historically unattested;
10. FleetBar presents unknown and partial truth without a terminal requirement.
