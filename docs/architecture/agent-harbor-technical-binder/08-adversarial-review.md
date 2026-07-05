# 08 Adversarial Review

This chapter records the review lenses applied to the binder. It should be
re-run with actual Port Daddy-created reviewer Agent Nodes once milestone 2
exists. For this draft, the findings are incorporated directly into the chapter
set.

## Review lenses

Game-theoretic incentives:
  Are claims and cooperation incentive-compatible, or just polite advice?

Agentic skill discovery:
  Are skill proposals validated independently, or is the system poisoning its
  own library?

Semantic conflict prediction:
  Does the plan distinguish textual merge safety from semantic safety?

Cooperative vibe coding:
  Does the plan support human-agent flow without merge chaos or tool spiral?

Background agents:
  Are Longshoremen useful and quiet, or always-on noise?

GPUI Harbor design:
  Does the native app have the right load-bearing order?

Context partitioning:
  Does the plan explain how to split work and survive context windows?

Episodic memory:
  Are transcripts and memories source-linked and retrievable?

Always-on safety:
  Are privacy, scope, cost, and psychological risks addressed?

## Red-team findings

### R1. "Compliant" can become a branding badge

Risk:
  The product may display compliance while only checking registration. That
  would repeat the current failure: agents exist, but transcripts and controls
  are missing.

Change made:
  Compliance is a ladder C0-C6. Transcript, tool gate, suggestibility, control,
  cooperation, and resumability are separate checks.

Required test:
  A fake agent that registers but cannot stream must show C0, not "healthy."

### R2. Transcript capture may overpromise reasoning visibility

Risk:
  The binder asks for reasoning steps, but many providers do not expose hidden
  reasoning. Claiming to capture hidden reasoning is dishonest even though
  visible agent transcripts should be saved locally by default.

Change made:
  Transcript model distinguishes visible messages, tool traces, summaries, and
  provider-exposed reasoning from hidden chain-of-thought.

Required test:
  UI label says "visible reasoning summary" or "not exposed" where appropriate.

### R3. Cloud account story was previously underdefined

Risk:
  Asking "where do provider keys go?" without a concrete account model makes
  hosted agents impossible to trust.

Change made:
  Account chapter defines local-only, hybrid relay, hosted remote, team harbor,
  optional encrypted vault, BYOK billing path, and data deletion.

Required test:
  Launch flow shows who pays and whether keys leave the machine.

### R4. MCP and scripts can bypass the whole harness

Risk:
  Users bring arbitrary MCP servers or scripts that can run tools outside the
  guard.

Change made:
  MCP gateway and script manifests are required for official compliance.
  Unmanifested tools remain observed or unmanaged.

Required test:
  A high-risk MCP call generates pre-tool approval or denial.

### R5. Longshoremen could become expensive, annoying ghosts

Risk:
  Always-on agents can spam suggestions, burn budget, and pollute memory.

Change made:
  Longshoremen default to reactive/passive-proactive behavior with explicit
  cost caps, event triggers, and quiet background duties.

Required test:
  No more than a configured number of visible suggestions, with stale
  suggestions expiring.

### R6. Context compaction can hallucinate continuity

Risk:
  A compaction packet may omit important constraints or invent facts, causing a
  successor to act on false memory.

Change made:
  Compaction packets require citations to transcript events, active files,
  commands, diffs, blockers, and next action.

Required test:
  Resume packet validator fails if major claims lack citations.

### R7. Public harbors invite governance and abuse problems

Risk:
  Public skills, agents, and shared harbors can carry malicious instructions,
  abuse compute, or leak private state.

Change made:
  Public harbors are milestone 10, behind identity, capability cards,
  moderation, revocation, rate limits, and data boundaries.

Required test:
  Public skill cannot be installed into a repo without provenance and scope.

### R8. The native app could become another command-line wrapper

Risk:
  If the app asks users to type IDs or commands, it fails the operator goal.

Change made:
  Product chapter requires clickable roster/detail panes, chat-quality
  transcript rendering, file previews, controls, and remediation buttons.

Required test:
  Operator can select an agent, open files, interrupt, and inspect transcript
  without typing an ID.

### R9. Harbor Editor could consume the whole roadmap too early

Risk:
  Building a full editor before transcript truth would delay the actual control
  plane.

Change made:
  Milestones put transcript, Agent Node registry, setup/doctor, control panel,
  tool gate, memory, and skill grafting before the Harbor Editor wedge.

Required test:
  P0 editor work only starts after Agent Node truth exists or is explicitly
  scoped as an independent spike.

### R10. Provider adapters may hide authority boundaries

Risk:
  Squid-like bridges can make users believe they are officially using one
  provider when they are really using a compatibility layer.

Change made:
  Provider mapping names bridge/proxy modes explicitly. Claude Code native auth
  remains Claude Code auth; compatibility layers are labeled.

Required test:
  UI shows body, provider, model tier, and authority separately.

### R11. Compliance can be forged by the adapter

Risk:
  A broken or malicious body can claim it supports heartbeats, streams, or tool
  gates without daemon-witnessed proof.

Change made:
  Compliance now requires daemon-issued ids, signed Articles, adapter nonce
  challenge, expiring capability leases, config drift detection, and negative
  probes.

Required test:
  An adapter that reports "denied" after secretly running a blocked command
  fails the compliance probe.

### R12. Surface truth can drift

Risk:
  Agents may build a terminal cockpit, FleetBar panel, website page, or GPUI app
  while calling all of them "the console."

Change made:
  Product chapter includes a current surface truth table and capability matrix.

Required test:
  UI tasks name the surface and capability they are changing.

### R13. Receipts are missing from the trust loop

Risk:
  Transcripts remain useful only inside the app and cannot become
  buyer-visible evidence.

Change made:
  Work Receipt is now a canonical term, data model table, endpoint, and product
  test.

Required test:
  Completed Agent Node emits a browser-verifiable receipt with transcript and
  diff hash.

### R14. Retention can break memory citations

Risk:
  Deleting raw transcript payloads after distillation can leave derived memory
  looking fully sourced when it is not.

Change made:
  Derived memories now need a distilled source contract and visible degraded or
  deleted-source state.

Required test:
  A memory whose source payload was deleted renders as degraded and cannot be
  used as a fully cited fact.

## Whitehat synthesis

The architecture is coherent if the first implementation target is narrow:

1. Make Agent Node truth real.
2. Make transcript absence visible.
3. Make compliance probed, not claimed.
4. Make the native app a clickable operator surface.
5. Add tool gates and suggestibility after streams are trustworthy.
6. Add context and memory once transcripts are source-linked.
7. Add cooperative claims and Harbor Editor after the basic control plane works.

The Shipwright soul/body model is compatible with the Articles state machine:
the soul signs and carries obligations, while bodies are replaceable runtimes.
This is the bridge from "Claude Code powered by other backends" to "Port Daddy
controls agents across backends."

The Harbor Editor battle plan is compatible with the compliance framework:
it is the future collaborative buffer for compliant Agent Nodes, not the first
place to solve transcript ingestion.

The always-on agent model is compatible if Longshoremen remain bounded:
reactive by default, passive-proactive for preparation, active-proactive only
for high-confidence, low-risk, policy-approved cases.

## Open concerns

- Exact transcript ingestion paths for Claude Code and Codex need fresh
  implementation research against current local versions.
- Hosted account encryption design needs a separate security ADR before cloud
  vault ships.
- Public harbor governance probably needs abuse and moderation design, not only
  architecture.
- Context token accounting will be approximate for some providers.
- Custom agent protocol needs fixtures in multiple languages.
- VS Code plugin design needs a concrete extension spike before commitment.
- Mobile remote control needs passkey/device-pairing threat modeling.

## Review gate for future edits

Any future architecture update should answer:

- Does this improve Agent Node truth?
- Does this make transcript, control, or remediation more visible?
- Does it preserve local-first privacy?
- Does it make cooperation cheaper than defection?
- Does it avoid injecting uncited memory as fact?
- Does it keep the native app clickable and legible?
- Does it route new launch sources through Work Intent, Work Plan, and anode
  adapters?
- Does it have a testable milestone gate?

If not, it may be a good idea, but it is not yet part of the Port Daddy agent
harbor spine.
