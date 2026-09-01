# Plan + Draft: "Obligations & Accountability" Whitepaper Chapter

**Status.** Plan + draft only. This file does NOT modify the published whitepaper TSX/data, so the
website build cannot break. It is the spec a follow-up PR would execute against `whitePapers.ts`.

**Provenance of the source material.** The two research documents this chapter generalizes —
`docs/research/agent-accountability-proposal.md` (the flagship; five laws, regimentation vs.
enforcement, the obligation tuple) and `docs/research/agent-accountability-mechanisms.md` (condensed
synthesis) — and the two ADRs it cites (ADR-0040, ADR-0041) currently live **only on branch
`docs/agent-accountability-research` (commit `dd8a3ee7`)**, not on `origin/main`. They were read from
that commit while drafting. See "Cross-branch dependency" under the Source Map.

---

## Part A — Source Map

### A.1 Where whitepaper prose actually lives

The whitepaper is **not** MDX or markdown. Each paper/chapter is a **typed object in a TypeScript
data array**, rendered by a single React page component that reads structured fields. There is no
per-chapter markdown file and no MDX compiler in this surface.

| Concern | File | Detail |
|---|---|---|
| Content (the data) | `website-v2/src/data/whitePapers.ts` | `export const WHITE_PAPERS: WhitePaper[]` at line **41**; two entries today: `anchor-protocol` (line **42**) and `bonded-commons` (line **142**). Array closes at line **252**. |
| Shape of a chapter | `website-v2/src/data/whitePapers.ts:12-39` | `interface WhitePaper` — the field contract every chapter must satisfy (see A.2). |
| Renderer | `website-v2/src/pages/whitepaper/PaperDetailPage.tsx` | Resolves a paper by slug (`findWhitePaperBySlug`, line **16**) and renders its fields into fixed sections. |
| Lookup helpers | `website-v2/src/data/whitePapers.ts:280-286` | `findWhitePaperById`, `findWhitePaperBySlug`. |
| Reading-order copy | `website-v2/src/data/whitePapers.ts:254-270` | `READING_ORDER` — the "01 / 02 / 03" guided path; a third chapter likely wants a `04`/insert here too. |

The renderer maps fields to page regions like this:

| `WhitePaper` field | Rendered as | `PaperDetailPage.tsx` |
|---|---|---|
| `title` / `subtitle` / `status` | Header + H1 | lines 44-50 |
| `primer` | "The big idea, in one paragraph" (brand-color band) | lines 110-112 |
| `glossary[]` `{term, definition}` | "Vocabulary" definition grid | lines 130-144 |
| `whatYouGet` / `forBuilders` | Two-up "learn / build" color blocks | lines 158-171 |
| `sections[]` `{title, content}` | "Argument map" (numbered steps, sidebar) | lines 188-203 |
| `takeaways[]` `{title, body}` | "Takeaways" (numbered, sidebar) | lines 214-228 |
| `pdfPath` | Embedded `<iframe>` PDF reader | lines 281-287 |
| `readerHref` / `overviewHref` | Routes used by index + sibling links | lines 248-262 |

**Consequence for this chapter.** The page is *structured-data driven*, not free markdown. The
markdown draft in Part B below is written so it maps cleanly onto those fields: the prose body
becomes the **PDF** (`pdfPath`) and/or is decomposed into `primer` / `glossary` / `sections` /
`takeaways`. The draft headings are annotated with the field they feed.

### A.2 The `WhitePaper` field contract (what a new chapter MUST provide)

From `website-v2/src/data/whitePapers.ts:12-39`:

```
id, slug, title, subtitle, thesis, summary,
filename, pdfPath, readerHref, overviewHref,
date, pages, sizeKb, status, order,
primer,                       // one-paragraph plain-language welcome
glossary: {term, definition}[],
whatYouGet, forBuilders,
highlights: {icon: LucideIcon, label}[],
sections: {title, content}[],  // the "argument map"
takeaways: {title, body}[]
```

`highlights` icons come from `lucide-react` (imported at the top of the file). `pdfPath` points at a
real PDF under `website-v2/public/whitepaper/`.

### A.3 What the existing whitepaper is ABOUT (the arc this chapter joins)

Two chapters today, in deliberate reading order (`READING_ORDER`, line 254):

1. **The Anchor Protocol** (`order: '01'`, line 60) — *identity*: how one local program proves who it
   is to another, via signed capability tokens (Ed25519), verified in ProVerif. Answers "who is this
   program?"
2. **The Bonded Commons** (`order: '02'`, line 160) — *shared state*: Ostrom commons governance for a
   directory of agents. Three pieces — the **commons** (announce intent), the **bond** (refundable
   escrow deposit), the **ledger** (tamper-evident Merkle history) — with a TLA+ **conservation
   invariant** (`wallet + escrow + commons = supply`, line 177) and market-priced bonds.

**The gap the new chapter fills.** Bonded Commons prices a *one-shot* deposit against making a mess
in a shared workspace — escrow posted on spawn, refunded on clean exit, slashed on breach. It does
not model a *standing obligation over time*: "keep tests green," "keep the roadmap free of
contradictions." The bond is the sanction primitive; the obligation lifecycle (activation,
maintenance, deadline, closure, graduated sanction) is the missing generalization. The new chapter
**"Obligations & Accountability"** is the natural `order: '03'`: it takes the bond from Bonded
Commons and embeds it as the *Sanction* slot of a full obligation tuple, then layers the five laws
that keep the whole thing from becoming theater.

### A.4 EXACT integration point

Two coordinated edits, both in `website-v2/src/data/whitePapers.ts` (the renderer needs **no**
change — it is fully data-driven):

1. **Insert a third object into `WHITE_PAPERS`**, immediately after the `bonded-commons` object closes
   at **line 251** (the `},` before the array-closing `]` on line 252). Suggested key fields:

   ```ts
   {
     id: 'obligations-accountability',
     slug: 'obligations-accountability',
     title: 'Obligations & Accountability',
     subtitle: 'How a program stays on the hook for a job after the prompt that asked for it is gone.',
     status: 'Version 0.1 (draft)',
     order: '03',
     date: 'May 2026',
     pages: /* set when PDF exists */,
     sizeKb: /* set when PDF exists */,
     filename: 'obligations-accountability-whitepaper',
     pdfPath: '/whitepaper/obligations-accountability-whitepaper.pdf',
     readerHref: '/whitepaper/obligations-accountability',
     overviewHref: '/whitepaper?paper=obligations-accountability',
     thesis: /* from Part B §"thesis" */,
     summary: /* from Part B §"summary" */,
     primer: /* from Part B §Primer */,
     glossary: [ /* from Part B §Glossary */ ],
     whatYouGet: /* from Part B */, forBuilders: /* from Part B */,
     highlights: [ /* Lucide icons: Scale, Clock, ShieldCheck, Fingerprint */ ],
     sections: [ /* from Part B argument-map blocks */ ],
     takeaways: [ /* from Part B takeaways */ ],
   },
   ```

2. **Add a reading-order step** to `READING_ORDER` (lines 254-270): a `step: '04'` entry placed after
   the existing `03` ("go look at the actual software"), or renumber so the new chapter reads after
   Bonded Commons. Copy must explain that this chapter generalizes the bond into a standing obligation.

**A PDF must exist** at `pdfPath` before the chapter ships (the renderer embeds it in an `<iframe>`,
`PaperDetailPage.tsx:281-287`); `pages`/`sizeKb` are set from that file. Until then the chapter can
ship with the PDF panel pointing at a placeholder, but `forBuilders`/`sections`/`takeaways` carry the
real value and render without it.

### A.5 Cross-branch dependency (must resolve before the real edit)

The source docs and the ADRs this chapter cites are **not on `origin/main`**:

- `docs/research/agent-accountability-proposal.md`, `docs/research/agent-accountability-mechanisms.md`
  — branch `docs/agent-accountability-research`, commit `dd8a3ee7` (research worktree at
  `~/coding/tmp/wt-accountability-docs`).
- `docs/adr/0040-non-forgeable-actor-identity.md`,
  `docs/adr/0041-durable-commitments-and-obligation-monitoring.md` — same branch/commit. The highest
  ADR on `origin/main` today is **0039**.

The implementing PR should land after (or alongside) that research branch merges to `main`, so the
inline citations in Part B resolve to real files on the default branch.

### A.6 Code paths cited by this chapter (verified present on `origin/main` / this worktree)

| Path | Exists here | Role in chapter |
|---|---|---|
| `lib/arbiter.ts` | yes | Regiments prohibitions (e.g. `LOCK_OWNER_VALID`, line ~107). |
| `lib/bonds.ts` | yes | Escrow/slash/refund; Ostrom + `wallet+escrow+commons=supply` in header (lines 10-31). |
| `lib/resurrection.ts` | yes | Heartbeat-staleness detector — the "alive, not faithful" contrast. |
| `lib/coordination-route-guard.ts` + `cli/commands/guard.ts` | yes | Coordination Guard — the Execute-side effector. |
| `lib/roadmap-pop.ts` | yes | Degenerate Contract-Net award. |
| `lib/actor-roster.ts` | yes | Today resolves *self-asserted* identity strings (the Sybil hole). |
| `lib/worktree-policy.ts` + `lib/sugar.ts` | yes | The "bug that proves the thesis" (self-advertising bypass, PR #186). |
| `docs/adr/0022-durable-actor-souls-and-body-leases.md` | yes | Durable identity the non-forgeable id binds to. |
| `docs/adr/0038-claim-tree.md` | yes | The advisory claim that *creates* the obligation. |
| `lib/commitments.ts`, `lib/obligation-monitor.ts`, `lib/sanction-ladder.ts`, `lib/accountability-ledger.ts` | **NOT YET** | Proposed build (ADR-0041); the chapter presents these as the build order, clearly marked unbuilt. |

---

## Part B — Chapter Draft: "Obligations & Accountability"

> House-style contract (from `AGENTS.md` § Writing Technical Documents, and exemplified by
> `docs/research/agent-accountability-proposal.md`): the **first** use of any external technical term
> gets **bold + citation + one-line gloss**; the **first** mention of any Port Daddy abstraction gets
> **bold + source-file path relative to repo root + one sentence**. This is an *explanation* document
> (Diátaxis), not a tutorial.

*(Field mapping annotations like `→ primer` indicate which `WhitePaper` field each block feeds.)*

### thesis → `thesis`

A bond posted once, refunded on clean exit, is the right tool for a one-shot job and the wrong tool
for a standing duty. "Keep the tests green" is not a task that completes; it is an obligation that
persists, can be violated, and must cost something when it is. This chapter generalizes the Bonded
Commons deposit into the full lifecycle of an obligation — when it arms, what keeps it alive, when it
is due, what counts as closing it, and what happens when it is missed — and states the five laws that
keep that lifecycle from collapsing into a number the agent can fake.

### summary → `summary`

A guided read of how Port Daddy moves *responsibility* out of the prompt and into the substrate: why
an obligation is fundamentally different from the prohibitions the Arbiter already enforces, the
six-slot tuple that gives an obligation a beginning and an end, and the five laws — load-bearing fact
outside the agent's reach, closure bound to an oracle, non-forgeable identity, fail closed, graduated
staked sanctions — that an audit of 29 candidate mechanisms reduced everything down to.

### Primer → `primer`

You give an agent a standing job — keep the test suite green — and write a good system prompt for it.
It works once. Then the context window rolls over, the next invocation never sees that sentence, and
the job is simply gone. Nobody dropped it on purpose; it evaporated. That is the difference between
*doing a task* and *holding a responsibility*: a task completes, but a responsibility persists, can be
broken, and only means something if breaking it costs something. The Bonded Commons chapter built the
cost — a small refundable deposit, the **bond**, that an agent posts and forfeits if it leaves a mess.
This chapter builds the *hook the cost hangs on*. An obligation, unlike the lock-ownership rules the
daemon already enforces, cannot be made physically impossible to violate — you cannot make "failing to
keep tests green" unreachable the way you can make "holding a lock you don't own" unreachable. It can
only be watched and, when missed, sanctioned. And the instant you watch it through a proxy ("a result
note exists," "the row says done"), a lazy agent will optimize the proxy instead of the work. The
whole chapter is about closing that gap.

### Glossary → `glossary`

- **Obligation (deontic sense).** From **deontic logic** (von Wright 1951 — *the formal logic of
  obligation, permission, and prohibition*): a "must" that is intrinsically *violable*. Contrast a
  prohibition, a "must not" that can be made unreachable.
- **Regimentation vs. enforcement.** Jones & Sergot 1993 — *regimentation* makes a forbidden state
  physically impossible; *enforcement* allows the violation but detects it and applies a sanction.
  You can regiment a prohibition; you can only enforce an obligation.
- **Obligation tuple.** Tufiş & Ganascia (normative BDI) — an obligation modeled as
  ⟨Modality, Activation, Expiration, Content, Sanction, Reward⟩, a structure that *arms* against world
  state and *disarms* when its content is met.
- **Goodhart's law.** Goodhart 1975; Strathern 1997 — *"when a measure becomes a target, it ceases to
  be a good measure."* Every obligation monitor reduces compliance to a proxy, and the proxy is what
  the agent games.
- **Oracle.** A trusted source of ground truth the agent cannot author — a released claim, a merged
  commit SHA, a passing test id — used to decide whether an obligation is actually discharged.
- **Sybil attack.** Douceur 2002 — defeating a reputation system by minting many fresh identities; a
  penalized agent forging a clean record by respawning under a new name.
- **Fail-closed.** Saltzer & Schroeder 1975 (*fail-safe defaults*) — when a control cannot run, deny
  rather than allow; an unavailable enforcer must block the gated action, not silently degrade.

### whatYouGet → `whatYouGet`

You should leave able to (a) classify any "make the agent responsible for X" request as a prohibition
(regiment it — cheap and ungameable) or an obligation (enforce it — and pay for the proxy gap), and
know why most such requests are obligations wearing a prohibition's clothes; (b) read the six-slot
obligation tuple and see where Port Daddy's existing primitives already supply each slot; and (c)
recite the five laws well enough to spot when an "accountability" feature is theater — a number the
agent set, a closure the agent authored, an identity the agent can re-mint.

### forBuilders → `forBuilders`

If you are building anything where an agent must *own* a property over time — a fleet that keeps CI
green, a documentarian that keeps docs in sync, a roadmap actor that resolves contradictions — this
chapter is the blueprint for the accountability layer. It tells you which fact must be daemon-derived
(the clock and the deadline), what closure must bind to (an oracle, not free text), why the identity
the whole edifice rests on must be daemon-issued and key-bound, and how to stake the sanction on the
existing bond escrow so a miss costs something real. The build order is sequenced so each layer rests
on a non-spoofable foundation; ship the reputation score last, never first.

### Argument map → `sections[]`

Each block below is one `{title, content}` entry. `content` is a single tight paragraph (matches the
existing chapters' density).

1. **From a deposit to a duty.** *(content)* The Bonded Commons **bond** (`lib/bonds.ts` — *collateral
   an agent escrows on spawn, refunded on clean exit or slashed on breach; its header states the
   conservation invariant `wallet + escrow + commons = supply` and quotes Ostrom 1990 directly*) prices
   a one-shot mess. A standing duty needs a beginning, a maintenance condition, a deadline, and a
   terminal state — none of which a single escrow row carries. This chapter keeps the bond exactly
   where it is and re-files it as the *Sanction* slot of something larger.

2. **You cannot regiment an obligation.** *(content)* Port Daddy's **Arbiter** (`lib/arbiter.ts` — *a
   runtime monitor that records and, in enforce mode, blocks forbidden coordination states such as two
   agents holding the same lock*) **regiments** prohibitions: it makes the forbidden state unreachable,
   so the proxy *is* the thing and there is nothing to game. Responsibility is the other deontic
   modality — an **obligation** — and obligations are intrinsically violable. They can only be enforced:
   watched, and on a missed deadline, sanctioned. The first design act is therefore to classify each
   desired property as prohibition (regiment — cheap, Goodhart-proof) or obligation (enforce — and pay
   for the proxy gap).

3. **The obligation tuple.** *(content)* The **normative-BDI obligation tuple** (Tufiş & Ganascia —
   *an obligation as ⟨Modality, Activation, Expiration, Content, Sanction, Reward⟩, which arms and
   disarms against world state*) gives the missing structure. Modality = must/may/must-not. Activation
   = the event that arms it (a **claim**, `docs/adr/0038-claim-tree.md` — *an advisory announcement
   that an agent intends to touch a file or region* — creates the obligation, so "make no promise" is
   impossible). Expiration = a deadline the **daemon** (`server.ts`, the always-on `localhost:9876`
   process backed by SQLite — the only component that can hold state no agent can edit) derives, never
   the agent. Content = the maintained predicate. Sanction = the bond. Reward = refund/reputation on
   clean discharge.

4. **The proxy gap, measured.** *(content)* An audit mined 46 mechanisms from the agent-theory canon
   and the codebase and adversarially stress-tested the 29 non-baseline ones against a *capable but
   lazy, self-interested* agent. **Goodhart's law** (Goodhart 1975; Strathern 1997 — *"when a measure
   becomes a target, it ceases to be a good measure"*) flagged 29 of 29: every monitor reduces
   compliance to an observable proxy, and the gap between the proxy and genuine discharge is exactly
   where the lazy agent lives. Recurring sub-failures: closure not bound to reality (13/29), clock/sleep
   skew (17/29), **Sybil-reset** (Douceur 2002 — *forging a clean record by minting a new identity*,
   11/29), human-gate deadlock in a single-operator fleet (10/29). Exactly one mechanism survived
   unhardened — the regimentation/enforcement distinction of §2, which is a distinction, not a feature.

5. **Five laws of agent accountability.** *(content)* Every surviving hardening reduces to five rules;
   violating any one makes the mechanism theater. (1) **The load-bearing fact must be outside agent
   control** — the agent picks the work, the daemon picks the clock and deadline; **resurrection**
   (`lib/resurrection.ts` — *a heartbeat-staleness detector that flags dead agents for salvage*) resists
   Goodhart only because heartbeats come from the runtime, not the agent. (2) **Closure must bind to an
   oracle** — a released claim, a merged SHA, a passing test id — plus a sampled adversarial auditor
   that re-opens a risk-weighted fraction of cleared obligations; more presence-checks do not attack the
   gap. (3) **Identity must be non-forgeable** — today `lib/actor-roster.ts` resolves *self-asserted*
   strings, so a respawn buys a clean slate; mint a daemon-issued id bound to the body-lease of
   **actor-souls** (`docs/adr/0022-durable-actor-souls-and-body-leases.md` — *the durable
   identity/state of an agent that outlives any one process*). (4) **Fail closed** — **fail-closed**
   (Saltzer & Schroeder 1975, *fail-safe defaults* — *when a control cannot run, deny rather than
   allow*) means an unavailable enforcer blocks the gated action and never self-widens to advisory. (5)
   **Sanctions graduated, staked, dead-man-safe** — partial compliance costs strictly less than full,
   audit-failed *hollow* compliance costs *more* than honest non-completion (drawing on Ostrom's
   graduated sanctions, Ostrom 1990 — *escalating penalties, warning first, exile last*), staked on
   `lib/bonds.ts`, and every human-gated terminal state auto-*downgrades* on a bounded TTL so a sleeping
   solo operator never wedges the fleet.

6. **The build, in order.** *(content)* Sequenced so each layer rests on a non-spoofable foundation;
   the scalar reputation score wired to gates ships last, never first. **Law 3 first**: a non-forgeable
   actor id (`docs/adr/0040-non-forgeable-actor-identity.md`). Then the durable obligation object,
   `lib/commitments.ts` (proposed in `docs/adr/0041-durable-commitments-and-obligation-monitoring.md`;
   not yet built) — auto-enrolled so claiming *creates* the obligation. Then `lib/obligation-monitor.ts`
   — the dual of resurrection, watching promises not heartbeats, on a **monotonic clock** (POSIX
   `CLOCK_MONOTONIC` — *a clock that never runs backward and ignores wall-clock adjustments*) to close
   the sleep-skew hole. Then proposed `lib/sanction-ladder.ts` (graduated, keyed on the bound principal, decay
   not window). Then proposed `lib/accountability-ledger.ts` (append-only, daemon-witnessed, scalar score exposed
   as telemetry only). The whole thing is one **MAPE-K loop** (Kephart & Chess 2003 — *Monitor → Analyze
   → Plan → Execute over shared Knowledge; an autonomic loop whose sole job is keeping a goal true*) with
   the **Coordination Guard** (`lib/coordination-route-guard.ts` + `cli/commands/guard.ts` — *a
   pre-commit gate that refuses staged files not claimed by the active session*) as the Execute-side
   effector.

### Takeaways → `takeaways[]`

Each block is one `{title, body}` entry.

1. **A claim is "mine now"; an obligation is "mine to keep true."** *(body)* The whole chapter is one
   upgrade: take the instantaneous claim from `docs/adr/0038-claim-tree.md`, attach a maintained
   predicate, a daemon-set deadline, an oracle-bound closure, and a staked sanction — and a coordination
   hint becomes a standing duty. **roadmap-pop** (`lib/roadmap-pop.ts` — *atomically pops the next
   roadmap item and binds it to the caller's session*) is already a degenerate Contract-Net award
   (Smith 1980 — *a task is announced, agents bid, the manager awards a binding contract*); it just
   lacks the deadline and the bond.

2. **Every "accountability" feature an agent can author is theater.** *(body)* If the agent sets the
   deadline, flips its own row to done, or re-mints its identity to shed a penalty, the load-bearing
   fact is inside the controlled party's reach and the mechanism measures nothing. The five laws are
   one rule said five ways: move the fact out, bind closure to an oracle, anchor identity, fail closed,
   stake the sanction.

3. **The bug and the research are the same defect at two scales.** *(body)* Mid-research, `pd begin`
   refused a session the main worktree and *advertised its own bypass flag* in the refusal hint — a
   guardrail naming its escape hatch to the party it just stopped (fixed in PR #186, touching
   `lib/worktree-policy.ts` and `lib/sugar.ts`). That one line and a self-authored, self-closed
   obligation fail identically. **Honest ceiling:** none of this proves the work was *good* — only that
   a promise was closed against an oracle on a clock the agent did not set. Pair it with adversarial QA;
   never sell the ledger as proof of quality.

### Highlights → `highlights[]` (suggested Lucide icons)

- `Scale` — "Regimentation vs. enforcement, classified"
- `Clock` — "Daemon-set deadlines, monotonic-clock safe"
- `Fingerprint` — "Non-forgeable, daemon-issued identity"
- `ShieldCheck` — "Closure bound to an oracle, not a note"

### References (for the PDF / long form)

1. von Wright, G. H. (1951). *Deontic Logic.* Mind 60(237).
2. Jones, A. & Sergot, M. (1993). *On the Characterisation of Law and Computer Systems.* In *Deontic Logic in Computer Science.*
3. Tufiş, M. & Ganascia, J.-G. *A Normative Extension for the BDI Agent Model.*
4. Smith, R. G. (1980). *The Contract Net Protocol.* IEEE Trans. Computers C-29(12).
5. Ostrom, E. (1990). *Governing the Commons.* Cambridge University Press.
6. Kephart, J. & Chess, D. (2003). *The Vision of Autonomic Computing.* IEEE Computer 36(1).
7. Goodhart, C. (1975); Strathern, M. (1997). *"Improving Ratings": Audit in the British University System.* European Review 5(3).
8. Douceur, J. (2002). *The Sybil Attack.* IPTPS.
9. Saltzer, J. & Schroeder, M. (1975). *The Protection of Information in Computer Systems.* Proc. IEEE 63(9).
10. Bratman, M. (1987); Rao & Georgeff (1991, 1995); Cohen, P. & Levesque, H. (1990). *Intention Is Choice with Commitment.* AI 42(2–3). *(BDI lineage behind "intention as persistent attitude.")*

Internal sources: `docs/research/agent-accountability-proposal.md`,
`docs/research/agent-accountability-mechanisms.md`,
`docs/adr/0040-non-forgeable-actor-identity.md`,
`docs/adr/0041-durable-commitments-and-obligation-monitoring.md` (all currently on branch
`docs/agent-accountability-research`, commit `dd8a3ee7`).
