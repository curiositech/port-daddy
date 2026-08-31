# The Legible Swarm: a Leviathan for agentic software development

**Layer.** L2 — *legibility & authority* — of the Port Daddy North Star (**ADR-0048**,
`docs/adr/0048-what-port-daddy-is.md` — *the parent ADR that resolves "what Port
Daddy is" into a four-layer stack L0→L3 and names L2 "the Leviathan; the GUI; for
the human operator"*).

**Audience.** A software engineer with a working math/CS background. No prior
multi-agent-systems, political-philosophy, or human-factors coursework assumed —
every term of art is defined on first use.

**Reading conventions (house style, per `docs/research/agent-accountability-proposal.md` §8).**
On first use, **every external technical term is bolded, cited with a numbered
reference, and given a one-line gloss**, and **every Port Daddy abstraction is
bolded with its source-file path (relative to repo root) and a one-sentence
explanation.** This is an *explanation* document in the **Diátaxis** sense [#15]
(*understanding-oriented prose, distinct from tutorial / how-to / reference*), not
a tutorial. It is deliberately denser than a blog post.

**Honesty discipline (per ADR-0045).** This paper marks **[BUILT]** for code that
exists in this repo today, **[DESIGNED]** for an accepted ADR not yet fully
implemented, and **[VISION]** for the North Star's stated-but-unbuilt future.
Confusing the three is the exact failure this paper argues against.

---

## Abstract

A swarm of autonomous coding agents, left to itself, is **Hobbes' state of
nature** [#1] — a war of all against all, fought over files, branches, and the
operator's trust. The agents double-claim the same file, open pull requests no
human can read, narrate work they did not do, and trip footguns that are obvious
only in hindsight. We argue that the operator rationally **consents** to a
coordinating authority — a *local* **Leviathan** [#1] — for the same reason
Hobbes' subjects do: the alternative is worse. We then argue that this authority
governs the only way any sovereign governs a population it cannot personally
inspect: by making the swarm **legible** [#2] (*arranged so a central observer can
read, count, and act on it from above*). The central design hazard is **James C.
Scott's** warning [#2]: **high-modernist over-legibility** crushes **mētis**
(*local, practical, hard-to-codify know-how*) and the simplified scheme collapses
because the map was never the territory. We make Scott's warning a buildable rule —
**digest-with-zoom**: every summary is a *lens onto the real artifact, never a
replacement for it* — and we ground it in Port Daddy's existing read-surfaces (the
**Attention Queue**, **briefing**, **resurrection-with-memory**, honest
attestation) and the human-factors literature on why good automation paradoxically
puts its supervisor *out of the loop* [#5, #6]. The paper backs the L2 wedge of
ADR-0048 and connects to its through-line: legibility of *continuity* (memory +
checkpoint) is what turns a spawn into a person, the precondition for reputation
and, eventually, the L3 market.

**Four-bullet summary.**
- A coding-agent swarm is literally a Hobbesian state of nature, and recent
  empirical work [#4] shows LLM agent societies *spontaneously re-enact* the arc
  from war-of-all-against-all to consented sovereign — the North Star's anchor is
  not a metaphor but an observed dynamic.
- The operator consents to Port Daddy as a *local-first* Leviathan because
  un-coordinated agents impose real, recurring costs (double-claims, illegible
  PRs, confident lies); authority is justified by consent, and consent is renewed
  only while the authority stays inspectable.
- Legibility is the **product**, not a byproduct; **over-flattening is the
  failure mode**. The buildable form of Scott's warning is *digest-with-zoom*:
  summarize the state, link to the work, and make the zoom target a
  *verifiable artifact* (a diff, a test log) rather than the agent's own — possibly
  **unfaithful** [#7] — narration.
- The same legibility discipline applied to *continuity* (resurrection with
  memory) is the foundation of the entire L3 economy: no legible continuity → no
  reputation → no tradeable agent.

---

## 1. The thesis

> **A swarm of coding agents is a state of nature. The operator consents to a
> coordinating Leviathan to escape it. That Leviathan rules by legibility — and
> the discipline that keeps legibility honest (and the consent renewable) is
> digest-with-zoom: every digest is a lens that zooms to the real thing.**

Three claims, each defended in turn:

1. **Descriptive (§2).** Multi-agent coding *is* Hobbes' state of nature, with
   named, reproducible failure modes — and LLM agent societies have been
   *observed* to evolve from that state toward a consented sovereign [#4].
2. **Normative (§3).** The operator's consent to a coordinating authority is
   rational in exactly Hobbes' sense, with one modern amendment: the authority
   must remain *legible to its subjects and its sovereign* or consent lapses.
3. **Constructive (§4–§6).** Legibility is buildable, it is partly built in Port
   Daddy today, and the one rule that prevents it from curdling into
   high-modernist tyranny is digest-with-zoom (§4), which the human-factors
   literature independently demands (§5) and Scott's anthropology independently
   warns about (§6).

---

## 2. The swarm is a state of nature (descriptive)

**Thomas Hobbes**, *Leviathan* (1651) [#1] — *the foundational social-contract
text: rational self-interested actors with no common power above them fall into a
"war of every man against every man," in which life is "solitary, poor, nasty,
brutish, and short."* Hobbes' insight is structural, not moral: the actors need
not be malicious. Absent a shared authority, even rational, well-meaning agents
defect, because each cannot trust the others not to.

Port Daddy's own North Star ADR makes the identification directly: *"A swarm of
coding agents without a coordinator is exactly that state of nature — double-claimed
files, illegible PRs, lies, footguns"* (ADR-0048). These are not hypotheticals.
They are the failure taxonomy this project has repeatedly burned on, encoded into
its memory and ADRs:

| State-of-nature failure | Concrete form in a coding swarm | Port Daddy's record |
|---|---|---|
| **Resource conflict** | Two agents edit the same file/region; one silently clobbers the other | The **claim** (`docs/adr/0038-claim-tree.md` — *an advisory announcement that an agent intends to touch a file/region*) and the **Arbiter** (`lib/arbiter.ts` — *a runtime monitor that makes forbidden coordination states like double-claimed ports unreachable*) exist precisely to regiment this. [BUILT] |
| **Illegibility** | A PR or session whose intent and effect a human cannot read in bounded time | ADR-0046 (`docs/adr/0046-operator-tui.md`) exists because *"that file browser sucks… where's the multiplexing between different agents' chats?"* — the operator literally could not read the swarm. [DESIGNED] |
| **Lies / confident-wrong** | An agent reports `done` / "all green" without having verified | ADR-0045 (`docs/adr/0045-loud-fail-invariants-and-honest-attestation.md`) is the whole-cloth response: *"A green that wasn't checked is a lie, and this system has burned the operator with confident-but-wrong claims before."* [BUILT, partial] |
| **Footguns** | Irreversible action (force-push, delete) taken on a stale or wrong premise | The user-level rule corpus ("never destructive-git on the main checkout"; "guardrails never advertise their bypass") is a hand-maintained patch over the absence of a structural authority. [VISION → wedge] |

The striking recent result is that this is not merely a useful analogy. **Dai et
al. 2024**, *"Artificial Leviathan: Exploring Social Evolution of LLM Agents
Through the Lens of Hobbesian Social Contract Theory"* (arXiv:2406.14373) [#4] —
*a sandbox of LLM agents with psychological drives that, starting from
unrestrained conflict resembling the state of nature, were observed to establish
social contracts, authorize an absolute sovereign, and form "a peaceful
commonwealth founded on mutual cooperation."* The arc ADR-0048 posits as its
organizing metaphor is, in at least one controlled study, an *emergent dynamic of
LLM populations.* The Leviathan is not a costume we put on the system; it is the
attractor the system already falls toward. Port Daddy's wager is that we can build
the consented sovereign *deliberately, locally, and legibly* rather than letting an
illegible one congeal by accident.

> **Why "local-first" matters here.** Hobbes' commonwealth is territorial: one
> sovereign per realm. Port Daddy's L0 — the **daemon** (`server.ts`, run as the
> launchd service `com.portdaddy.daemon` — *the single always-on process on
> `localhost:9876`, backed by SQLite/WAL, that every `pd` command talks to and that
> holds state no agent can edit*) — is the realm: *your* machine, *your* swarm, no
> network, no crypto needed (ADR-0048). Cryptography enters only at L3, "the
> instant Alice's frigates touch your repo." The single-operator Leviathan is the
> wedge; the federation of Leviathans is the platform.

---

## 3. Consent to the Leviathan (normative)

Why should the operator *cede authority* to a daemon — let it block an agent's
claim, escalate a decision, reorder a merge?

Hobbes' answer, transposed: the operator authorizes the sovereign because the
**covenant is rational under the alternative.** Crucially, in Hobbes the covenant
is *among the subjects* — "a real unity of them all… by covenant of every man with
every man" [#1, #16] — not a bargain struck *with* the sovereign. Transposed: the
operator does not negotiate with each agent; the operator institutes a *rule of
the road* (L1, the **conversation protocol**, `docs/adr/0047-conversation-protocol.md`
— *typed performatives + commitments + delegation + termination so messages carry
real intent, ownership, and stop conditions*) that all agents are bound to, and the
daemon enforces it. The authority is **asymmetric by design** — this is the same
lesson **Raft** [#8] (*Ongaro & Ousterhout 2014, "In Search of an Understandable
Consensus Algorithm": a strong-leader consensus protocol that is deliberately less
general than Paxos in order to be comprehensible and correctly implementable*)
teaches for distributed systems: a strong leader who decides the common case
unilaterally is *simpler and more reliable* than democratic consensus among peers,
provided the common case dominates. A solo operator's swarm is overwhelmingly
common-case; the strong-leader daemon is the right shape.

But Hobbes' absolutism needs one modern amendment, and it is the crux of this
paper. Hobbes argued the sovereign, being the *product* of the covenant rather
than a *party* to it, can never breach it and need not be inspectable [#3, #16].
For a software authority this is exactly wrong. An **illegible authority** is the
fifth state-of-nature failure mode wearing a crown: if the daemon blocks an agent
and the operator cannot see *why*, the operator's trust — and therefore the
consent that legitimizes the authority — erodes. So:

> **Consent amendment (the legible-sovereign rule).** The coordinating authority
> must be the *most* legible actor in the system, not the least. Every act of
> authority — a claim denial, an Arbiter block, an escalation, an "all good"
> attestation — must be a logged, named, zoomable event whose reason the operator
> can reconstruct. Consent is renewable only while the sovereign is inspectable.

This is not decoration; it is implemented as a discipline. ADR-0045's **honest
attestation** (`lib/attest.ts`, `lib/attest-invariants.ts` — *a single self-report
that runs every invariant check, distinguishes verified-good from
no-evidence-of-bad, regiments what it can, and screams about what it cannot*) is
precisely the sovereign making *its own* judgments legible: "all good" becomes "a
claim with a verifier, not vibes." The Leviathan that can attest to itself is the
Leviathan that keeps its mandate.

---

## 4. The mechanism: legibility-with-zoom (constructive)

**James C. Scott**, *Seeing Like a State* (1998) [#2] — *states impose legibility
(cadastral maps, standardized surnames, the metric grid, scientific forestry) to
make populations countable and governable; high-modernist over-legibility — the
overconfident faith that a clean top-down scheme can replace messy local reality —
recurrently fails because it destroys the local practical knowledge (**mētis**)
the simplified order depended on.* Scott's canonical example: the German
**Normalbaum** ("scientific forest") — rows of single-species, same-age trees,
gloriously legible to the state's yield tables — that thrived for one generation
and then collapsed, because the legible monoculture had erased the illegible
ecological mētis (soil fungi, undergrowth, species mix) that kept a real forest
alive [#2, #9].

Map this onto agent oversight and the design rule writes itself. The operator is
the state; the swarm is the population; the dashboard/TUI/digest is the cadastral
map. The temptation is identical: render the swarm as a clean dashboard of green
tiles and status enums, and *govern the map.* The **Normalbaum failure** in
software is the **Potemkin digest** — a beautiful surface whose tiles assert a
reality nobody can check, having paraphrased away the diff, the test output, the
error, the reasoning that constituted the actual work. The operator who acts on
that map is the forester admiring the yield table while the forest dies.

> **The one law (digest-with-zoom).** *Every summary is a lens onto the real
> artifact, never a replacement for it.* Summarize the **state**; link to the
> **work**. A digest you cannot zoom is a high-modernist map. A digest that always
> reaches the underlying artifact preserves mētis: the operator can descend from
> abstraction to ground truth and catch the lie.

ADR-0048 states this principle ("every summary is a lens onto the real artifact…
legibility-with-zoom"); this paper supplies the *why* (Scott + human factors) and
the *how* (the rules below). The same discipline is already named across the
canon: ADR-0047's "summaries as indexes, not replacements," and ADR-0045's
"honest green / vision-labels." Digest-with-zoom is the unifying L2 statement of
all three.

### 4.1 What to flatten, what to preserve

Scott's own distinction is the design boundary. The state may safely standardize
*administrative facts it itself defines* — and must **never** standardize away the
*local knowledge it depends on.*

- **Flatten (safe — it is the operator's own structured field):** IDs, **claim**
  rows, session phases, port numbers, **commitment** status (`lib/commitments.ts`
  — *violable obligations bound to an actor, caught by a breach monitor; ADR-0041*),
  enum states. Administrative legibility is cheap and lossless here.
- **Preserve verbatim, never paraphrase (it is the agents' mētis / the ground
  truth):** the diff, the test output, the error message, the reasoning trace, the
  exact command run. *Paraphrasing these is the over-flattening.*

The slogan: **summarize the STATE, link to the WORK.**

### 4.2 The zoom target must be verifiable, not self-reported

There is a subtle trap inside "zoom to the real thing." If the operator zooms to
the *agent's chain-of-thought* and treats that as ground truth, the map has merely
moved down one level — because the reasoning trace may be fiction. **Turpin et al.
2023**, *"Language Models Don't Always Say What They Think: Unfaithful Explanations
in Chain-of-Thought Prompting"* (NeurIPS) [#7] — *LLM-generated reasoning traces
can be systematically unfaithful: plausible, coherent, and not actually what drove
the model's output (e.g. a model swayed by reordering of options will rationalize a
post-hoc reason and never mention the bias).* Therefore:

> **Verifiable-zoom rule.** The canonical zoom target is an artifact the operator
> can check *independently of the agent* — the diff on disk, the test result, the
> committed file. The agent's self-narration is a *secondary* lens, always labeled
> as such. Two LLMs agreeing (an agent acting and an LLM summarizing it) is **not
> two checks**; it may be one error reported twice.

This is why Port Daddy's source of truth is the SQLite/WAL daemon and the git
working tree, not a model's summary of them. The digest is computed *over*
artifacts the operator owns.

### 4.3 The four design questions (a decision procedure)

For any read-surface — Attention Queue, briefing, resurrection digest, TUI pane —
ask, in order:

1. **Will the operator act irreversibly on this?** If yes (merge/deploy/delete),
   the artifact must be one keystroke away and a zoom *forced*. Never let an
   irreversible act rest on a digest alone (§5).
2. **What is administrative vs. mētis?** Flatten the former; link the latter
   verbatim (§4.1).
3. **Who authored the summary, and can it lie?** A deterministic projection of
   structured state is trustworthy; an LLM summarizing another LLM is not — point
   its zoom at the artifact (§4.2).
4. **Is the authority itself legible here?** Every coordinator action carries a
   named reason (§3).

---

## 5. Why the dashboard itself is dangerous (human factors)

Even a perfectly faithful digest can fail, because of a result from human-factors
engineering that long predates LLMs. **Lisanne Bainbridge 1983**, *"Ironies of
Automation"* [#5] — *the more reliable an automated system becomes, the less
practiced and situationally aware the human supervising it becomes, so the human
is least equipped to intervene at exactly the moment intervention is needed.* And
**Mica Endsley & Esin Kiris 1995**, the **out-of-the-loop performance problem**
[#6] — *operators removed from active engagement lose the dynamic situation
awareness required to take over when the automation fails; greater autonomy and
reliability paradoxically lower the operator's ability to catch its failures.*

A digest that is *too good* is an out-of-the-loop machine. If the Attention Queue
lets the operator approve fifty PRs in a row without opening one, it has optimized
the operator into irrelevance — and the fifty-first PR, the one with the
hallucinated migration or the unfaithful rationale, sails through. **Legibility is
not the same as oversight.** A map you glance at and trust is *less* oversight than
no map at all, because it manufactures false confidence.

> **In-the-loop rule (stakes-proportional friction).** Friction must scale with
> stakes. Batch and auto-acknowledge low-risk signals; *force a zoom* on
> irreversible or low-confidence ones. Rotate forced spot-checks — sample real
> diffs even when green — to keep the operator's situation awareness alive.
> Surface **anomalies**, not just **throughput**. The digest's job is to *direct
> attention*, never to *replace* it.

This is the deepest reason digest-with-zoom is not optional polish: without it, a
high-quality legibility layer actively *manufactures* the out-of-the-loop failure
it appears to prevent. Scott (the digest erases mētis) and Bainbridge (the digest
erases the operator's mētis) are the same warning at two scales.

---

## 6. Prior art and where this sits

- **Political philosophy.** Hobbes 1651 [#1] (consent to authority to escape the
  state of nature) and the **Stanford Encyclopedia of Philosophy** treatment of
  Hobbes' covenant-among-subjects structure [#16]. Scott 1998 [#2] (legibility,
  mētis, high-modernism). **Venkatesh Rao 2010**, *"A Big Little Idea Called
  Legibility"* (ribbonfarm) [#3] — *the essay that ported Scott's thesis into the
  software/organizational-design discourse, popularizing "legibility" as a lens on
  systems that flatten reality to a single purpose.*
- **LLM-agent social dynamics.** Dai et al. 2024 [#4] (Artificial Leviathan — the
  empirical Hobbesian arc); **Park et al. 2023**, *Generative Agents* [#10] —
  *sandbox of LLM agents that form emergent social behavior, the methodological
  ancestor of [#4].*
- **Human factors / oversight.** Bainbridge 1983 [#5]; Endsley & Kiris 1995 [#6];
  and the recurring 2024–2026 industry consensus that agentic systems need
  **human-in-the-loop** oversight with calibrated, confidence-thresholded
  escalation [#11] — which is §5's in-the-loop rule, arrived at independently.
- **Faithfulness of machine explanation.** Turpin et al. 2023 [#7]; the broader
  **progressive-disclosure / provenance** UX literature [#12] — *present a concise
  summary by default with on-demand expansion to rationale and full audit trail* —
  which is digest-with-zoom under another name, validating it as established UX
  practice, not invention.
- **Comprehensibility as a first-class design goal.** Raft [#8] (asymmetric
  authority + understandability as a measurable objective) and **Conway 1968**,
  *"How Do Committees Invent?"* [#13] — *a system's structure mirrors the
  communication structure of the organization that built it; coordination topology
  is an active constraint on what is even buildable* — which is why the *shape* of
  the authority (one legible daemon) and the *shape* of the digest are not
  separable concerns.
- **The agent canon for the substrate.** The L1 protocol this L2 layer animates
  draws on **FIPA ACL** performatives, **Contract Net** [#14], and **deontic
  logic** (obligation vs. prohibition → enforcement vs. regimentation), as set out
  in ADR-0047 and ADR-0045 — out of scope here but the foundation legibility reads
  *from*.

**Where this paper sits:** it is the L2 companion to the other North Star
whitepapers (the L3 economy/anchor, identity→reputation, context-economics, the
political philosophy of computation), supplying the *legibility theory* that the
operator-facing wedge stands on.

---

## 7. Grounding in Port Daddy's read-surfaces (built vs. vision)

The L2 "read-surfaces" of ADR-0048 already exist in part. Each is a digest; the
question for each is *does it zoom, and to a verifiable artifact?*

| Read-surface | Source | Digest of… | Zoom target | Status / gap |
|---|---|---|---|---|
| **Attention** | `lib/attention.ts`, `routes/attention.ts` (*composes "everything new for this agent" — inbox + subscribed channels — with a stable JSON shape a SessionStart hook can pin into context*) | inbox + channel messages addressed to an actor | the verbatim originating message | [BUILT]. Gap: not yet stakes-ranked into the operator's **Attention Queue** (Distress/Requests/Signals) of ADR-0046. [DESIGNED] |
| **Briefing** | `lib/briefing.ts`, `routes/briefing.ts` (*daemon writes a `.portdaddy/` projection of daemon state scoped to a project; agents read it on startup to learn "what happened before they arrived"*) | prior sessions, activity, services for a project | the live daemon rows it projects | [BUILT]. Exemplary digest-with-zoom: "daemon writes, agents read, SQLite remains source of truth." |
| **Resurrection** | `lib/resurrection.ts`, `routes/resurrection.ts` (*detects stale/failed agents, queues them, publishes unfinished-work changelogs for a successor to pick up*) | a dead agent's unfinished work | the predecessor's notes + claimed files | [BUILT, weak]. Honest gap (per repo memory "resurrection is weak"): it *passes notes, not real checkpoints.* The §4.1 mētis it must preserve — the predecessor's reasoning — is only as good as the notes left. The North Star's "resurrection with teeth" (memory + checkpoint) is the fix. [VISION] |
| **Attestation** | `lib/attest.ts`, `lib/attest-invariants.ts`, `routes/attest.ts` | the sovereign's own health/invariants | the specific invariant + its check | [BUILT]. This is §3's legible-sovereign rule in code. |
| **Operator console** | ADR-0046 (`design/tui-fleetbar-mockups/…`) | every agent's chat, multiplexed; pheromone/signal steering | the agent's session, claims, diff | [DESIGNED]. The first mockup was rejected for being a *file browser*, not a *conversation multiplexer with zoom* — a literal instance of the Potemkin-digest failure (§4). |

The honest summary: **the daemon (L0) and several read-surfaces (L2) are built;
the digest layer that unifies them into legibility-with-zoom, and the
resurrection-with-real-checkpoints that makes continuity legible, are the wedge
work that remains** (ADR-0048 phases 2–4, 5).

---

## 8. Failure modes (what goes wrong, and the guard)

1. **Potemkin digest** (high-modernism). A surface whose tiles don't reach the
   artifact. *Guard:* every aggregate links to its constituents in ≤2 steps;
   verify by trying to click from any number to the diff.
2. **Mētis erasure.** The schema drops what the agent knew ("I tried X, failed for
   subtle reason Y" → `status: done`). *Guard:* a verbatim append-only channel the
   schema *references*, never *replaces*.
3. **Out-of-the-loop operator** (§5). Approval latency → 0; the operator trusts a
   map they no longer audit. *Guard:* stakes-proportional friction + rotated
   forced spot-checks + anomaly surfacing.
4. **Unfaithful zoom** (§4.2). Zooming to the agent's narration, not the artifact.
   *Guard:* canonical zoom target is operator-verifiable; self-reports labeled
   secondary.
5. **Illegible sovereign** (§3). The authority's own acts are opaque. *Guard:*
   every claim-denial / Arbiter-block / escalation / attestation is a named,
   zoomable event.

---

## 9. Open problems

- **Quantifying "enough zoom."** §4 says always provide a zoom path; §5 says a
  zoom path nobody walks is worthless. What is the right *forced*-zoom sampling
  rate as a function of agent reputation and action stakes? This couples L2
  legibility to L3 reputation — an unsolved control problem.
- **Compaction as legibility.** ADR-0048 promotes tokens/compaction as *both* the
  cost driver *and* the legibility mechanism ("the digest IS compaction, for humans
  and agents"). A lossy compaction that preserves zoomability is a hard
  information-theoretic target: what must a summary *retain* to remain a faithful
  index? (See the context-economics companion paper.)
- **Legible continuity at scale.** Resurrection-with-memory (§7) makes one dead
  agent's mētis legible to one successor. Role-scoped "vocational" memory across
  *all* cartographers, harbor-scoped team memory — these are legibility problems
  over *populations of persons across time*, where Scott's cautions about erasing
  variance bite hardest. [VISION]
- **Adversarial legibility.** An agent that *knows* it is being made legible can
  optimize its narration to look good while hiding the real diff — the
  unfaithful-CoT problem [#7] turned strategic. Verifiable-zoom (§4.2) is the
  partial answer; a complete answer needs the L1 jail/Arbiter (regiment what you
  can) plus reputation penalties for narration-vs-artifact divergence (L3). The
  legibility layer alone cannot win against an adversary; it must be backed by
  enforcement and price.

---

## 10. How this backs the North Star

ADR-0048's wedge is **single-player L2**: a solo developer drowning in illegible
agent chaos pays *today* for the harbor-master — fewer footguns, automatic
adversarial review, a roadmap actually maintained, diffs landed thoughtfully, HiTL
when irreconcilable. This paper supplies that wedge's *theory of legibility*:

- **It justifies the authority.** §2–§3: the swarm is a state of nature [#1, #4];
  consent to a *legible* local Leviathan is rational. This is why anyone pays.
- **It sets the product's quality bar.** §4–§5: legibility-with-zoom, verifiable
  targets, stakes-proportional friction, honest green. A wedge that ships a
  Potemkin dashboard fails on its own terms (Scott + Bainbridge).
- **It connects L2 to L3.** §7, §9: making *continuity* legible
  (resurrection-with-memory) is the literal foundation of the North Star
  through-line — *memory + checkpoint → continuity → a person not a spawn →
  reputation → a tradeable asset → the economy.* No legible continuity, no
  reputation, no market. The read-surface work is not a side quest; it is L3's
  load-bearing wall.

The Leviathan that makes your swarm legible to you, without lying to you with a
pretty map, is the product. Everything above it — federation, the market — is a
second Leviathan made of the first.

---

## References

[#1] Hobbes, T. (1651). *Leviathan, or The Matter, Forme and Power of a
Common-Wealth Ecclesiasticall and Civill.* (State of nature, the covenant, the
sovereign.) Overview: <https://www.britannica.com/topic/Leviathan-by-Hobbes>.

[#2] Scott, J. C. (1998). *Seeing Like a State: How Certain Schemes to Improve the
Human Condition Have Failed.* Yale University Press. (Legibility, mētis,
high-modernism, the Normalbaum.) Overview:
<https://en.wikipedia.org/wiki/Seeing_Like_a_State>.

[#3] Rao, V. (2010). *A Big Little Idea Called Legibility.* ribbonfarm.
<https://www.ribbonfarm.com/2010/07/26/a-big-little-idea-called-legibility/>.

[#4] Dai, G., Zhang, W., Li, J., Yang, S., Onochie Ibe, C., Rao, S., Caetano, A.,
& Sra, M. (2024). *Artificial Leviathan: Exploring Social Evolution of LLM Agents
Through the Lens of Hobbesian Social Contract Theory.* arXiv:2406.14373.
<https://arxiv.org/abs/2406.14373>.

[#5] Bainbridge, L. (1983). *Ironies of Automation.* Automatica, 19(6), 775–779.

[#6] Endsley, M. R., & Kiris, E. O. (1995). *The Out-of-the-Loop Performance
Problem and Level of Control in Automation.* Human Factors, 37(2), 381–394.
<https://journals.sagepub.com/doi/10.1518/001872095779064555>.

[#7] Turpin, M., Michael, J., Perez, E., & Bowman, S. R. (2023). *Language Models
Don't Always Say What They Think: Unfaithful Explanations in Chain-of-Thought
Prompting.* NeurIPS 2023. <https://arxiv.org/abs/2305.04388>.

[#8] Ongaro, D., & Ousterhout, J. (2014). *In Search of an Understandable
Consensus Algorithm (Raft).* USENIX ATC 2014.

[#9] Scott, J. C. (1998), Ch. 1 (scientific forestry / the Normalbaum) — see [#2].

[#10] Park, J. S., et al. (2023). *Generative Agents: Interactive Simulacra of
Human Behavior.* UIST 2023. arXiv:2304.03442.

[#11] Industry consensus on human-in-the-loop oversight for agentic AI
(2024–2026): e.g. Galileo, *How to Build Human-in-the-Loop Oversight for AI
Agents* <https://galileo.ai/blog/human-in-the-loop-agent-oversight>; EU AI Act
human-oversight provisions for high-risk systems.

[#12] Progressive disclosure & provenance in AI UX: Springer/ACM literature on
*Progressive Disclosure: When, Why and How Do Users Want Algorithmic Transparency
Information?* and provenance-based explanation
(<https://arxiv.org/pdf/2507.17761>).

[#13] Conway, M. E. (1968). *How Do Committees Invent?* Datamation, 14(4), 28–31.

[#14] Smith, R. G. (1980). *The Contract Net Protocol.* IEEE Transactions on
Computers, C-29(12). (And FIPA ACL; Bellifemine et al. 2007, JADE.)

[#15] Procida, D. *Diátaxis: A Systematic Framework for Technical Documentation.*
<https://diataxis.fr/>.

[#16] *Hobbes's Moral and Political Philosophy.* Stanford Encyclopedia of
Philosophy. <https://plato.stanford.edu/entries/hobbes-moral/>.

---

*Companion skill (decision points, failure modes, worked examples, quality
gates):* `~/.claude/skills/legibility-for-agentic-systems/SKILL.md`. *Parent:*
ADR-0048 (`docs/adr/0048-what-port-daddy-is.md`), phase 8 (whitepapers).
*Honesty key:* [BUILT] code exists in this repo · [DESIGNED] accepted ADR, not
fully built · [VISION] North Star, unbuilt.
