# 28 Agent Coordination And Onboarding

Companion of [04 Context Memory And Skills](./04-context-memory-and-skills.md) and
chapter 27 (Context, Memory And Runtime Wiring — in flight, PR #3539).
Visuals: `docs/architecture/intent-first-onboarding-flow.html` (the push-first
happy path) and `docs/architecture/harness-runtime-map.html` (what the harness
runs, and where).

This chapter rewrites how an agent joins a repo. Onboarding today is "here is the
global state — `pd sitrep`, `pd briefing`, `pd salvage`, `pd attention` — figure
it out yourself." The agent's declared `purpose` is inert. This chapter makes
intent load-bearing: the agent says what it is there for, and Port Daddy pushes
back exactly what matters to that intent, then keeps feeding it.

## 28.1 The inversion: pull becomes push

`pd attention` / `pd briefing` / `pd sitrep` exist only because the old model was
pull — the agent had to remember to query, then interpret an untailored dump.
Harnessing inverts this. Once the harness pushes an Arrival Brief at `begin`, an
ambient suggestion envelope every turn, and a live PR feed into the inbox, **the
agent stops running a pull loop** — it declares intent and works.

The three pull commands are not deleted; they are demoted to three residual
roles:

- **Pull-to-expand.** Push is budgeted (see 28.6): it delivers a headline plus a
  pointer. `attention` / `briefing` become the *expansion* of a pushed preview —
  page the pointer for the full list.
- **Operator surfaces.** `sitrep` / `briefing` were never only for agents; the
  human operator surveys with them. Harnessing the agent does not harness the
  human.
- **Escape hatch.** When an agent distrusts the filter ("show me everything, not
  your top three"), pull is the unfiltered fallback — and for un-harnessed (C0)
  bodies it is the only channel.

Net: the harnessed agent's loop is **`begin` → work**.

## 28.2 The palette (build only on verified primitives)

Real and fully wired (CLI + MCP + daemon): tuple space (`lib/tuples.ts`, Linda
`out/rd/in/scan`), pheromones with decay (`lib/pheromone.ts`), inbox DMs
(`lib/agent-inbox.ts`), pub/sub + SSE channels (`lib/channel-registry.ts`,
`lib/messaging.ts`, `routes/messaging.ts`), distributed locks (`lib/locks.ts`),
**parley — manual convene** (`lib/parley.ts`, a full state machine), episodic
memory (`lib/episodic-memory.ts`), the blob store (`lib/blob.ts`), the
deterministic advisor (`lib/advisor.ts`), the suggestion broker
(`lib/suggestion-broker.ts`), the prompt-injection tentacle (`bin/pd-hook-prompt`
into `matrix.env`), and the active roster (`lib/active-agent-roster.ts`, which
already emits per-agent `steeringChannel`s).

Do **not** design on these — verified aspirational: Contract-Net
(`lib/parley-trigger.ts` marks it unbuilt), ICP / FIPA interaction protocols
(skills only, zero runtime), the `lib/agent-harbor/blackboard.ts` module
(orphaned M6 read-projection — the real board is the pheromone and tuple stores),
and parley's auto-convener (unbuilt; convene explicitly).

## 28.3 The new happy path

1. **Arrive — *(proposed; not yet wired).*** Today the SessionStart hook
   (`hooks/sessionstart-pilot.mjs`) injects steering text and `.claude/settings.json`
   runs `pd attention --json`. Under this design the hook instead stops injecting a
   static persona; it reads `buildActiveAgentRoster()`, auto-subscribes the newcomer
   to live peers' `steeringChannel`s plus `repo:<slug>:prs` and
   `repo:<slug>:activity`, and injects a live "who is here, what is hot" note.
2. **Declare intent — `pd begin "<what I'm here to do>"`.** `purpose` becomes
   load-bearing: the Intent Matcher (28.4) embeds it and returns an **Arrival
   Brief** — top-N salvage sessions to soak up (more than one, ranked by intent,
   not count), semantically matched roadmap items (no slug needed to pay rent),
   the hot files and symbols, overlapping peers already subscribed, and a
   pre-drafted parley invite where intent meets a contested claim.
3. **Work.** Every turn, `pd-hook-prompt` injects a capped, TTL'd, semantically
   deduped Suggestibility Envelope: new pheromones near your files, a peer just
   claimed a file you were about to touch, a PR opened or closed, a parley
   summons. `pd-hook-post-tool` keeps spraying your pheromones so peers see you.
4. **Live PR broadcast.** A daemon subscriber bridges `github:webhook:pull_request`
   (already published — `routes/github-webhook.ts`) into every active repo
   agent's inbox and `matrix.env`, so PR lifecycle reaches running agents
   in-context, not just the app.

## 28.4 Component design (real insertion points)

- **Intent Matcher (the keystone, new).** A daemon service that embeds `purpose`
  and ranks candidates by cosine — **semantic only; keyword/substring
  classification is banned.** Reuse the shared embedder (`lib/semantic-resolver.ts`,
  `all-MiniLM-L6-v2`, `cosineSimilarity`; `pd embed` is the one local surface).
  Candidates: dead-agent purposes (`lib/resurrection.ts`), roadmap item
  titles+bodies, recent pheromone subjects + claimed files, episodic memory.
  Called from `begin_session` (`lib/sugar.ts`), also its own `intent_match` MCP
  tool for mid-session re-query.
- **Arrival Brief assembler.** A new `AdviceCategory` on `lib/advisor.ts` (it
  already returns `{title, why, actions[]}`) composing salvage + roadmap + files +
  peers + parley.
- **Delivery.** Durable nudges via `lib/suggestion-broker.ts` (`inbox.send`,
  surfaced by `pd attention`); in-context nudges via the `matrix.env` envelope
  `bin/pd-hook-prompt` already injects. One path, two surfaces.
- **Auto-subscribe.** At `begin`, enroll the session into peers'
  `steeringChannel`s + the repo channels via `channel-registry` / `messaging`.
- **PR bridge.** A small daemon subscriber on `github:webhook:pull_request*`.
- **Parley auto-invite.** Pre-stage a `parley.call` the agent confirms; do not
  depend on the unbuilt auto-convener.

## 28.5 Harnessed-reality logging

Today the harness injects context (the SessionStart persona, the `matrix.env`
envelope, `PD_FLEET`) but records none of it — the agent's real context is
invisible. Add a `context_injection` event to the event-sourced transcript store
(`lib/transcript-store.ts`) carrying: `source` (which surface injected it),
`payload` (large payloads spilled to the blob store and referenced by id),
`matchedIntent` (what it was matched against, and the cosine/why),
`dedupeClusterId`, `ttl`, `visibilityClass`, and `acted` — did the agent take the
suggested action, backfilled by correlating later turns. Payoff: a replayable
timeline of an agent's harnessed reality, and a precision metric
(accepted / injected) to retire noisy sources.

## 28.6 Input buffering & paging (harness invariant, = ch.27 W8)

The hard constraint: the coordination layer must never explode the very context
window it exists to protect — not with tool outputs, and not with its own
suggestions. Build on the blob store (`lib/blob.ts`): any oversized payload — a
big tool output or a large Arrival Brief / PR feed / envelope — is spilled to a
blob and the agent receives a preview plus a scoped (macaroon-caveated) pointer,
never the full text. Agent-facing MCP tools page on demand — `read_buffer(id,
offset, limit)`, `grep_buffer`, `summarize_buffer` (a Haiku / Cloudflare-AI
digest with a drill pointer). The elegant coupling with 28.5: the agent gets the
truncated view; the full payload lives in the blob and is referenced by the
`context_injection` log — truncation is lossless at rest. Buffering (for the
agent) and logging (for us) are two reads of one stored object.

## 28.7 MCP navigation surface

`pd_discover` is a category catalog gate, not a primitive. The tools an agent
needs (★ = new build):

- **Orient:** `intent_match(purpose)` ★, `arrival_brief()` ★, `whoami()`
  (enriched), `coordination_map()` ★ (who is where, what is hot, contested files).
- **Be suggested to:** `advise()`, `attention(--why)`.
- **Coordinate (exist):** `call_parley/respond/resolve`, `tuple_*`,
  `spray_pheromone/read_pheromones`, `inbox_*`, `publish/subscribe`, `lock/unlock`,
  plus `subscribe_repo()` ★.
- **Manage own context:** `read_buffer` ★, `page_buffer` ★, `grep_buffer` ★,
  `summarize_buffer` ★, `request_compaction` ★, `fetch_memory_packet` ★.
- **Introspect the harness:** `my_injections()` ★ — what the harness fed me, and
  did it help.

Keep the default set tiny (the current essential tools + `pd_discover`); reveal
the rest by category so an agent under context pressure does not carry dozens of
unused tool schemas.

## 28.8 Guardrails (do not rebuild the Fleet's spam)

The Fleet's ~25-redundant-comments failure is the cautionary tale: many sources ×
many suggestions with no dedup is noise. Apply the same discipline to every
suggestion bundle: **semantic dedup** (embedder cosine) before it posts, a
**cap** of <=3 visible items (overflow to `pd attention` on demand, log the
drops), a **TTL** (<=5 min, invalidate on file-change), **flow-state** deferral
during rapid tool bursts, and **permission tiers** — suggestions are
silent/notify, the only auto-action is (reversible) channel subscription; parley,
salvage, and claim stay one-confirm.

## 28.9 Verification

- Seed 3 dead agents with distinct purposes + 5 roadmap items; `pd begin "fix the
  merge queue dedup"` -> the Arrival Brief ranks the matching salvage/roadmap/files
  at top by cosine (not recency), with no keyword path.
- Two live sessions claim overlapping files -> a pre-drafted parley invite appears
  in the newcomer's brief and confirms into a real `parley.call`.
- Open a PR -> every active repo agent gets a deduped, TTL'd `PD_ALERT` in the next
  prompt envelope + an inbox item.
- The envelope never exceeds the cap; drops are logged; a large brief is spilled
  and summarized, with the full payload retained in the `context_injection` log.
- Cross-runtime: identical behavior for Codex / Gemini / agy (shared `pd-hook-*`).

## 28.10 Non-goals

No Contract-Net or ICP (aspirational). No wiring the orphaned blackboard module.
No parley auto-convener. No keyword/substring intent classification — embedder
cosine only.
