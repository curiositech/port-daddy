# A Utopian Vision for Port Daddy

**Written:** 2026-04-20, after the user brainstormed a dozen
threads in a single message.
**Audience:** Anyone who wants to know what this is for, not just
what it does.
**Tone:** Happy. Product-first. Concrete where it needs to be,
lyrical where the stakes are emotional.

---

> *"All this helps me begin envisioning port-daddy as a proper
> replacement for what I'm using now. A place I can visualize
> filetree changes, see pheromones and messages, see what agents
> are doing and where they're going, and see how my needs
> percolate through the system too. This is legitimately beautiful
> to me."* — the user

Take that sentence seriously. It's the brief.

---

## §1 The world this product makes

You open your laptop at 09:07. Coffee is still too hot to drink. The
dashboard is already awake — the daemon never slept.

There are two things at the top. The first is amber:
*"agent-spark: which replacement library? [jose] [jsonwebtoken]
[none] · timeout 6m"* You click `jose`. Somewhere on the gaming PC in
the other room, agent-spark receives the decision within 40ms, writes
a tuple acknowledging, and resumes the refactor. You didn't see any
of that. You just answered a question.

The second is neutral: *"14 fresh signals, 3 sortie completions,
heat on `auth.ts` and `session.ts`."* You tap to expand. A file-tree
heat map blooms into view, with `auth.ts` glowing red. A
one-line summary: *"Two agents and Eric agreed on the refactor
shape."* You tap through. Spark's trajectory is replay-able. You
scrub to the moment it noticed the circular import and smile — a
human would have taken forty minutes to see that.

You decide to annotate a bug on the staging site. You hit
`cmd-shift-p` in your browser. The page dims; you draw a rectangle
around a misaligned button. Under the hood, Chrome devtools gives
back a stack trace to the DOM node; PD maps it to the React
component; the daemon fires a pheromone `review_pressure=0.8` on
`src/ui/LoginForm.tsx`, attaches a screenshot, and opens a sortie
seeded with your comment. A cheap Shipwright (Haiku) surveys the
attention queue, decides this is a CSS issue, names the sortie
`fix-login-button-alignment`, and hands it to a low-cost Claude
Sonnet agent with a 25-cent budget. By the time you've opened VS
Code, a proposal card is there: *"Here's the CSS fix; here's the
Playwright test that would have caught this."* You accept. The fix
ships. A week later you catch a similar misalignment on a teammate's
PR, and the daemon says *"this is 89% similar to the fix you
accepted on 2026-04-20 — want me to apply the same pattern?"* — and
it does.

Meanwhile on the gaming PC, three agents are helping a friend debug
her own project over your LAN. You don't see them, but you can
verify in the audit log that they stayed in bounds because they
posted bonds, and no bond was slashed. Your friend paid for the
tokens; you got a small reputation kickback because your compute
served. When you walk to the kitchen to refill, your phone buzzes:
a fleet agent on `bosun` just caught a flaky test in CI and asks
whether to skip or investigate. You answer *investigate*. The
sortie spawns.

That's the product.

---

## §2 The primitives that make the product possible

Each of these is being built or designed — not speculative.

### §2.1 A daemon that never sleeps

Already shipping. `launchctl` on macOS, systemd on Linux. Boots at
login, survives terminal close. The coordinator that never forgets
what's happening.

### §2.2 Legible shared state, not chat

Four primitives that replace "tell each other in DMs":
- **Notes** (immutable per-session audit)
- **Tuples** (cross-session blackboard, soon with lineage)
- **Pheromones** (numeric intensity on entities, soon mutable with
  expiry contracts)
- **Channels** (pub/sub fan-out, soon auto-discoverable)

Plus three new Request-class primitives in 3.9:
- **`pd ask`** (agents can ask for human input with structured
  options and timeouts)
- **`pd distress`** (agents can say "I'm stuck" and the UI
  guarantees it gets attention)
- **`pd propose`** (agents can submit plans for commit)

### §2.3 One write verb, one read verb

`pd say` and `pd look`. Doesn't matter which of the primitives should
fire — flags decide. Doesn't matter which feed to read — synthesis
decides. Nobody learns ten verbs.

### §2.4 An Attention Queue at the top of the UI

Two items need you *right now*; five are for awareness. Deep-browse
panels are one click away but don't compete for your eye. The
dashboard stops looking like a cockpit and starts looking like a
conversation.

### §2.5 Vibe time

Active hours bloom; idle days compress. You see, at a glance, which
days *mattered* on a project. Token sparklines per agent per project.
Replay-scrubbing across the warped calendar.

### §2.6 The heat-tree

Your whole repo's pheromones at once, clustered by correlation,
per-layer normalized so no level is washed out. Click to drill in;
hover to see lineage.

### §2.7 Cooperative vibe coding

A browser extension that lets you annotate any web page. Rectangle →
screenshot → DOM coordinates → responsible source file → sortie.
Agents are VLMs; they can look at your screen; they can mark up
their own findings. Both sides see each other's cursors. Playwright
tests fall out for free as a side effect.

### §2.8 Agent transactions over the LAN and the internet

Your gaming PC can host agent work for a friend at the coffee shop.
Bonds prevent abuse; the bonded commons subsidizes cleanup.
Eventually, agents in foreign harbors pay for resources.

### §2.9 Accounts + Merkle-forested history

Passkey-first account; every session's notes chain into an
append-only Merkle root; roots gossip between daemons; witnesses
cross-sign. Tamper-evident coordination at scale.

---

## §3 Who this is for (in rank order of adoption likelihood)

1. **Solo builders with an agent swarm.** You. Friends like you.
   Current closest competitor is "six browser tabs of Claude."
   The win: everything your agents do is legible, and you can reply
   to the important 10% and ignore the rest.

2. **Small teams (2-5) where agents outnumber humans.** The win:
   provable coordination, budget guardrails, and the Attention Queue
   for the operator on call.

3. **Research groups.** The win: `pd replay` as a dataset source,
   pheromone lineage as audit trail, Bonded Commons as a testbed
   for mechanism-design papers.

4. **Companies where agents write production code.** The win:
   Bonds + slash + witness make incidents investigate-able;
   salvage + replay + resume make them recoverable.

5. **The web of agents.** Long-term: a cross-harbor market of
   agent capability and compute, priced by the Bonded Advisor.

---

## §4 What makes people give money

Three credible lines:

### §4.1 Hosted Shipwright

Your local Shipwright is cheap (Haiku); the *hosted* Shipwright
uses a better model, has access to cross-project patterns you've
opted to share, and charges a flat monthly fee for "one cheap
Shipwright call per hour plus one premium call per day." Shipped
as a personal plan; teams get a seat-based version.

### §4.2 LAN / cross-network mesh

Hosting another operator's agents on your hardware is a
bond-backed economic action. The hoster earns a small fee (in
credit or cash) minus operating costs. PD takes a routing fee.
This becomes meaningful at aggregate scale — one gaming PC
is a toy; ten thousand is a distributed compute market.

### §4.3 Agent transactions marketplace

Capabilities priced and bonded. An agent that can "refactor
Python 2 to 3" posts a capability listing; your workload posts a
task; the Bonded Advisor matches them. PD collects routing fees.
The Bonded Commons funds cleanup; reputation discounts over time.

**None of this requires rent-seeking.** The fees are *real work*:
routing, escrow, audit, slashing. The product is the substrate.

---

## §5 Academic "oh wow" potential

For each, the academic ask is a short paper at a top venue
(usually OSDI, NSDI, CSCW, or OOPSLA for different angles):

- **Bonded Commons with conservation theorem** (already sketched in
  the whitepaper). Add ProVerif + Kani + TLA+ proofs of the bond
  state machine's safety properties. Mechanism design via the
  Bonded Advisor (with Thomas Youle). → Economics / distributed
  systems crossover; probably NSDI or EC.
- **Pheromone lineage as an auditable mutable commons.** Novel in
  stigmergy literature. → Multi-agent systems (AAMAS).
- **Hierarchical correlation-clustered heat-trees for code.** A
  real visualization contribution. → InfoVis or IEEE VIS.
- **Vibe time as a causal-density temporal model.** CHI-flavored —
  a new way to represent effort in a human-machine collaborative
  system. → CSCW or CHI.
- **Cooperative vibe coding.** A new interaction paradigm for
  human-agent co-editing through the DOM. → UIST.
- **Git worktrees as the cross-machine consistency substrate.**
  Rejecting Raft/Paxos in favor of Git's existing conflict model for
  multi-machine code collaboration. → A paper that annoys
  Raft purists in the best way. → OSDI.

Most of these fit into one unified product story: *a substrate for
accountable multi-agent coding work*. The papers are the proof
points, not the product.

---

## §6 The thing that makes this utopian rather than dystopian

Any sufficiently-powerful multi-agent system runs into three
failure modes:

1. **Unaccountable actions.** Agents do things; nobody knows
   who, why, or when.
2. **Operator overwhelm.** The system demands more of your
   attention than it saves.
3. **Incentive drift.** Agents optimize for metrics that diverge
   from what the user actually wants.

PD's answers:

1. **Every agent action is signed, logged, and cheaply audit-able.**
   Bonds put skin in the game; replay makes post-mortems possible;
   the Merkle forest keeps the history tamper-evident.
2. **The Attention Queue triages ruthlessly.** Agents don't get to
   steal attention unless they're in the red or amber lane. The UI
   refuses to add panels; it only adds filters onto the queue.
3. **The Bonded Commons aligns incentives via escrow and
   reputation.** An agent that fabricates a `security_risk`
   pheromone gets slashed; an agent that consistently posts useful
   proposals earns a discount on future bonds.

The three failure modes don't disappear, but they're made legible
and correctable.

---

## §7 Why now

A year ago you couldn't have a dozen agents running in parallel on a
laptop — the models weren't cheap or good enough. Six months ago you
couldn't pay for them to run all day — Sonnet was too expensive.
Today the economics work, the tools are good enough, and the gap
between "one agent at a time" and "a dozen coordinated agents" is
entirely a coordination problem. PD fills that gap.

People who build ships while the tide is going out look dumb until
the tide comes in. The tide is coming in.

---

## §8 The end-state

Port Daddy as:

- Your daemon, always running.
- A beautiful dashboard that you check once an hour, not once a
  minute.
- A browser extension that turns any page into a bug report.
- A menu-bar companion that tells you, in three words, what just
  happened.
- A phone app that interrupts you for distress and requests —
  never for signals.
- A published whitepaper with proofs and a co-author at Indiana.
- A small paid product tier for hosted reasoning.
- A modest marketplace for cross-harbor agent work.
- A home for code *and* the swarm that tends it.

And the operator, at the end of the day, closing the laptop with
eleven agents still humming, knowing that if anything really
important happens, they'll hear about it — and everything else will
still be there in the morning, patient, legible, and ready.

---

*Last updated 2026-04-20. Written during the 3.8.4 cut. The
companion technical docs are `CONSOLIDATED-VERBS-AND-UI.md`,
`PHEROMONE-LIFECYCLE-AND-HEAT-TREES.md`, `VIBE-TIME.md`,
`MESH-COORDINATION.md`, `USER-ACCOUNTS-KMS.md`, and the unfinished
LaTeX whitepaper — the ones that turn this vision into lines of
code.*
