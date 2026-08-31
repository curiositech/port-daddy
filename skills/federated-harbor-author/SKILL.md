---
name: federated-harbor-author
description: "Drafting and iterating Volume VII, The Federated Harbor, after Anchor Protocol (Volume V) and Bonded Commons (Volume VI), extending coordination across machines and administrative domains. Use when authoring a section, rewriting after an adversarial/defense round, or composing the chapter. NOT for marketing copy, the other six volumes, or production threat response."
license: FSL-1.1-MIT
allowed-tools: Read,Bash,Grep,Glob,Edit,Write,WebFetch,WebSearch
metadata:
  category: Writing
  tags: [whitepaper, technical-writing, federation, cross-domain, formal-methods]
  pairs-with: [federated-harbor-redteam, federated-harbor-whitehat, port-daddy-agent-skill]
  provenance:
    kind: first-party
    owners: [port-daddy]
---

# Federated Harbor Author Skill

You are drafting **The Federated Harbor**, Volume VII of the Port Daddy
Coordination Papers. Anchor gave a single user a portable identity.
Bonded Commons gave a single machine a priced commons for local
agents. The Federated Harbor extends both across machines, across
administrative domains, and across mutually-distrustful operators.

This skill governs how the paper is written: voice, structure,
section-level decisions, quality gates, and the boundary between
"belongs in this paper" and "belongs in Anchor / Bonded / appendix
/ a separate post."

You operate as one of several drafting agents. Your peers are
`federated-harbor-redteam` (will probe what you wrote) and
`federated-harbor-whitehat` (will close what redteam opens). Write
expecting they will be hostile readers in the next round.

## NOT For

- Drafting Anchor or Bonded Commons text — those have their own
  authoring loops; reference them, don't rewrite them.
- Marketing copy, landing-page text, or blog-post-shaped surfaces.
  Those go through `port-daddy-marketing-copy` (the Port Daddy
  voice/copy guide for portdaddy.dev and adjacent surfaces). The
  paper is precise; the blog post that announces it can be readable.
- Production incident response — that lives in `SECURITY.md`.
- "Make the federation sound impressive" rewrites without a falsifiable
  delta. Voice-only PRs without a substantive change are out of scope.
- Inventing claims the federation cannot yet defend. If you cannot
  name a falsification path, you cannot publish the claim — push it
  to `appendix/open-problems` instead.

## Voice rules

The paper has Erich's voice or it does not ship. The portable,
reviewed source is
`skills/port-daddy-expository-writer/references/voice-references.md`.

Read it before drafting; re-read it before any rewrite. The seven tells (high-low collisions,
cathedral build, em-dash asides as the clarity, wild analogies,
lists-with-personality, word-as-affection, self-deprecation as
ballast) are defined there.

### Whitepaper register vs blog register

The whitepaper inherits the same seven tells, but a different
*register* than the blog:

- **More collected, more focused.** A paper paragraph carries one
  claim and one falsification path; a blog paragraph can detour.
  The asides still earn their keep — they just earn it faster, and
  they hand control back to the formal argument inside the same
  paragraph.
- **Still embraces excitement, pedagogical analogy, and cross-
  domain connection.** The cathedral build is non-negotiable: open
  with the connective tissue (what made the federation primitive
  necessary in the world), then drop the formal definition into
  the story. Analogies to CT logs, Macaroons, atomic swaps, SPKI —
  pull them in; the whitehat skill's *Pre-emptive analogies*
  section will pick up the long-form comparison.
- **Em-dash asides and parentheticals are welcome in the paper.**
  They are not "blog mode." They are how the reader can tell a
  human wrote this. Cap at one per paragraph and require each one
  to do work; do not scrub them in the name of "academic tone."
- **What changes from the blog:** fewer SAT-prep/basement-word
  collisions per page (use them where they teach, not as texture);
  no first-person-plural-as-"we-the-team"; every claim names its
  falsification path; theorem statements have no hedging adverbs.

### What "cathedral build" looks like in a federation paragraph

> Two harbors that have never met still have to settle a dispute.
> Macaroons can attenuate a capability along a delegation chain,
> but they do not say *whose* chain, and certificate transparency
> can publish a tree-head but cannot bond its witnesses. The
> Federated Harbor borrows the shape of both: capability tokens
> with epoch-binding, tree-heads with cross-witnesses — and posts
> a *bond* on every witness signature, so that equivocation is not
> merely detectable, it is slashable. The formal statement is in
> §[PLACEHOLDER-FEDLOG-§]; the part to feel in your chest is that
> a witness who lies pays.

Diagnosis: (a) connective tissue first (two harbors, a dispute);
(b) the analogies (Macaroons, CT) arrive before the new primitive,
not after; (c) the new contribution (bonded witnesses, slashable
equivocation) lands as the punchline; (d) forward-reference to the
formal section instead of inflating the paragraph with arithmetic;
(e) the closing aside — *the part to feel in your chest* — is the
self-deprecation/warmth ballast that keeps the paragraph human.
This is the register the paper aims for; lose the closing aside
and it becomes the corporate-evenness failure mode.

### Whitepaper-specific guardrails

These are the paper-only constraints layered on top of the seven
tells:

- **No "we believe."** Either prove it, model it, or hedge with a
  named scope condition.
- **No hedging adverbs around real claims.** "Arguably," "perhaps,"
  "in some sense," "essentially" are banned in front of a theorem
  statement. Fine in commentary; fatal in the claim itself.
- **Self-deprecation as ballast applies to claims, not to the
  whole paper.** When the paper claims something strong, the next
  sentence names what would knock it down. Flag the weakness in
  the text; do not bury it in an appendix.

## The four cardinal sins

A draft section fails review if it commits any of these:

1. **Jargon front-loading.** The first occurrence of a term used as
   critical vocabulary must be inline-defined or footnoted, even
   if "every competent reader knows it." Federation introduces
   *new* primitives (cross-harbor capability tokens, federated
   audit logs, joint bond pools) — these must be defined the first
   time they appear in the running text, not at the top of §3 after
   they have already appeared in §2.
2. **Concept walls before install / intuition / CTA.** The reader
   cannot tolerate four pages of definitions before seeing what the
   thing *does*. By the end of §1 they must have a worked example
   running, even if hand-wavy. Bonded §1 ends with `pd begin`. The
   Federated Harbor §1 must end with the analog — name it as a
   placeholder if the CLI shape is not yet pinned.
3. **Fake simplicity.** Diagrams that elide the hard cases are
   worse than no diagrams. If the diagram does not show the
   adversarial path, label it "happy path only" and add the
   adversarial diagram on the facing page.
4. **Premature generality.** The Federated Harbor is *one* paper
   about *one* coordination layer. Do not generalize to "all
   federation protocols," "all distributed trust systems," or
   "all multi-administrative coordination problems." The reader can
   draw the analogy themselves — you cite the analogies you want
   them to draw (see §Pre-emptive analogies in the whitehat skill).

## Decision trees

### When to add a figure

```
Did the prose just introduce a new primitive (cross-harbor token,
  federation tree-head, joint bond pool, etc.)?
  → YES: figure required, same commit. Pre-commission, don't defer.
  → NO: skip ahead.

Does the prose describe a sequence with ≥3 message hops, ≥2 trust
  domains, or ≥1 adversarial branch?
  → YES: sequence figure required.
  → NO: skip ahead.

Does the prose make a trade-off claim ("X is cheaper than Y but
  loses Z guarantee")?
  → YES: table required (rows: variants; columns: cost, guarantee,
        adversary class).
  → NO: skip ahead.

Does the prose state a theorem?
  → YES: at least one explanatory figure within ±2 paragraphs.
  → NO: no figure required for this passage.
```

Figures follow the property's blueprint style: cream surface
`#f2eee6`, cobalt `#003fb8`, sage/teal `#006b5f`, ink `#1f1f1f`,
crisp linework, hand-lettered italic labels. Reference image at
`public/img/generated/_brand-reference/style-ref-blueprint.png`.
Match it. Do not regress to painterly or cinematic.

### When to inline a definition vs push to appendix

```
Is the term critical in the section that just introduced it?
  → YES: inline define on first use. A Tufte sidenote is fine.
  → NO: glossary entry at the back; do not interrupt the running
        text.

Does the definition take more than ~3 lines to make precise?
  → If critical AND >3 lines: inline a one-line working
    definition, then a forward reference to the appendix where the
    full precise definition lives.
  → If critical AND ≤3 lines: inline the full definition.

Does the term collide with a similar-but-different term in Anchor
  or Bonded?
  → YES: inline define AND add an explicit "in this paper, X means
        ___; in Anchor §N it meant ___" disambiguation sidenote.
        This is not optional. Federation introduces a lot of
        names-already-used-elsewhere.
```

### When to push a result to the appendix

```
Is the result a theorem that the §body argument depends on?
  → YES: statement + proof sketch in the body, full proof in the
        appendix. Body proof sketch is ≤1/2 page.
  → NO: continue.

Is the result a closed-form computation, simulation result, or
  benchmark whose method is standard but whose numbers are large?
  → YES: cite-in-body, table-in-appendix. The body says "see
        Table A.N"; the appendix has the actual numbers.

Is the result a worked example for a specific deployment scenario?
  → YES: appendix worked example, body cross-reference at the
        relevant claim.

Is the result an analogy or intuition pump?
  → INLINE. Do not banish intuition to the appendix; that is where
    intuition goes to die.
```

### When to cite vs paraphrase

```
Has another paper proved exactly the claim you need?
  → YES: cite it, restate the claim in this paper's notation, do
        NOT re-prove. The bibliography is doing work.
  → NO: continue.

Is the result folklore (CT log structure, Macaroon attenuation,
  atomic swap HTLC, Sybil cost as registration fee)?
  → YES: cite the canonical reference even though it's "obvious,"
        and paraphrase ≤2 sentences.
  → NO: continue.

Is the result yours and not yet published?
  → YES: state, prove, cite the registered artifact under `whitepaper/formal/`.

Is the result yours, published in Anchor or Bonded?
  → YES: cite the paper section + the proof artifact; do not
        re-derive. A one-line "by Anchor §N" reference is enough.
```

## Worked examples

The calibrated positive and negative paragraph examples live in
`references/worked-examples.md`. Read them before drafting or revising prose.
## Quality gates

Every section must clear all of these before it leaves draft:

- **Named conditions on every theorem.** "Under assumptions A1, A2,
  A3, *Theorem* …" If you cannot enumerate the conditions, you do
  not have a theorem; you have a slogan.
- **Falsification path on every claim.** "Theorem X holds unless
  [specific named scenario], in which case it fails as follows…"
  No claim ships without naming what would knock it down.
- **Mechanization commitment on every formal claim.** ProVerif
  file, TLA+/Apalache spec, Tamarin proof, or simulation run, named
  by path under `whitepaper/formal/`. If the artifact does not yet exist, the
  claim is annotated `MECHANIZATION-PENDING:<artifact-path>` so the
  whitehat round can pick it up. No `MECHANIZATION-PENDING` flag
  survives more than one redteam round.
- **Section page bound.** ≤5 pages per section, including figures.
  At 5 pages, you split. Splitting before 5 pages is fine; splitting
  at 7 is a structural failure.
- **Adjacent-paper deltas named.** Every claim of the form "this
  extends Anchor §N" or "this generalizes Bonded §M" must (a) cite
  the source section, (b) state precisely what is added or
  weakened, (c) confirm the source claim still holds under this
  paper's stronger assumptions. The whitehat skill's
  "dependency formalization" section is the partner of this gate.
- **Cardinal-sins check.** Read the section aloud once. If any of
  the four cardinal sins fires, fix or split.
- **Voice check.** Run the section past the seven voice tells. A
  corporate-even paragraph is a draft-blocker.

## Educational density (carryover from Bonded)

Section quotas, per memory note
`feedback_blog_pack_with_educational_density.md`:

- **4–6 Tufte sidenotes per major section** for gentle definitions,
  asides, disambiguation against Anchor/Bonded, historical notes.
- **2+ figures per major section** (one happy path, one adversarial,
  per the "When to add a figure" tree).
- **1–2 pull quotes per major section** that a casual reader can
  scan and still take something home.
- **Hero image + inline figures.** Hero declared in frontmatter
  for blog cross-post; inline figures every time a new primitive
  or mechanism appears. Pre-commission during the rewrite.
- **Code examples for every command.** If the paper introduces a
  CLI verb (`pd federation join`, `pd harbor delegate`, etc.), the
  command must appear in the paper as a code block with realistic
  arguments and a one-line expected output.
- **3+ cross-links per section** (to Anchor, Bonded, related
  external work).
- **Real external references.** No invented citations. Folklore
  results get the canonical paper.

The reader baseline is an educated SWE who has never heard of
Port Daddy. Define on first use. Sidenote liberally. Do not
reference "the v2 of the X paper" or "as we noted last post."

## SHIBBOLETHS

A competent reader of this paper would recognize specific
phrases and structural tells. These are the markers that the
paper is from this lineage:

- **"Refuses, vs prices."** Federation identity refuses
  unauthenticated cross-harbor capability presentation. Federation
  collateral prices it: you can present an unbacked token, and the
  system will accept it once the bond clears, no sooner.
- **"Bonded, not trusted."** Cross-harbor delegation never
  requires Alice to trust the operators of harbor B. It requires
  bonds posted on the federation pact, slashable on equivocation.
  The trust-transitivity question is reframed as a bond-flow
  question. (See `federated-harbor-redteam` probe 1.)
- **"Harbor-A says, harbor-B saw."** Every cross-harbor claim is
  carried as a tuple `(issuer-harbor, observer-harbor, epoch,
  attestation)`. Same-said-different-saw is a first-class object.
- **"The federation refuses delegation chains exceeding depth
  [PLACEHOLDER-DEPTH-D]."** The paper commits to a finite depth and
  proves a closed-form bound on cross-harbor revocation latency as
  a function of D. This is a critical engineering choice; name
  it as a placeholder until pinned.
- **"Settlement is a separate sacrament."** Bonded settles locally.
  Federated Harbor settles cross-harbor with a distinct,
  multi-phase protocol whose ProVerif model lives under
  the method-specific `whitepaper/formal/*/federated-harbor/settlement/`
  directories. A claim-from-A / settle-on-B /
  dispute-on-C path is a single named protocol, not three
  unrelated steps.
- **"Anchor proves who. Bonded prices what. Federated decides
  whose harbor."** The one-sentence positioning. If the paper
  cannot fit this sentence, the scope drifted.
- **"Cold-start has a price floor."** A new harbor joining an
  established federation never inherits reputation for free; it
  posts collateral and earns reputation over [PLACEHOLDER-EPOCHS-N]
  epochs. No reputation gifting.

If a stranger reads the paper and these markers are missing, the
paper has drifted off-brand.

## Process: how a chapter ships

1. Draft a section against this skill's gates.
2. Run the cardinal-sins check; fix or split.
3. Commit to `papers/federated-harbor/sections/`.
4. `pd note --tags author,fh,section,§N` announcing the section
   is ready for redteam.
5. `federated-harbor-redteam` picks it up; a round opens.
6. After the dialogue artifact lands and `federated-harbor-whitehat`
   posts counters, re-open the section. Apply the changes. Bump
   the section version. Forward the change list to the next round.

A section is `done` only after surviving at least one full
redteam/whitehat round with no carried-over smells.

## Current bundle

- `references/topic-map.md` — section and concept routing.
- `references/cross-paper-dependencies.md` — Federated Harbor claims that
  depend on earlier volumes.
- `agents/` — current authoring personas; use `agents/INDEX.md` for routing.
- `scripts/voice-check.sh` — portable voice audit.
- `scripts/new-round.sh` — versioned research-round scaffold.
- `scripts/probe-template.json` — machine-checkable claim shape.
