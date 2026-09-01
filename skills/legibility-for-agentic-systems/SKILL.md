---
name: legibility-for-agentic-systems
description: >
  Make a swarm of autonomous coding agents LEGIBLE to one human operator without
  high-modernist over-flattening. Applies James C. Scott's *Seeing Like a State*
  (legibility, mētis, high-modernism) and Hobbes' *Leviathan* (state of nature ->
  consented authority) to multi-agent software systems. Core discipline:
  DIGEST-WITH-ZOOM — every summary is a lens onto the real artifact (diff,
  reasoning trace, claim row), never a replacement for it. Use when designing
  read-surfaces, dashboards, attention queues, operator consoles, briefings,
  resurrection digests, or any "what is the swarm doing?" view; when an operator
  is drowning in illegible agent output; when deciding what to summarize vs.
  preserve; or when an oversight surface risks putting the human OUT of the loop.
  NOT for: choosing coordination topology (use multi-agent-coordination / Conway),
  the wire protocol of agent messages (use agent-conversation-protocols), or the
  economics of agent labor (use mechanism-design-for-agent-labor).
license: Apache-2.0
allowed-tools: Read,Write,Edit,Bash,Grep,Glob
metadata:
  category: Agent Systems
  tags: [legibility, oversight, evidence, operator-interface, agent-systems]
  provenance:
    kind: first-party
    owners: [port-daddy]
  io-contract:
    kind: deliverable
    produces:
      - kind: critique
        description: Legibility audit identifying where agent state, intent, or provenance is unreadable to operators
      - kind: design-doc
        description: Legibility patterns (receipts, ledgers, status surfaces) for the audited system
---

# Legibility for Agentic Systems

> *"The builder of dashboards is the heir to the cadastral surveyor. Both make
> the territory legible to a sovereign who cannot walk it. Both are tempted to
> mistake the map for the land — and that mistake is where systems die."*

A swarm of coding agents is **Hobbes' state of nature** (*Leviathan*, 1651 — *rational
actors with no common authority fall into a "war of all against all"*). Left
uncoordinated, agents double-claim files, ship illegible PRs, narrate work they
didn't do, and trip footguns. The operator **consents to a coordinating authority**
not because it is benevolent but because the alternative is worse. That authority
governs by making the swarm **legible** (Scott, *Seeing Like a State*, 1998 —
*the property of being arranged so a central observer can read, count, and
control from above*).

The trap: **high-modernism** (Scott — *overconfident faith that a simplified,
top-down scheme can replace the messy local reality*). The state that flattens
too hard destroys **mētis** (Scott — *local, practical, hard-to-codify
know-how*) and the system collapses. **Legibility is the product. Over-flattening
is the failure mode.** This skill is the discipline that holds both.

---

## The one law: DIGEST-WITH-ZOOM

> Every summary is a **lens** onto the real artifact, never a **replacement** for it.

A digest that cannot be zoomed is a high-modernist map: it asserts a reality the
operator can no longer check. A digest that *always* zooms to the underlying
diff, claim row, reasoning trace, or test output preserves mētis — the operator
can always descend from the abstraction to the ground truth and catch the lie.

This single law generates every decision point below.

---

## DECISION POINTS

### D1 — "Should this be a summary, or the raw thing?"
```
Is the operator going to ACT on this (approve/reject/intervene)?
├─ YES, irreversibly (merge, deploy, delete)
│   └─ Summary MUST link to the artifact, and the artifact MUST be one
│      keystroke away. Never let an irreversible action be taken on a
│      digest alone. (Endsley out-of-the-loop problem — see F3.)
├─ YES, reversibly (re-prioritize, nudge, re-assign)
│   └─ Summary is fine as the default view; zoom is on-demand.
└─ NO, just situational awareness ("what's happening?")
    └─ Summary is the product. But the zoom path must still EXIST, or the
       operator cannot audit the summarizer when they distrust it.
```

### D2 — "What do I flatten, and what do I preserve?"
```
Flatten (safe to standardize — it is YOUR structured field):
  - IDs, claim rows, session phases, port numbers, commitment status,
    enum states. Scott: legibility of *administrative* facts is cheap & safe.
Preserve verbatim, never paraphrase (it is the agent's mētis / the ground truth):
  - the diff, the test output, the error message, the reasoning trace,
    the exact command run. Paraphrasing these IS the over-flattening.
Rule of thumb: summarize the STATE, link to the WORK.
```

### D3 — "Is my oversight surface actually keeping the human in the loop?"
```
After shipping a read-surface, ask:
├─ Could the operator approve 50 PRs in a row without opening one?
│   └─ You built an out-of-the-loop machine (Bainbridge irony). Add friction
│      proportional to stakes: batch low-risk, FORCE-zoom high-risk.
├─ Does "all green" ever appear without a check having run?
│   └─ That's a high-modernist lie (honest-green violation; ADR-0045).
│      Distinguish verified-good from no-evidence-of-bad.
└─ Can the operator reconstruct WHY an agent did X from the surface alone?
    └─ If not, you have a map with no path back to the territory. Add provenance.
```

### D4 — "How much authority does the digest's author have?"
```
Who wrote the summary, and can they be wrong or lying?
├─ A deterministic projection of structured state (claim rows -> table)
│   └─ Trust the digest; zoom is for spot-checks.
├─ An LLM summarizing another LLM's work
│   └─ DISTRUST by default. The summary can be unfaithful (Turpin 2023, see F4).
│      The zoom target must be the ARTIFACT, not the summarizer's gloss of it.
│      Two LLMs agreeing is not two checks; it may be one error twice.
```

---

## FAILURE MODES

### F1 — The Potemkin Digest (high-modernism, classic)
**Symptom:** A beautiful dashboard / TUI that *looks* like total awareness but
whose tiles don't link to anything, or link to a paraphrase.
**Detection:** Try to click from any number to the artifact that produced it. If
you can't reach the diff/log/row in ≤2 steps, it's Potemkin.
**Fix:** Wire every aggregate to its constituents. The digest is an *index*, not
a *replacement* (this is the same rule as "summaries as indexes" in ADR-0047).

### F2 — Mētis Erasure (over-flattening the agents)
**Symptom:** The coordinator forces every agent into one rigid schema (one PR
template, one status enum) and silently drops anything that doesn't fit — the
agent's "I tried X, it failed for subtle reason Y, so I did Z" becomes status:
`done`.
**Detection:** Information the agent HAD is not recoverable from the system.
**Fix:** Give agents a verbatim, append-only channel (notes, reasoning trace)
that the schema *references* but does not *replace*. Standardize the index, not
the content. Scott's lesson: the state needs the local knowledge it is tempted
to erase.

### F3 — Out-of-the-Loop Operator (the irony of good automation)
**Symptom:** The better the digest, the less the operator looks at real work;
when an agent finally lies or errs, the operator has no situational awareness to
catch it. **Bainbridge** (1983, *Ironies of Automation* — *the more reliable the
automation, the less practiced and aware the human supervising it becomes*) and
**Endsley** (1995, *out-of-the-loop performance problem* — *operators removed
from active engagement lose the situation awareness needed to intervene when
automation fails*).
**Detection:** Approval latency drops to near-zero; force-zoom events approach
zero; operator can't answer "why did agent-7 touch auth.ts?" without re-reading.
**Fix:** Stakes-proportional friction. Rotate forced spot-checks (sample real
diffs even when green). Surface *anomalies*, not just *throughput*. The digest's
job is to *direct attention*, not *replace* it.

### F4 — Faithful-Looking, Unfaithful Zoom
**Symptom:** You let the operator "zoom" to the agent's chain-of-thought and
treat that as ground truth. But the reasoning trace is post-hoc narration, not
the cause of the action.
**Detection:** The stated reason and the actual diff disagree, or the same model
both acts and explains.
**Reference:** **Turpin et al. 2023** (*"Language Models Don't Always Say What
They Think"* — *CoT explanations can be systematically unfaithful: plausible,
coherent, and not what actually drove the output*).
**Fix:** The canonical zoom target is the **artifact the operator can verify
independently** — the diff, the test result, the file on disk — not the agent's
self-report. Self-reports are a *secondary* lens, always labeled as such.

### F5 — The Sovereign That Can't Be Audited (illegible authority)
**Symptom:** The coordinator itself is a black box — it blocks an agent, escalates,
or reorders work, and the operator can't see why. Legibility flows up from agents
but the authority is opaque.
**Detection:** "Why did PD reject this?" has no surface answer.
**Fix:** The Leviathan must be the *most* legible actor. Every authority action
(claim denial, Arbiter block, escalation) is a logged, zoomable event with a
named invariant and the fix. Consent is renewable only if the authority is
inspectable (Hobbes' covenant is *among the subjects*; legitimacy requires the
sovereign's acts be intelligible).

---

## WORKED EXAMPLES

### W1 — Designing an Attention Queue (the operator read-surface)
**Goal:** Show one operator what 12 agents need from them, without 12 transcripts.

- **Flatten (D2):** a ranked list of items, each `{from, type∈{distress,request,
  signal}, one-line, stakes, age}`. This is administrative legibility — safe.
- **Preserve / zoom (D1, the law):** each row expands to the *originating
  message verbatim* and links to the agent's session, its claimed files, and the
  diff-in-progress. The one-line is the lens; the message+diff is the thing.
- **In-the-loop guard (D3/F3):** a `distress` on an irreversible action (about to
  force-push) is force-zoomed: the operator cannot dismiss it without seeing the
  command. A `signal` (FYI) can be batch-acknowledged.
- **Anti-Potemkin check (F1):** from any queue item, the diff is ≤2 keystrokes.

### W2 — A Resurrection Digest (the successor read-surface)
**Goal:** A new agent inherits a dead agent's job. What does it read?

- **Wrong (F2 mētis erasure):** "Previous agent: status DONE." The successor
  re-does work, or misses the subtle failure the predecessor knew about.
- **Right (digest-with-zoom):** a summary of {claimed files, last commit,
  open commitments} that *links to* the predecessor's verbatim notes and reasoning
  trace. The successor reads the digest to orient, then zooms to the mētis to
  avoid repeating the dead agent's hard-won lessons. (This is exactly why
  memory+checkpoint is the North Star through-line: continuity is preserved mētis.)

### W3 — "All Green" on a Roadmap Dashboard
**Goal:** Operator glances at a board; everything is green.

- **Honest-green discipline (D3/F1, ADR-0045):** green means *a check ran and
  passed*, rendered distinctly from *no check available*. A tile that was never
  verified is grey/striped, never green. Each green tile zooms to the *actual
  check output* (the test log), not a claim that it passed.
- **Why:** an unverified green is the purest high-modernist artifact — a map
  asserting a reality nobody confirmed. The operator's consent to the authority
  is forfeit the first time green is a lie.

---

## QUALITY GATES

Before shipping any read-surface / digest / oversight view:

- [ ] **Zoom path exists and is short.** Every aggregate links to its
      constituents in ≤2 steps. (F1)
- [ ] **State summarized, work preserved.** No diff, log, error, or reasoning
      trace is paraphrased where the operator might act on it. (D2/F2)
- [ ] **Zoom target is verifiable, not self-reported.** The canonical ground
      truth is the artifact, not the agent's narration of it. (F4)
- [ ] **Stakes-proportional friction.** Irreversible actions force a zoom; trivial
      ones batch. No path lets the operator approve-without-seeing at scale. (F3)
- [ ] **Honest green.** "All good" is conjunctive, scoped, and distinguishes
      verified-good from no-evidence-of-bad. (D3, ADR-0045)
- [ ] **The authority is legible too.** Every coordinator/Arbiter action is a
      logged, named, zoomable event. (F5)
- [ ] **mētis has a home.** Agents have a verbatim, append-only channel the
      schema references but does not replace. (F2)
- [ ] **Out-of-the-loop tested.** You simulated "operator blindly trusts the
      digest" and confirmed an injected lie/error is still catchable. (F3)

---

## NOT-FOR BOUNDARIES

- **Coordination topology** (how many agents, what shape) → `conway-1968-how-do-committees-invent`, `multi-agent-coordination`.
- **What agents SAY to each other** (performatives, contract net) → `agent-conversation-protocols`, `smith-1980-contract-net-protocol`.
- **Consensus / leader election mechanics** → `ongaro-ousterhout-2014-raft`.
- **The economics of agent labor / reputation pricing** → `mechanism-design-for-agent-labor`, `nisan-et-al-2007-algorithmic-game-theory`.
- **Durable obligations / commitment monitoring** → `normative-bdi-agents`, ADR-0041.

This skill is *only* about the legibility relationship between the swarm and the
one human operator: what to render, what to preserve, and how to keep the human
in the loop without lying to them with a pretty map.

---

## PROVENANCE

Authored for Port Daddy's North Star (ADR-0048, L2 — *legibility & authority,
the Leviathan, the operator GUI*) alongside `whitepaper/research/program/archive/north-star/legibility-leviathan.md`.
Anchors: Scott 1998 (*Seeing Like a State*); Hobbes 1651 (*Leviathan*); Rao 2010
(*A Big Little Idea Called Legibility*, ribbonfarm); Bainbridge 1983 (*Ironies of
Automation*); Endsley & Kiris 1995 (*out-of-the-loop performance problem*);
Turpin et al. 2023 (*unfaithful chain-of-thought*); Dai et al. 2024 (*Artificial
Leviathan*, arXiv:2406.14373). Grafted en route: conway-1968, ongaro-ousterhout-2014-raft,
bdi-agent-design-mora.
