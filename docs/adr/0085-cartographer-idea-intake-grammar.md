# 0085. Cartographer Idea Intake — a conversational grammar that consults, orders, and auto-files

- Status: Proposed
- Date: 2026-06-18
- Deciders: Operator (Erich), Cartographer (navigator actor, ADR-0023)
- Related: ADR-0023 (navigator/cartographer actor), ADR-0031 (Spider), ADR-0032 (unSpider),
  ADR-0033 (roadmap_items DB-of-record), ADR-0039 (suggestibility layer), ADR-0041
  (durable commitments), ADR-0043 (ADR↔roadmap implementation matrix), ADR-0055 (parley)

## Context

You can already drop a piece of feedback (`pd feedback drop`), promote it into the roadmap
(`pd roadmap promote`), and the Cartographer owns the durable `roadmap_items` table
(ADR-0033). What you *cannot* do is **slide a raw idea in and have one responsible agent
consult everything that matters, ask the few questions that resolve placement, and slot the
work into the roadmap in a sensible order** — without you doing the cross-referencing by hand.

The pieces to do this exist as isolated primitives:

- `roadmap_items` (durable, `lib/roadmap-items.ts`) — the place work lands.
- The local embedder (`embed(texts) → number[][]`, `lib/semantic-resolver.ts` +
  `lib/shipwright/skill-index.ts`) and `cosineSimilarity()` — semantic relatedness, **not**
  keyword matching.
- `lib/adr-matrix.ts` — ADR text → roadmap slugs, so we know which ADRs already cover a topic.
- `detectClaimOverlaps` / `detectSymbolOverlaps` (`lib/suggestion-broker.ts`,
  `lib/surface-overlap.ts`) + the roadmap-claims ledger — who is in-flight on what.
- The suggestion/nudge rail (ADR-0039) + `inbox:actor:user` + `pd attention` — how a human
  gets pulled in.

What is missing is the **grammar that composes them**: a small, conversational vocabulary the
Cartographer (and any agent, and the GPUI tool) speaks to file an idea well. This ADR defines
that grammar and the disposition model behind it. Spider (ADR-0031) and unSpider (ADR-0032)
are not replaced — they become *producers* for and *guards* on this same intake seam.

## Decision

Add a **four-verb intake grammar**, owned by the Cartographer, mirrored across CLI + MCP +
HTTP route + SDK (parity rule), composing the primitives above. Three verbs file an idea; one
steers an agent toward work.

```
idea_intake { text, harbor?, by? }
  → ConsultationReport {
      draftId
      relatedRoadmap[]    // semantic cosine match over roadmap_items (embedder, not keywords)
      coveringAdrs[]       // ADRs whose phase-slugs appear in relatedRoadmap (via adr-matrix)
      inFlightClashes[]    // relatedRoadmap items currently held in the roadmap-claims ledger
      duplicateOf?         // an existing item above the dedup threshold → merge, don't double-file
      suggestedPlacement   // { status, dependsOn[], after[], before[] }
      disposition          // 'auto-commit' | 'escalate'  (see Disposition model)
      escalationReasons[]  // why a human is being pulled in, when disposition='escalate'
      clarifyingQuestions[]// the few follow-ups that would resolve an ambiguous placement
    }

idea_answer  { draftId, answers[] }   → a refined ConsultationReport (re-runs the consult)

idea_commit  { draftId, status?, dependsOn?, supersedes?, adrLink? }
  → upserts roadmap_items (single-writer: only the Cartographer commits), links the ADR,
    emits the roadmap:upserted tuple. Most commits are automatic (see below); this verb is
    the explicit path for the escalated / operator-driven ones.

work_next    { identity, harbor }
  → the highest-value unclaimed roadmap item whose surface does not clash with the asking
    agent's identity/holdings, with a one-line rationale. The "let Port Daddy steer them" verb.
```

### Disposition model — auto-commit is the norm, HiTL is for the non-mundane

The operator directive is explicit: **mundane ideas just slot on; auto-committing is the
default.** The Cartographer raises a human only when something is genuinely not mundane. The
decision is a pure function of the ConsultationReport:

`disposition = 'escalate'` iff **any** of:

1. **Duplicate** — `duplicateOf` is set (filing would double-count or should merge).
2. **In-flight clash** — `inFlightClashes` is non-empty (someone is actively working a related,
   claimed surface; warn before adding parallel work — this is the "unspider" warning at intake).
3. **High-impact placement** — suggested `status: 'now'`, or it would `supersede` an existing
   item, or reorder existing `now` work.
4. **Low confidence** — top semantic match is below the review threshold *and* no clear
   placement was inferred (the "I'm not sure where this goes" case).

Otherwise `disposition = 'auto-commit'` and the idea is filed immediately at its suggested
status (default `backlog`), no human in the loop.

Escalation is **delivery-mode adaptive**:

- **Operator present** (an interactive session / the GPUI tool is focused) → ask in the moment
  (a HiTL prompt).
- **Operator away** → durable suggestion on the `inbox:actor:user` rail (ADR-0039), surfaced by
  `pd attention`, and — required, not optional — rendered as a **big, glanceable, ADHD-friendly
  HiTL control** in pd-console (GPUI) and FleetBar: one card per pending decision, a primary
  "file it as suggested" action and a secondary "open / adjust", never a wall of text.

This keeps the human out of the 90% mundane path and reserves attention for the decisions that
actually fork the roadmap.

### Single-writer invariant

Only the Cartographer writes `roadmap_items` (ADR-0023 + ADR-0033). `idea_intake` / `idea_answer`
are read-mostly (they create an `idea_draft`, never a roadmap row). `idea_commit` is the sole
mutating verb and is the Cartographer's hand even when an agent or the UI triggered it.

### Pure core, injected IO

Following the house pattern (`surface-overlap.ts`, `adr-matrix.ts`, `suggestion-broker.ts`):
the consult assembly and the disposition decision are a **pure, dependency-injected core**
(`lib/idea-intake.ts`) — no DB, no network, no model call inside the matching logic. The
embedder, the roadmap list, the active-claims set, and the ADR phase index are all injected, so
the contract (idea + substrate → report + disposition) is exhaustively unit-testable without a
daemon. The IO orchestrator (fetch roadmap, run the embedder, read claims, persist the draft,
deliver escalations) is a thin separate layer.

## Consequences

- One coherent front door replaces hand cross-referencing; ideas land ordered, deduped, and
  clash-aware.
- Spider (ADR-0031) becomes "auto-drafts `idea_intake` calls from activity"; unSpider (ADR-0032)
  becomes "feeds `inFlightClashes` and escalates breaches" — both plug into this seam instead of
  being parallel machinery.
- The GPUI tool and FleetBar get a real, first-class job: render the escalation queue as big
  HiTL cards and let the operator drive intake / reorder hands-free-ish.
- Risk: semantic relatedness quality gates the whole thing. Mitigated by reusing the existing
  embedder (already tuned, ADR-0059 cache in front of it) and keeping thresholds in one place.
- Risk: auto-commit could file noise. Mitigated by the four escalation triggers above and by
  unSpider/`pd roadmap audit` catching mistakes after the fact.

## Implementation Matrix

| Phase | Slug | Status | Depends-on | Description |
|-------|------|--------|------------|-------------|
| 1a | idea-intake-consult-core | now | — | Pure consult + disposition core in `lib/idea-intake.ts` (DI embedder, cosine relatedness, dedup, clash read, ADR coverage, disposition decision) + unit tests. |
| 1b | idea-intake-draft-store | now | idea-intake-consult-core | `idea_drafts` table + migration; draft create/get/list; portable positional-`?` binding (bun:sqlite-safe). |
| 1c | idea-intake-io-orchestrator | now | idea-intake-consult-core, idea-intake-draft-store | IO layer: fetch roadmap + claims, run embedder, persist draft, decide, auto-commit or escalate via the ADR-0039 rail. |
| 1d | idea-intake-grammar-surfaces | now | idea-intake-io-orchestrator | `idea_intake` / `idea_answer` / `idea_commit` / `work_next` across HTTP route + CLI (`pd idea …`) + MCP tools + SDK, with parity. |
| 2 | idea-intake-unspider-clash | backlog | idea-intake-grammar-surfaces | Build the unSpider detectors (ADR-0032) that populate `inFlightClashes` for real and escalate breaches. |
| 3 | idea-intake-spider-feed | backlog | idea-intake-grammar-surfaces | Build Spider (ADR-0031) so surfaced patterns auto-draft `idea_intake` calls into the queue. |
| 4 | idea-intake-ui-hitl-controls | backlog | idea-intake-grammar-surfaces | pd-console (GPUI) + FleetBar: big ADHD-friendly HiTL escalation cards, intake box, and roadmap reorder; fix the 3 missing daemon routes blocking live control. |
