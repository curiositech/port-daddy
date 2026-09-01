# SHIPWRIGHT — the Archetype

> *"Shipwright is an actor on the Plane like every other agent.
> It just happens to read the repo, propose a fleet, and spend Opus tokens
> doing it."*

**Status:** Archetype spec — 2026-04-19
**Scope:** ONE archetype on the Plane defined in `AGENT-MODEL.md`.
**Read `AGENT-MODEL.md` first** for the soul/body duality, the seven
canonical archetypes, and the migration plan. This doc only specifies
what's Shipwright-specific.
**Skills invoked:** `klein-1998-sources-of-power` (RPD reasoning),
`khattab-2023-dspy` (structured prompt),
`park-2023-generative-agents` (episodic memory),
`fipa-00037-communicative-act-library` (message grammar).

---

## 0. One-paragraph summary

Shipwright is an actor (`daemon:shipwright`) of archetype `shipwright`
on the Plane. Its body — when activated — is an Opus-class LLM
invocation, bond-gated and budget-gated like every other body. Its
soul holds episodic memory of prior `(survey, proposal, outcome)`
triples and the current simulation state. It receives seven kinds of
messages from the CLI, the dashboard, and other agents; it replies
with structured proposals, simulation events, and chat turns. Nothing
about the runtime is Shipwright-specific — the runtime lives in
`AGENT-MODEL.md`. The archetype's *content* is what follows.

---

## 1. Shipwright's place on the Plane

Everything in §1–§5 of the previous draft has moved to `AGENT-MODEL.md`
because it applied to every archetype, not just Shipwright. Read that
doc for:

- The soul/body duality.
- The mapping from Port Daddy's existing primitives to actor-runtime
  concepts.
- The full archetype catalog (seven archetypes).
- Hewitt's three axioms plus Port Daddy's two extra rules (bond-before-
  body, no-silent-death).
- The FIPA-lite message vocabulary.
- The zero-break migration plan.

What follows is only what makes `archetype: shipwright` different from
the other six.

---

## 1b. (Legacy framing, kept for the commit trail)

Port Daddy was built feature-first — spawners, cost trackers, sessions —
and the actor semantics emerged implicitly. Making them explicit costs
almost nothing and buys a lot:

- **Addressability.** `port-daddy:fleet:spark` is an address, not a
  container. Whether spark is asleep, running, or mid-rehydration, the
  caller writes the same one line: `actorRef('port-daddy:fleet:spark').tell(msg)`.
- **Location transparency.** Same API whether the actor runs in the
  local daemon, in a child process, or on a remote daemon. Lets us grow
  from single-daemon to a daemon mesh without rewriting agent code.
- **Mailboxes.** Each actor has a FIFO mailbox. No race conditions
  within an actor's handler — the single-threaded-per-actor guarantee is
  why the virtual actor model is so forgiving.
- **State rehydration.** If the daemon crashes mid-session, every actor
  rehydrates from SQLite and resumes from its last persisted belief
  state. Matches the salvage queue we already have — this just
  generalizes the idea.
- **Cost control.** An actor not handling a message is charged $0 in
  compute and tokens. "Always on" becomes "always addressable," not
  "always burning." That is the whole point.
- **Named conversations.** When Shipwright needs to talk to hawk, it
  sends a FIPA-style `request` performative, not a shell command. Audit,
  replay, and simulation all follow for free.

We will use BDI terminology (belief/desire/intention) where it clarifies
and ignore it where it would obscure. The honest pedigree is Hewitt
→ Agha → Orleans → our daemon.

---

## 2. The runtime (`lib/actors.ts`, new) <!-- cite-exempt -->

One small module holds the abstraction. It wraps existing Port Daddy
state; it does not duplicate it.

```ts
/**
 * lib/actors.ts — virtual actor runtime for Port Daddy.
 *
 * WHY THIS MODULE EXISTS
 *   Port Daddy already stores agent identity, session state, and
 *   messages across several tables and modules. This file is the thin
 *   supervisor that gives them unified semantics: addressable by
 *   identity, activated on first message, deactivated when idle,
 *   rehydrated on demand.
 *
 * THE RULES (Hewitt / Agha)
 *   1. An actor processes one message at a time. No shared state
 *      between actors.
 *   2. Message delivery is asynchronous. `tell` does not wait for a
 *      reply; `ask` returns a Promise bounded by a timeout.
 *   3. An actor may spawn other actors, send messages, and change its
 *      own state — nothing else.
 *   4. Actors deactivate when their mailbox has been empty for
 *      `idleTimeoutMs` (default 10 min). State persists; behavior
 *      unloads. Next message re-activates.
 *
 * WHAT LIVES WHERE
 *   - Identity        → existing `agents` table (id = identity string)
 *   - Mailbox         → existing `agent_inbox` (per-agent queue)
 *   - State           → existing `sessions` + notes  (append-only)
 *   - Ambient signals → existing `pheromone` + `tuples`
 *   - Handler code    → a registry keyed by archetype (this module)
 *
 * @example
 *   const ref = actorRef('port-daddy:fleet:hawk');
 *   await ref.tell({ kind: 'ci.duration.delta', payload: { pct: 0.21 } });
 *
 *   const ans = await ref.ask<ShipPlan>(
 *     { kind: 'shipwright.describe' },
 *     { timeoutMs: 5_000 }
 *   );
 */
```

Core surface (sketch — will be fully fleshed in the PR):

```ts
export type ActorIdentity = string; // "<fleet>:fleet:<agent>" OR "daemon:shipwright"
export interface ActorMessage<K extends string = string, P = unknown> {
  kind: K;
  payload: P;
  from?: ActorIdentity;
  correlationId?: string;
}

export interface ActorRef {
  identity: ActorIdentity;
  tell(msg: ActorMessage): Promise<void>;
  ask<R>(msg: ActorMessage, opts?: { timeoutMs?: number }): Promise<R>;
}

export interface ActorBehavior<S> {
  /** The archetype name this behavior implements. */
  archetype: string;
  /** Initial belief state when a brand-new actor wakes for the first time. */
  initial(identity: ActorIdentity): S;
  /** Message handler. Returns the next belief state. */
  receive(
    state: S,
    msg: ActorMessage,
    ctx: ActorContext,
  ): Promise<S>;
}

export interface ActorContext {
  self: ActorIdentity;
  spawn(childIdentity: ActorIdentity, archetype: string): ActorRef;
  tell(to: ActorIdentity, msg: ActorMessage): Promise<void>;
  ask<R>(to: ActorIdentity, msg: ActorMessage): Promise<R>;
  /** Pheromone signal (ambient). */
  emit(channel: string, strength: number): void;
  /** Bond-aware spawn (routes through `lib/bonds.ts` and `lib/spawner.ts`). */
  runAgent(prompt: string, opts: RunAgentOptions): Promise<RunResult>;
  /** Append a note to the current session. */
  note(text: string, voice?: MaritimeVoice): Promise<void>;
}
```

The module does five things:

1. **Registry.** `registerArchetype(behavior)` — archetypes declare
   themselves at boot. The default 12 archetypes live in
   `lib/archetypes/*.ts`. Third-party archetypes (if we expose it) go
   through the registry too.
2. **Activation.** When a message arrives for an identity, look up the
   archetype (via `agents.archetype` column — new column added in the
   bonds migration), load its behavior, restore state from the latest
   session, run the handler, persist the next state.
3. **Deactivation.** A per-actor inactivity timer. No messages for
   `idleTimeoutMs` → behavior unloaded. State is already persistent so
   unloading is free.
4. **Supervision.** If a behavior throws, the runtime logs an arbiter
   violation, optionally slashes the bond, and either restarts (for
   transient errors) or quarantines (for repeated errors). Classic
   Erlang-style let-it-crash, but slower to quarantine (three strikes).
5. **Observability.** Every receive, every state transition, every
   outbound message emits events on the `actor:lifecycle` pub/sub
   channel. FleetControl Panel subscribes.

---

## 3. Shipwright as an actor

Shipwright is just another actor, identity `daemon:shipwright`. It's
special only in that it runs opus-class prompts (expensive) and it can
address any other actor.

```ts
// lib/archetypes/shipwright.ts
export const shipwrightBehavior: ActorBehavior<ShipwrightState> = {
  archetype: 'shipwright',
  initial: () => ({
    episodicMemory: [],     // past survey → propose → outcome triples
    currentProposals: {},   // projectId → ProposedFleet
    activeSimulations: {},
  }),
  receive: async (state, msg, ctx) => {
    switch (msg.kind) {
      case 'shipwright.survey.request':     return onSurveyRequest(state, msg, ctx);
      case 'shipwright.propose.request':    return onProposeRequest(state, msg, ctx);
      case 'shipwright.simulate.start':     return onSimulateStart(state, msg, ctx);
      case 'shipwright.simulate.tick':      return onSimulateTick(state, msg, ctx);
      case 'shipwright.chat':               return onChat(state, msg, ctx);
      case 'shipwright.apply':              return onApply(state, msg, ctx);
      case 'actor.lifecycle':               return onLifecycle(state, msg, ctx);
      default:                              return state;
    }
  },
};
```

### 3.1 Survey

- Walks the repo (only metadata: manifest files, README, PRD, git log
  numstat, sentry config). Never reads source code in bulk.
- Runs one Haiku call per project directory with a bounded context
  (~4k tokens in, 500 out). Per-project cost ≈ $0.001.
- Writes `shipwright.survey.json` as both a local file and a tuple
  (so other actors — scribe, researcher — can retrieve it).

### 3.2 Propose

- Loads survey, episodic memory, skill corpus retriever.
- Drafts a fleet within the budget envelope and the bond ceiling.
- **Klein RPD.** Retrieves up to 3 exemplar fleets from episodic memory
  ("this repo looks like `jury_rig:2026-02`") and uses the first one that
  passes acceptance gates. This is *recognition-primed* — simulate the
  first plausible answer rather than search the space. The exemplar is
  shown in the UI rationale.
- **DSPy-style prompt.** The Shipwright prompt template is a tiny DSPy
  program (`khattab-2023-dspy`) so we can iterate the prompt structurally
  rather than textually. Fields: `input=survey, skill_corpus, budget`
  → `output=fleet, rationale, exemplarId, confidence`.
- Emits `pd-fleet.yml.proposed`.

### 3.3 Simulate

- Spawns a `FleetRunner` with `dryRun: true`.
- Subscribes to its `onSyntheticEvent` callback, relays each event on
  `shipwright:sim:<id>` pub/sub channel. The UI's SSE endpoint proxies
  this to the browser.
- At simulation end: runs acceptance gates. If any fail, proposes a
  revision (auto-iterating up to 3 times), reports residual risk.

### 3.4 Chat

- One Shipwright actor per project; its mailbox carries user messages.
- Chat history persists in the session. No rolling summarization yet
  (context is small enough); will add once transcripts grow.

### 3.5 Apply

- Diffs current `pd-fleet.yml` vs `.proposed`.
- Requires human-confirmed apply unless `--force`.
- On apply, the existing `fleet-daemon.ts` SIGHUP path picks up the new
  config and the archetype actors take over.

---

## 4. Fleet agents as actors

Every archetype (sentinel, sweeper, scribe, hawk, spark, …) has a
behavior file in `lib/archetypes/*.ts`. Each one:

1. Subscribes to its trigger (cron, file-watch, webhook, tuple
   pattern, git-pr). Triggers are external to the actor; they call
   `tell` on the actor's identity.
2. On receive: posts a bond via `ctx.runAgent`, which in turn routes
   through `lib/bonds.ts` (escrow) → `lib/budget-guard.ts` (preflight)
   → `lib/spawner.ts` (actual LLM call). Bond slash semantics fire
   automatically on budget breach.
3. Emits notes, commits, tuples as artifacts.
4. Deactivates when its trigger is silent.

This is a big mental shift: **archetypes are code; instances are
identities.** `sentinel-a1` and `sentinel-a2` are two instances of the
same behavior, running in isolation, each with their own bond.

---

## 5. Skill retrieval (`lib/skill-index.ts`, new) <!-- cite-exempt -->

Global rule: no keyword-based NLP. Skill retrieval must be embeddings.

```
┌────────────────────────────────────────────────────────────┐
│ ~/coding/wrkgroup-ai/skills/*/SKILL.md                     │
│          ↓ (nightly + on git HEAD change)                  │
│ embed each SKILL.md's YAML frontmatter + first 500 tokens  │
│ via Voyage AI `voyage-3-lite` (cheap, good)                │
│          ↓                                                 │
│ SQLite at ~/.port-daddy/skill-index.sqlite                 │
│   CREATE TABLE skills(id, path, name, description,         │
│                       embedding BLOB)                      │
│          ↓                                                 │
│ runtime: cosine search, top-k (default 5)                  │
└────────────────────────────────────────────────────────────┘
```

Why Voyage specifically? Anthropic recommends them for API users;
`voyage-3-lite` is $0.02 / 1M tokens so re-embedding 541 skills is
a fraction of a penny. If Voyage goes down we fall back to OpenAI's
`text-embedding-3-small` (also cheap). Both stored interchangeably
in the SQLite blob because the similarity computation is the same
algorithm (cosine on L2-normalized floats).

Cache invalidation: watch `~/coding/wrkgroup-ai/.git/HEAD` — when
it changes, re-embed only the changed `SKILL.md` files (cheap diff).

```ts
/**
 * skillIndex.search('quarantine flaky tests', { topK: 5 })
 * → [
 *     { id: 'vitest-testing-patterns',    score: 0.84, ... },
 *     { id: 'qa-automation-specialist',   score: 0.71, ... },
 *     { id: 'high-quality-vibe-coding',   score: 0.67, ... },
 *     ...
 *   ]
 *
 * @example
 *   // From inside an archetype's receive handler
 *   const hits = await ctx.ask('daemon:skill-index', {
 *     kind: 'skill.search',
 *     payload: { query: msg.payload.problemDescription, topK: 5 },
 *   });
 */
```

Skill-index is itself an actor (`daemon:skill-index`). Single-threaded
per actor means no concurrent SQLite reads racing on the cache miss
path.

---

## 6. Episodic memory (Park-2023 generative agents)

Shipwright keeps a rolling store of `(survey, proposal, outcome)` triples.
Outcome = "this fleet survived 30d at $X/d with Y violations." This is
the exemplar store Klein's RPD pattern-matches against.

Implementation: another actor (`daemon:episodes`). Same SQLite file,
different table. Retrieval uses embeddings over the survey portion.
Park-2023's generative-agents paper describes this memory model well;
we don't need their reflection/summarization step yet (our episodes are
already short structured JSON).

---

## 7. Message grammar (FIPA-lite)

Inter-actor messages use a trimmed FIPA performative vocabulary:

| Performative | Used for |
|---|---|
| `inform` | one-way data (`ci.duration.delta`, `doc.drift.detected`) |
| `request` | asks the receiver to do something bounded |
| `query-if` | asks "is X currently true?" |
| `propose` / `accept` / `reject` | negotiation (used by the merge queue already) |
| `subscribe` / `cancel` | pub/sub registration |
| `failure` / `not-understood` | error paths |

Implementing FIPA verbatim would be overkill. The subset above maps
1:1 to primitives we already have — `inform` = pub, `request` = ask,
`subscribe` = pub/sub join. We adopt the *vocabulary* for consistency
with the literature (`fipa-00037-communicative-act-library`), not the
wire format.

---

## 8. Lifecycle worked example

A day in the life of `port-daddy:fleet:hawk`:

```
02:00  daemon boot → fleet-daemon reads pd-fleet.yml → registers actor
                     'port-daddy:fleet:hawk' behavior (no activation yet)

07:41:00  CI reports merge-queue bench duration +21% vs baseline →
          lib/triggers/ci.ts publishes 'inform' to hawk's mailbox

07:41:00  runtime activates hawk's behavior (rehydrate state: 0 bytes,
          first run of the day) → receive() fires

07:41:00  hawk: ctx.runAgent(prompt=..., bondUsd=0.30, budgetUsd=1.00)
            └─ bonds.escrow($0.30) → ok, $16.20 wallet → running
            └─ spawner.spawn(claude-cli, sonnet) → pid 31401
            └─ agent runs, writes notes, opens WIP branch, writes test

07:41:12  spawner.onCharge($0.82) → budgetGuard.onCharge
            └─ returns { kill: true }  (> $1.00 not reached yet because
               this is the rolling-hour tally, but 80% throttle tripped)
          Actually: returns { kill: false, throttle: true } at 80%
            → runtime emits 'agent.throttled' pheromone
            → FleetControl Panel row turns amber

07:41:15  hawk internal: finishes thought, ctx.note("throttled, will
          wait 10m"), drops to idle

07:51:15  idleTimeoutMs elapses → behavior unloaded, state persisted
          Actor still addressable; future messages re-activate it.

08:00:00  next hour window opens → budget resets → agent wakes to
          finish its WIP branch

09:03:17  PR merged. hawk emits `inform` to scribe: "regression-fix
          merged, update post-mortem doc". scribe wakes.
```

Everything above is **observable** via the `actor:lifecycle` channel.
FleetControl renders it. The audit log in the panel is a projection.

---

## 9. Concrete module layout after this lands

```
lib/
  actors.ts              # runtime — registry, activation, supervision
  archetypes/
    shipwright.ts        # the meta-agent
    sentinel.ts          # QA Sentinel
    sweeper.ts           # Typesafety
    scribe.ts            # Documentarian
    hawk.ts              # Perf Hawk
    spark.ts             # strategic reflection (opus monthly)
    sentry.ts            # Sentry Responder
    gardener.ts
    dock-master.ts
    simplifier.ts
    researcher.ts
    canary.ts            # Browser Canary (playwright hot-path)
  skill-index.ts         # embeddings + cosine search, SQLite-backed
  episodes.ts            # Shipwright's pattern library
  triggers/
    cron.ts
    file-watch.ts
    webhook.ts
    tuple.ts
    ci.ts
    git.ts
routes/
  shipwright.ts          # /shipwright/survey, /propose, /simulate, /apply, /chat
  actors.ts              # /actors, /actors/:id/inbox, /actors/:id/state (observability)
tests/
  unit/actors.test.ts
  unit/shipwright.test.ts
  unit/skill-index.test.ts
  integration/shipwright-end-to-end.test.ts
  integration/actor-lifecycle.test.ts
```

~1200 lines of new code, ~800 of tests. Actor runtime is the smallest
piece; most of the weight is in the individual archetype behaviors
(each 50–120 lines — short because the runtime does the heavy lifting).

---

## 10. What I'm explicitly punting

- **Cross-daemon actors.** A daemon mesh where `jury_rig:fleet:hawk`
  lives on a different machine than `port-daddy:fleet:hawk`. V3. The
  existing Port Daddy IPC already foreshadows this.
- **Scheduled state snapshots.** Snapshot an actor's state every N
  messages for faster rehydration. Not needed at current scale.
- **Reflection summaries (Park-2023).** Rolling-up episodic memory
  into higher-level insights. Cheap to add later once we have 100+
  episodes.
- **Cryptographic message signing.** FIPA specs it; we skip. The daemon
  is trusted; cross-daemon trust is a v3 concern.

---

## 11. Why this is the right shape (quick defense)

- It's *small*. One actors.ts runtime module, one archetype file per
  agent, one DSPy prompt for Shipwright. If you don't like a behavior,
  you edit one file.
- It's *consistent with what we have.* Every primitive already exists.
  This just names the pattern.
- It's *observable.* Every message is a row. Every state transition is
  a note. The cockpit is a projection.
- It's *cost-honest.* Actors cost nothing when idle. The "always on"
  promise is about addressability, not burn rate.
- It's *testable.* Pure receive functions, mockable ctx, no global
  state. Vitest can drive 100% of archetype logic.

---

*End of SHIPWRIGHT-DAEMON.md. Companion: `SHIP-GRAMMAR.md` (the look),
`SHIPWRIGHT-DESIGN.md` (the product), `FLEETCONTROL-HARDENING.md` (the
enforcement), `COMPONENT-BRIEF.md` (the UI).*
