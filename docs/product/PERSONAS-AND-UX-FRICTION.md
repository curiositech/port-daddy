# Port Daddy Personas and UX Friction

**Status:** analysis document, not a roadmap authority. It records an inventory and a set
of findings; it does not commit anyone to fixing what it finds.

**Origin:** requested by erichowens on [PR #10195](https://github.com/curiositech/port-daddy/pull/10195),
which fixes a Book-generator bug (a numbered `Reader's Map` section leaking into the bound
Book). In review, the author asked why the Book still carries six per-chapter reader maps
instead of one preface, and asked for the "Port Daddy users or personae list" to be made
complete enough to support a real product-appeal and UX-friction pass. [PR #10222](https://github.com/curiositech/port-daddy/pull/10222)
answers the first question — it replaces the six per-chapter maps and seven abstracts with
one front-matter figure tracing five *reading* archetypes across the Book: the Practitioner,
the Systems Engineer, the Security Reviewer, the Mechanism Designer, and the Institutional
Theorist. A reply on #10195 pointed out that those five are reading archetypes for the Book,
derived from what each chapter assumes of its reader — not a product-wide Port Daddy
persona list — and that no such list existed anywhere in the repository. The author
confirmed: build it, then check the five against it. This document is that work.

This document does not touch #10195, #10222, or any chapter `.tex` file. It is a
standalone artifact.

## Method

The personas below are not brainstormed. Each one is backed by something concrete in the
repository — a CLI command, a permission tier, an ADR, a documented workflow, or a chapter
of the Book's own architecture. The sources read to build this:

- `README.md` in full (installation, the CLI verb surface, permission tiers, multi-agent
  coordination, spawning/delegation, the Fleet Engine, bonds/budgets, security/host safety,
  daemon operations, the three operator surfaces, the MCP server, the HTTP API, the
  documentation map, and the roadmap).
- `docs/VISION-AND-PERSPECTIVES.md` — the "building department" model, the trust spectrum
  from solo dev to marketplace agents, and the six-layer stack (primitives, infrastructure,
  building department, intelligence services, orchestrators, marketplace).
- `docs/UX_FRICTION_ANALYSIS.md` and `docs/SECURITY_SOUNDNESS.md` — existing, narrower
  analyses (website navigation; cryptographic soundness) that this document does not
  duplicate but does draw on and cross-check against current reality.
- `whitepaper/single-writer-kernel.tex` and `whitepaper/figures/fig-swk-stack-map.tex` —
  the Book's own four-layer coordination-stack model, which names an explicit "whom" for
  each layer (substrate: the machine; coordination: the agents; legibility: the operator;
  economy: the market between operators) — see below.
- `website-v2/public/whitepaper/figures/fig-book-reader-map.tex` <!-- cite-exempt: on claude/one-reader-map (PR #10222), not yet merged to main -->
  — the actual TikZ source of the proposed five-archetype figure,
  including its per-archetype gloss comments (e.g. "The Practitioner (buyer, solo developer,
  founder, newcomer)").
- Scattered persona artifacts already in the repo that are *not* a canonical product
  inventory but are relevant evidence, discussed in "What this excludes" below:
  `website-v2/src/data/docs-personae.ts` (a stub — the personas page never shipped),
  `demos/porthole/PERSONAS.md` (personas for one feature, Porthole, not the whole product),
  `docs/design/fleetbar-mockups/persona-synthesis.html` (synthetic personas for one UI
  design pass), and `skills/port-daddy-users/references/personas.md` (24 synthetic
  personas for messaging/landing-page testing).

Confirmed: as of this writing, no file in `docs/` (or anywhere else in the tracked tree)
is a canonical Port Daddy product-persona inventory. The reply on #10195 that said so was
correct.

## The Book's own actor model

Before inventing personas, it's worth noting that the Book already names one framework for
"who is this software for," and it is worth checking product personas against it. Chapter 1
(*The Single-Writer Kernel*) opens by modeling agent coordination as a four-layer stack,
"each layer serving a different *whom*" (`whitepaper/single-writer-kernel.tex:266`):

| Layer | Whom | Chapter |
|---|---|---|
| Substrate (the machine) | — | this chapter |
| Coordination (the agents) | the agents | this chapter (implemented half) |
| Legibility | **the operator** | *The Legible Swarm* |
| Economy | the market between operators | *The Harbor Economy* |

This is a genuine, load-bearing distinction inside the product's own architecture, not
just the Book's structure: "operator" is a first-class actor the daemon is built to serve
(FleetBar, Control Center, and pd-console are literally named "Operator Surfaces" in the
README), distinct from "the agents" the coordination layer serves. That distinction is one
of the throughlines of the persona list below.

## Persona inventory

Each persona here was checked against the task's candidate list of seven, plus anything
else the repo gave direct evidence for. All seven candidates hold up; none were dropped.
No additional persona cleared the bar of "backed by a real product mechanism, not just a
marketing document" — see "What this excludes" for the ones that didn't make it and why.

### 1. The Solo/Small-Team Developer

**Who:** one person, or a small trusted team, running two or more AI coding agents (or
plain dev servers) against the same project locally, who wants port collisions and
file-edit collisions to disappear without having to think about them.

**Job:** `PORT=$(pd claim myapp -q) npm run dev -- --port $PORT`; `pd scan && pd up`;
`pd begin` / `pd note` / `pd done` around each unit of work.

**Evidence:** the README's own framing — "One install, zero config" — and the "Dev mode"
row of the trust spectrum in `docs/VISION-AND-PERSPECTIVES.md` §2: "the daemon just
decides... no auction, no pricing, no bonds... This is the strong leader model... Agents
obey because they were spawned by the same principal." The default Fleet orchestrator is
explicitly "deliberately simple... It works for solo devs and small trusted fleets."
Coast Guard confinement (ADR-0050) is on by default for exactly this persona's protection
(leaked secrets, runaway spend) without requiring them to configure anything.

### 2. The Fleet Automation Builder

**Who:** someone who wants background agents running continuously against a project — on
a schedule, or reacting to events — without a terminal open. Distinct from persona 1
because the artifact they produce (`pd-fleet.yml`) is a standing declaration, not a
one-off session.

**Job:** author `pd-fleet.yml` (agents, triggers, schedules, channels, budget limits);
`pd fleet init` / `up` / `validate` / `status`; rely on the daemon's boot-time
auto-discovery of known fleets.

**Evidence:** the Fleet Engine section of the README (`pd-fleet.yml` example, ADR-0019,
ADR-0026), the Conductor cost gates (ADR-0060) with their own environment variables
(`PD_FLEET_GLOBAL_CEILING_USD`, `PD_FLEET_LINEAGE_CEILING_USD`, `PD_FLEET_DEFAULT_BOND_USD`,
`PD_FLEET_MAX_DEPTH`), and the fact that Port Daddy "dogfoods its own fleet" (`pd-fleet.yml`
in the repo root, `docs/fleet/`).

### 3. The Operator

**Who:** the person watching a running fleet of agents — locally or through Cloud Fleet —
who needs to know what is healthy, what is stuck, and what to do about it. This is the
"legibility" whom named in the Book's own stack (above), and it is a distinct job from
persona 1: persona 1 wants coordination to be invisible; the operator's job *is* making
the swarm visible and recoverable.

**Job:** `pd doctor`, `pd status`, `pd look` / `pd sitrep`, `pd salvage` / `pd takeover`
when an agent dies, `pd fleet halt|pause|resume`, `pd fleet panic` as a last resort;
opening FleetBar / Control Center / pd-console to see fleet graph, claims, sessions, and
cost.

**Evidence:** the README's "Three Operator Surfaces" section names FleetBar, Control
Center, and pd-console as "exactly three sanctioned operator surfaces." The Arbiter
("runtime invariant enforcement... man-overboard salvage"), the salvage/takeover/
resurrection commands, the Giant Squid `DEGRADED` state with a FleetBar "Repair" button,
and the Cloud Fleet run receipts at `/account/runs` are all built specifically for this
job. `demos/porthole/PERSONAS.md` independently describes the same job under "P2 — The
fleet operator" and "P5 — The incident responder," for the narrower evidence/replay slice
of the same problem.

### 4. The Integrator

**Who:** someone building on top of Port Daddy rather than inside it — a custom
orchestrator, a bot, a different editor's plugin, a CI step — via the MCP server, the CLI,
the SDK, or the raw HTTP API.

**Job:** call the 180 MCP tools or 136 HTTP paths (`docs/openapi.yaml`) directly; write an
orchestrator plugin against `lib/orchestrator-plugins.ts`; import the JS SDK
(`PortDaddy` client class, `lib/client.ts`).

**Evidence:** the "Users bring private orchestrators as plugins" model in
`docs/VISION-AND-PERSPECTIVES.md` §1 ("The plugin interface is defined in
`lib/orchestrator-plugins.ts`. Hot-swap is supported"), the README's MCP Server & Agent
Skill section, the HTTP API section, and the CI-enforced "Surface parity" gate
(`npm run parity`) that exists specifically because new CLI verbs must reach MCP/SDK/route
parity — a maintenance cost the project pays because this persona is real.

### 5. The Book Contributor

**Who:** someone writing or editing a chapter of the Book, a figure, or the generator
tooling that assembles the Book from its chapter sources. Distinct from the Book Reader
(persona 6): a contributor produces the apparatus a reader consumes, and has to follow
rules a reader never sees.

**Job:** write a chapter section under the honesty-ledger convention (`\Built`,
`\BuiltWeak`, `\Designed`, `\Vision`, `\NotGuar`, regimented-vs-enforced); run
`docs/harbor-research`'s `make figures` / `make docs`; sync the three companion skills
(`harbor-exposition`, `harbor-results`, `falsification-first`) before touching that tree;
run `scripts/generate-mega-whitepaper.mjs` and its test suite before proposing a change to
chapter apparatus.

**Evidence:** this is the persona whose mistake PR #10195 exists to catch — a chapter
author wrote a numbered `\section{Reader's Map}` instead of a starred one, twice, and both
times it was "caught by eye," not by tooling, until this PR. `docs/harbor-research/README.md`
documents a distinct onboarding ritual for this persona ("Start at `HANDOFF.md`... read
those SKILL.md files before doing anything"). The maturity-grade table in
`whitepaper/single-writer-kernel.tex` §"A research-maturity scale" is a taxonomy this
persona must apply correctly per claim, on pain of the Book overstating what the product
delivers.

### 6. The Book Reader

**Who:** someone reading the Book (or one of its standalone chapter papers) to understand
Port Daddy's coordination model, not to operate the tool. This is the persona the five
archetypes in PR #10222 are reading-postures *for* — see the Gap Check below.

**Job:** read the whole Book end to end (~roughly the length implied by 549 printed
pages before PR #10195's fix), or enter through the routing the front matter now provides,
or through one of the six per-chapter maps this is being consolidated away from.

**Evidence:** the per-chapter Reader's Map sections themselves (`\S\ref{sec:readersmap}`
in `whitepaper/single-writer-kernel.tex`, and five more chapters per PR #10222's table),
the front matter's promise ("here each chapter opens on the question it answers"), and the
README's own Documentation Map section, which links the two published whitepapers at
`/whitepaper` on portdaddy.dev: *The Anchor Protocol* and *The Bonded Commons*.

### 7. The Security/Compliance Reviewer

**Who:** someone deciding whether an organization should adopt Port Daddy — evaluating its
threat model, its license, and whether its security claims hold up, before development
teams are allowed to install it.

**Job:** read `docs/SECURITY_SOUNDNESS.md`, the README's Security & Host Safety section and
its threat-model caveats, `LICENSE` (FSL-1.1-MIT), and the compliance-ladder tooling
(`pd work probe`, C0–C6) if evaluating agent-launch conformance specifically.

**Evidence:** ADR-0050 (Coast Guard) and ADR-0087 (the separate-UID broker it does not yet
have) are written explicitly in threat-model terms ("Honest scope... this defends the
cooperative case... It does not defend a truly-malicious same-UID agent"). The compliance
ladder (`pd work probe`, "daemon-witnessed, never self-attested") and its five required
negative probes exist specifically so this persona's audit cannot be satisfied by
self-report. The FSL-1.1-MIT license itself ("Free for development and internal use") is a
mechanism aimed at this persona's job, not at persona 1's.

### Where the seven candidates landed

All seven candidate personas named in the request are represented above, one-to-one, with
one merge: "someone using the fleet-dispatch/multi-agent orchestration features directly"
split naturally into two distinct jobs once checked against evidence — building a standing
`pd-fleet.yml` fleet (persona 2) is a different job from watching a fleet that is already
running (persona 3, which absorbs "operator/SRE debugging a stuck session"). Nothing on the
original candidate list was dropped for lack of evidence.

## What this excludes, and why

Several existing repo artifacts use the word "persona" and are not folded into the
inventory above. Each is real and useful for its own purpose; none is a substitute for a
product-wide inventory, which is exactly the gap the #10195 thread identified.

- **`website-v2/src/data/docs-personae.ts`** — not evidence of a persona, but evidence of
  the gap itself: it is an explicit stub. Its own comment says the `/docs/personae` pages
  "haven't shipped yet... export empty lists to keep the build green." This confirms, from
  inside the codebase, that a docs-site personas feature was planned and abandoned before
  shipping.
- **`demos/porthole/PERSONAS.md`** — seven real, well-evidenced personas, but scoped to one
  feature (Porthole: privacy-safe evidence/replay for autonomous work), not to Port Daddy
  as a whole. Its P2 ("fleet operator"), P3 ("security and privacy reviewer"), and P5
  ("incident responder") corroborate personas 3 and 7 above; they are not a wider audience
  than that.
- **`docs/design/fleetbar-mockups/persona-synthesis.html`** — four synthetic personas
  (Maya "The Switcher," Jordan "The Buyer," Sam "The Power User," Casey "The Skeptic")
  built for one UI design exploration of FleetBar. Useful design-research artifact; not
  validated against the product surface the way this document's personas are, and scoped
  to one app's UI rather than the product.
- **`skills/port-daddy-users/references/personas.md`** — 24 named, explicitly *synthetic*
  personas for stress-testing messaging, landing pages, and pricing copy (the skill's own
  README says so: "synthetic, deliberately textured stand-ins for triage... not a
  substitute for real user research"). Several of its segments (hiring managers evaluating
  the repo as a portfolio piece, a friend of Erich's clicking a link) describe people who
  never use Port Daddy to do a job — they evaluate the *project*, not the *product*. That
  is a legitimate and different question from the one this document answers, and those
  segments are correctly out of scope here.

One candidate persona considered and not added: **the enterprise buyer/procurement
approver**, distinct from the Security/Compliance Reviewer. The evidence for it is real but
thin — the FSL-1.1-MIT license terms, the "governance accounting unit" framing of wallets
in the README ("don't pretend it's money"), and the fig-book-reader-map.tex source comment
glossing the Practitioner archetype as including "buyer." But nothing in the repository is
a product mechanism built specifically for a buyer's job — no pricing page, no procurement
questionnaire, no vendor security-review packet — the way `docs/SECURITY_SOUNDNESS.md` and
the ADRs are built for the Security Reviewer's job. Until such a mechanism exists, this
document treats "buyer" as a secondary concern folded into the Security/Compliance Reviewer
persona rather than as its own line.

## Gap check: the five reading archetypes against this inventory

The request was explicit: check whether the Book's five reading archetypes (Practitioner,
Systems Engineer, Security Reviewer, Mechanism Designer, Institutional Theorist) are a
faithful subset of the fuller persona list, or whether the Book's front matter implicitly
excludes personas the product actually serves.

**Answer: partial subset, in both directions, and the two directions matter differently.**

| Book archetype | Nearest product persona(s) | Verdict |
|---|---|---|
| The Practitioner | Persona 1 (Solo/Small-Team Developer), partly Persona 7 (buyer angle) | Faithful — the figure's own source comment glosses it as "buyer, solo developer, founder, newcomer," which lines up with persona 1 directly |
| The Systems Engineer | Persona 4 (Integrator), partly Persona 5 (Book Contributor verifying the mechanism) | Mostly faithful — the archetype reads closely for the kernel proof and the transfer/settlement mechanism, which is exactly what an integrator or a mechanism-checking contributor needs |
| The Security Reviewer | Persona 7 (Security/Compliance Reviewer) | Faithful, one-to-one |
| The Mechanism Designer | *No current product persona* | Reads a layer the product itself marks as not yet built |
| The Institutional Theorist | *No current product persona* | Reads a layer that is argument, not mechanism |

The last two rows are the finding worth stating plainly. The Mechanism Designer archetype's
close-reading lane is Part IV, "Trade Between Strangers" — the Harbor Economy chapter, whose
market (Vickrey auctions for merge slots, quality bonds, broadcast credits) is Layer 6 in
`docs/VISION-AND-PERSPECTIVES.md`'s own stack, and that document says plainly: "Layer 6
(marketplace) is future work." Nobody uses Port Daddy today to participate in that market,
because it does not exist as a running system yet — the whitepaper models it, and the
product has not built it. The Institutional Theorist archetype's lane runs through Part III
("What Survives the Restart" — agent identity, continuity, personhood, citing Locke and
Parfit), which is a philosophical argument about what an agent *is*, not a workflow anyone
executes with `pd`. Both archetypes describe a real, legitimate reading audience for an
ambitious systems book — but they are readers of where the argument goes and where the
product is heading, not personas of the shipped tool. That is not a defect in the five
archetypes; a Book chapter is allowed to have a theoretical audience the product does not
yet serve. It is worth stating because conflating "five reading archetypes" with "the Port
Daddy user list" — which is exactly what the #10195 thread pointed out was at risk of
happening — would understate by three-fifths how many people the archetypes actually cover
operationally.

Going the other direction — personas this document found that have no lane in the Book's
figure at all:

- **The Operator (persona 3)** has no dedicated lane. The Practitioner's note at Part II
  ("digest-with-zoom, consent") touches the Legible Swarm chapter, so the Practitioner path
  brushes against operator concerns, but a day-to-day operator running `pd doctor` or
  clicking FleetBar's Repair button during an incident has no reason to open the Book at
  all, and the Book does not claim they would. This is exactly the scope boundary the
  #10195 reply anticipated ("it should include people who never touch the Book at all —
  someone running Port Daddy day to day, an operator debugging a stuck session"). It is not
  a defect in the figure; it is a fact worth stating so nobody later "fixes" the figure by
  adding a sixth lane for a reader who was never going to open the book.
- **The Fleet Automation Builder (persona 2)** has no lane either, for the same reason — the
  job is executed entirely through `pd-fleet.yml` and the CLI, not through the Book.
- **The Book Contributor (persona 5)** is, by construction, not a reader archetype — they
  produce what the five archetypes consume. The figure's own caption independently makes
  this same kind of scoping call for a sixth candidate lane, the instructor: "a sixth reader,
  the instructor checking exercises, is deliberately not drawn as a sixth lane... every
  chapter's own closing Exercises section is that reader's route." The same reasoning
  applies to the Book Contributor and, separately, to the Operator and Fleet Automation
  Builder: not every real persona needs a lane in a reader's map, and the figure is right
  not to try to give everyone one.
- **The Integrator (persona 4)** partially maps onto the Systems Engineer lane, but a
  real-world integrator's actual reference material is `docs/openapi.yaml` and the SDK, not
  the Book — the Systems Engineer lane is closer to "someone verifying the kernel's proofs"
  than "someone calling the MCP server." The overlap is real but incomplete.

One more mismatch worth naming: the per-chapter Reader's Maps being consolidated away used
different, chapter-local categories than the five book-wide archetypes. The kernel chapter's
own map (`whitepaper/single-writer-kernel.tex` §"Reader's Map") has rows for "a protocol/agent
author" and "an instructor," neither of which survives as a named lane in the new figure
(protocol/agent author folds into the Systems Engineer; the instructor is explicitly and
correctly excluded, per the figure's own caption, quoted above). That is evidence the five
archetypes are already a compression of a slightly richer set of chapter-local categories,
not an expansion of them — consistent with PR #10222's framing of this as removing
repetition, not adding coverage.

## UX friction analysis

Each finding below cites something concrete in the repository — a command, a caveat
sentence already in the README or an ADR, or a specific admitted gap — not a generic
usability complaint. Where a finding is inference rather than a direct citation, it says so.

### 1. The Solo/Small-Team Developer

- **The "zero config" promise and the mandatory session ceremony are in tension.**
  `pd begin` requires an explicit `--lifecycle` and exactly one of `--roadmap`,
  `--roadmap-new`, or `--sidequest` before a session can start; the README documents this
  as intentional ("Every session must say where it sits on the roadmap — one line, at
  start, not at PR time"), but for someone who installed Port Daddy purely to stop two
  `npm run dev` processes from fighting over a port, this is real, required ceremony before
  any work begins, not the one-liner (`PORT=$(pd claim myapp -q) ...`) the README leads
  with.
- **The documentation surface has grown since the last audit, in the direction the audit
  already flagged as a problem.** `docs/UX_FRICTION_ANALYSIS.md` (dated March 16, 2026)
  found "16-tutorial series with no overview map" as a top-3 critical issue. The tutorial
  list in `website-v2/src/data/tutorials.ts` now has 21 entries. The specific complaint
  (no progress map, no search) was not evidenced as fixed by anything read for this
  document, and the surface it was complaining about has grown by roughly a third since.
- **The README a new user reads to get started is written in the same
  hedge-heavy register the Book uses for formal claims**, e.g. "This is a source contract,
  not proof that an installed daemon has been upgraded" and similar sentences appear
  repeatedly through the Sessions & Coordination Loop section — precise and necessary for
  persona 7, but noise for someone trying to run their first `pd begin`.
- **The permission-tier system means "silent" is not the default it sounds like.** Of the
  four tiers (`silent`, `notify`, `approval`, `destructive`), most of the commands a
  first session actually needs (`pd begin`, `pd claim`, `pd done`) are `notify` or higher,
  and the `destructive` list — over a dozen commands — is long enough that a developer
  exploring the CLI can plausibly reach one before knowing tiers exist.

### 2. The Fleet Automation Builder

- **Cron support is narrower than cron, and the DST behavior is a documented edge case a
  builder must already know to look for.** The README states Fleet accepts only
  `*/N * * * *`, `0 */N * * *`, `M * * * *`, and `M H * * *`, and that "At DST boundaries,
  local Date semantics advance spring-forward gaps and select the earlier fall-back
  occurrence; this is not a timezone-aware calendar walker." A builder scheduling a ship
  across a DST transition gets behavior that only makes sense after reading this specific
  paragraph.
- **Config mistakes fail silently rather than loudly.** "A present malformed `enabled`
  value also fails closed to disabled," and "Malformed, unsupported, or calendar-constrained
  expressions fail closed: Fleet arms neither a timer nor `run_on_start`." This is the right
  safety default, but for someone debugging "why didn't my ship run," the failure mode is
  silence, not an error at `pd fleet validate` time — and the README does not state that
  `validate` catches these specific cases before runtime.
- **Financial defaults apply even to builders who never asked for them.** `PD_FLEET_GLOBAL_CEILING_USD`
  defaults to `25` and `PD_FLEET_LINEAGE_CEILING_USD` to `5`; a builder who does not set
  these env vars is still bound by them, silently, unless they read the Bonds & Wallets
  section closely enough to notice the defaults exist.

### 3. The Operator

- **A documented recovery path ends in a state the docs already admit is unhandled.** The
  README states plainly, in the same section that documents `pd salvage --all`: "**Hold
  clearance is not implemented yet**; explicit session end, abandon, and takeover retain
  their existing contracts but do not clear saved queue holds." An operator following the
  documented workflow can reach a state the product's own documentation says it cannot yet
  resolve.
- **The primary "ambient consent/status/re-entry" surface is macOS-only, on an
  officially-supported Linux platform.** The Installation section lists "macOS (recommended)
  or Linux" as supported OSes, but FleetBar is described as "the SwiftUI macOS menu-bar
  app," and it owns the one-click "Repair" button for a `DEGRADED` Giant Squid hook state.
  Nothing read for this document describes a CLI-only equivalent to that Repair action for
  a Linux operator; `pd squid debug status` reads the same diagnostic state but the README
  does not name a repair verb for it. (This last point is an absence, not a documented
  gap — worth confirming with the maintainers rather than treated as settled.)
- **Ground truth requires tracking many separate "this is not proof of X" caveats at
  once.** Phrases like "not proof that an installed daemon has been upgraded," "not live
  capture, compliance or authorization proof," and "not another session's substitute" recur
  through the README's Sessions, Squid, and Memory sections. Each caveat is individually
  correct and necessary, but an operator trying to establish what is actually true during
  an incident has to hold all of them in mind simultaneously; there is no single "what can I
  trust right now" surface that already does this reconciliation for them.

### 4. The Integrator

- **The parity requirement that protects consistency internally does not exist for anyone
  outside the repository.** `npm run parity` enforces CLI/MCP/SDK/route/completions/docs
  consistency against `features.manifest.json` as a CI gate for contributors. An external
  integrator building against the 180 MCP tools or 136 HTTP paths has no equivalent tool
  and must manually reconcile the README, `docs/openapi.yaml`, and the MCP tool list by
  hand if they suspect drift.
- **Search/embedding features can silently downgrade to a degraded mode.** The README
  states the retrieval system is "hybrid — BM25 plus a dense profile," but "both registry
  rows remain visibly `degraded-fallback` and `declarative-only` until benchmark and signed
  promotion receipts exist," and by default "the daemon never phones huggingface.co and,
  without a cached model, semantic retrieval degrades to the lexical (BM25) path labeled
  `degraded`." An integrator relying on `pd roster search` or `pd embed` for semantic
  matching needs to know to check for this label, or will silently get worse results than
  they expect.
- **Cross-backend compatibility is reported as a conformance ladder, not a simple support
  matrix.** `pd backend adapters --matrix` and `pd work probe` report compliance levels
  (C0–C6) and adapter kinds rather than a yes/no "does backend X support feature Y" answer,
  and the README is explicit that "neither discovery nor an agent's self-report earns
  runtime conformance." This is the right rigor for persona 7, but it means an integrator
  who just wants "will this work with Gemini" has to interpret a conformance probe result
  rather than read a table.

### 5. The Book Contributor

- **The exact mistake this document's motivating PR fixes is itself the sharpest example
  of contributor friction.** A chapter author wrote `\section{Reader's Map}` (numbered)
  instead of `\section*{Reader's Map}` (starred) in two separate chapters, and both times
  the mistake reached the point of being caught only by someone looking at a rendered page
  — not by any authoring-time signal. PR #10195's own body: "Two hand-repairs of one
  defect, and still no check, is the actual defect." The fix is a CI test, which catches the
  mistake after the fact; nothing in the authoring environment (no LaTeX linter rule, no
  chapter template warning) prevents it before a PR is opened.
- **The onboarding ritual for one part of the Book tree is heavier than the rest of the
  repo's contributor path.** `docs/harbor-research/README.md` opens with "Start at
  `HANDOFF.md`... The three companion skills live in `skills/{harbor-exposition,
  harbor-results,falsification-first}` — read those SKILL.md files before doing anything,"
  followed by a `make figures` / `make docs` build step and a required `npm run
  skills:sync`. This is a materially different, heavier ritual than editing most other
  parts of the codebase, and a contributor moving between the two areas has to notice the
  switch.
- **The honesty-ledger taxonomy is easy to misapply even for someone deliberate about
  applying it correctly.** PR #10222's own adversarial-review section flags a related risk
  in the parallel apparatus work: "the test asserts zero, forever... A zero-tolerance
  invariant is easy to assert and easy to erode." The same shape of risk applies to grading
  claims `\Built` vs. `\BuiltWeak` vs. `\Designed` correctly — the taxonomy itself explains
  (§"A research-maturity scale") that the two "most consequential corrections in this paper"
  were exactly the places a single optimistic grade would have overstated the artifact.
  That correction had to be caught by a careful author; nothing in the tooling checks a
  grade against the artifact it claims.

### 6. The Book Reader

- **The bug motivating this whole document is itself the sharpest reader-facing friction.**
  On `main` today (before #10195 merges), Chapter 6's routing table prints as a numbered
  section, "6.1 Reader's map," inside the bound Book — taking a Contents entry and pushing
  the chapter's real opening section ("The thesis: a market, not a payment rail") down to
  §6.2, along with every cross-reference in the chapter. A reader of the printed Book today
  is reading a chapter whose section numbers do not match what the author intended.
- **Until #10222 merges, the six per-chapter maps that remain are inconsistent with each
  other.** The kernel chapter's own map has six rows ("short on time," "a systems
  engineer," "a security reviewer," "a protocol/agent author," "here for the economy," "an
  instructor"); other chapters' maps use different categories. A reader moving between
  chapters today gets a different taxonomy each time, not the one consistent structure
  #10222 proposes.
- **The proposed fix names its own remaining legibility risk, unresolved as of this
  writing.** The new figure's own adversarial-review section states: "three line weights
  and a dash pattern is a narrow channel for five categories, and the thin-dashed 'skim'
  stretches are the ones most likely to disappear at page scale. This is exactly what the
  missing render would settle" — and, per the same PR, that render had not been produced or
  committed as of PR #10222's last update.
- **The fix for one persona creates a real, acknowledged cost for a related one.** PR
  #10222 deletes the abstracts from all seven standalone chapter papers, which the Book's
  own front matter used to promise readers would keep ("standalone editions of the chapters
  keep their abstracts and reader maps"). PR #10222's own text calls this "the central
  decision in this PR and it is not obviously right" — someone reading one chapter's
  standalone paper in isolation, without the bound Book, now gets no abstract at all.

### 7. The Security/Compliance Reviewer

- **The product's own honest answer to the most likely threat-model question a reviewer
  will ask is "no, not yet."** ADR-0050's own scope statement: Coast Guard confinement
  "does **not** defend a truly-malicious same-UID agent (it can `unset HTTPS_PROXY` or read
  the daemon's memory); that needs the separate-UID broker (ADR-0087)" — and ADR-0087 does
  not exist as a running system yet. A reviewer's most natural threat model (a compromised
  or malicious agent, not just an accidentally-misbehaving one) is exactly the case the
  current defenses are candid about not covering.
- **The security-soundness document does not itself use the Book's grading discipline,**
  which makes it harder to tell, from that document alone, what is shipped versus planned.
  `docs/SECURITY_SOUNDNESS.md` mixes present-tense already-shipped claims ("we formally
  verify that the daemon's active harbor-card path enforces Phase 2 Ed25519") with
  future-tense roadmap language ("We are transitioning to a Formal Verification model," "In
  v4, every Harbor will optionally include The Arbiter") without the `\Built`/`\BuiltWeak`/
  `\Designed`/`\Vision` labels the Book itself considers necessary for exactly this kind of
  claim-mixing risk. A reviewer has to cross-reference the README and whitepaper separately
  to sort shipped from planned.
- **The compliance ladder this reviewer would lean on for agent-launch conformance is
  itself new.** The README describes `pd work probe` as "the first landing of the Work
  Intent command family," gated by ADR-0095, under which "launch-shaped `pd work` forms
  refuse until `pd work start` lands." A reviewer relying on this tooling for an actual
  audit today is evaluating a mechanism that is still being built out, not a finished
  instrument.

## Summary

The five Book-reading archetypes are a faithful description of who reads the Book for three
of five lanes (Practitioner, Systems Engineer, Security Reviewer); the other two (Mechanism
Designer, Institutional Theorist) describe real, legitimate readers of the argument the Book
is making, but not personas of the product as it exists today — they read a market layer
and a personhood argument the product itself marks as future work or philosophical
grounding, not shipped mechanism. That is a scope boundary, not a defect, and it should stay
stated rather than quietly smoothed over the next time someone reads "five reader
archetypes" as if it were the whole Port Daddy audience.

Going the other direction, at least three real personas — the day-to-day Operator, the
Fleet Automation Builder, and (by construction) the Book Contributor — have no reason to
open the Book at all in the course of doing their job, and the Book's own figure is right
not to invent a lane for them.

The friction findings above are concentrated in a recognizable pattern: Port Daddy's own
documentation is unusually honest about what is `\Built` versus `\BuiltWeak` versus
`\Designed`, in both the Book and the README, and that honesty is exactly what surfaces most
of the friction in this document — a reader or operator who takes the caveats seriously
keeps running into real, named gaps between what the architecture promises and what today's
runtime delivers. That is a better failure mode than a product that hides the gap, but it is
still friction, and it is friction a persona-blind reading of the README would miss.
