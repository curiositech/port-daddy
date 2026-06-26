# Examples surface: friction & product-appeal analysis

**Surfaces analyzed:** `/examples` (catalogue) and `/examples/:slug` (detail).
**Date:** 2026-06-21. **Method:** `ux-friction-analyzer` + `product-appeal-analyzer`.
**Baseline:** post-#514 (catalogue grouped by theme; titles varied).

This is the written companion to the catalogue regroup. The regroup fixed the
*structure* problem (a flat 12-card wall); this pass asks the next two questions:
will an AI dev *want* these (appeal), and can they *act* without stumbling
(friction). It records scores, the concrete gaps, and what this PR changes vs.
what is deferred — so the deferred items are tracked, not silently dropped.

---

## Persona

**"Maya, the agent-runner evaluating Port Daddy."** Mid/senior dev who already
runs a coding agent in a repo terminal (Claude Code, Codex, Cursor). Lands on
`/examples` from the homepage or a link, skeptical, time-boxed (~3 min of
attention before deciding to bookmark, try, or bounce). Her real question is
*"is there something here I'd actually wire into my own setup this week?"* She
has lived the two-agents-one-file collision; she does not yet trust that a new
daemon earns its place.

---

## The 5-second test (`/examples`)

| Question | Answered? | Where |
|---|---|---|
| What is this? | ✅ clear | H1 "Small programs that hand work to your coding agent." |
| Who is it for? | ✅ clear | "you already have a coding agent running … Claude Code, Codex, Cursor" |
| Core promise? | ✅ clear | "posts a small message to the Port Daddy daemon … no hosted service, no extra account" |
| What do I do next? | ⚠️ partial | "Open PD Tube" is clear, but with 13 cards there's no *fast* path to "the one for me" |

**Verdict: 8/10.** Category, audience, and promise land in well under 3 seconds.
The only soft spot is next-action precision once the eye hits the catalogue.

---

## Desirability triangle

Scores are 1–10 per vertex; below 5 is a priority fix.

### Catalogue (`/examples`)

| Vertex | Score | Reasoning |
|---|---|---|
| **Identity fit** | 9 | Speaks the persona's language exactly — terminal agents by name, local-first, "no extra account." The coordination group now leads, which is *her* pain, not a generic feature tour. |
| **Problem urgency** | 6 | Examples read as "neat things you could build," not "the thing you need Tuesday." The lost-write collision (the manifesto's whole hook) is implied by the coordination group title but never *stated* on this page. |
| **Trust signals** | 6 | Strong on substance (full source, runnable commands, "nothing here is a snippet you finish yourself"), thin on proof (no repo link, no "run in CI," no usage/social proof). |

### Detail (`/examples/:slug`)

| Vertex | Score | Reasoning |
|---|---|---|
| **Identity fit** | 9 | "What this builds" + "Adapt it" speak to someone who will lift the code. |
| **Problem urgency** | 7 | `whyItMatters` carries the "why not just X" argument well (e.g. PD Tube: "does not integrate with Claude, OpenAI, MCP, or a hosted webhook"). |
| **Trust signals** | 8 | "Last checked <date>", full source inline, a terminal recording, explicit prerequisites + install CTA. Missing only a "view this file on GitHub" link. |

---

## Friction audit

| # | Friction | Type | Severity | Evidence |
|---|---|---|---|---|
| F1 | **`level` (Beginner/Intermediate/Advanced) is in the data but never rendered on catalogue cards.** A time-pressured dev can't scan for an entry point. | Recognition-over-recall failure | **High** | `examples.ts` carries `level` on every doc; `ExamplesPage.tsx` renders only `time`. |
| F2 | **Commands aren't copyable** (`copyable={false}` on the "Run it" blocks). The primary "try it" action forces retyping. | Micro-friction on the core action | Medium | `ExampleDetailPage.tsx` passes `copyable={false}`; command strings carry a leading `$ ` so naive copy would include the prompt. |
| F3 | **No filter/sort** across 13 examples (by level, tag, or "needs Port Daddy vs not"). | Overwhelm at scale | Medium | Catalogue renders all groups/cards unconditionally. |
| F4 | **No path from a card to the actual repo file.** Cards show `examples/swarm/coordination-board.ts` as static `<code>`, not a link. | Trust / dead-end | Medium | File paths render as `<code>`, GitHub link only in the footer. |
| F5 | **Card density** — each card stacks `summary` + `surveyPlain` + `builds` (three prose blocks) before the CTA. | Extraneous load when scanning | Low | `ExamplesPage.tsx` card body. |

## Objection map (Maya)

| Objection | Type | Currently addressed? | Gap |
|---|---|---|---|
| "Is this legit / maintained?" | Trust | Partial — "Last checked <date>" on detail | No repo link, no commit recency, no stars on-page |
| "Will it actually run?" | Skepticism | Yes — terminal recordings for all 13 | — |
| "Too much setup?" | Effort | Yes — honest prerequisites + install CTA | — |
| "Why not a cron job / hosted webhook?" | Value | Yes on detail (`whyItMatters`) | Not stated on the catalogue itself |
| "Which one is for me?" | Effort | Partial — themed groups (#514) | No level badge (F1), no filter (F3) |
| "Not for people like me" | Identity | Strongly handled | — |

---

## Prioritized recommendations

`Impact = (users affected × severity) / fix difficulty`

### Immediate (this PR)
- **Fix F1 — surface `level` on every catalogue card.** Pure win: existing data,
  one render change, directly serves the "which one is for me" objection and the
  5-second test's only soft spot. Implemented here by leading the card's
  "What you get" list with `<level> · <time> guided read` and adding the level to
  the detail-page meta line, so the signal is consistent across both surfaces.
- **Copy: state the pain on the catalogue, once.** Add a single problem-urgency
  line to the coordination group blurb so the lead group names the collision it
  prevents rather than only implying it. (Lifts catalogue Problem urgency 6→7.)

### Medium-term (follow-up PR)
- **F4 — link each example's files to the repo** (`github.com/.../examples/...`).
  Cheap trust + lets Maya read before she installs. Pairs with task #6 (OG/links).
- **F2 — copyable commands.** Needs a `copyText` distinct from the displayed
  `$ `-prefixed string (so the prompt isn't copied); small `DocsCodeBlock` change.
- **F3 — level/tag filter chips** on the catalogue once the set grows past ~15.

### Long-term
- **One social-proof / "run in CI before each release" element** if/when it's
  true end-to-end (today CI checks recordings exist and are clean, not that every
  command passes — do not claim more than that).
- **A "Start from your trigger" chooser** (button / test / webhook / file / port)
  that routes to the closest example.

---

## What this PR implements

1. F1 fix — `level` surfaced on catalogue cards and detail meta (recognition,
   scannability).
2. The one problem-urgency copy line on the lead (coordination) group.

Everything under Medium/Long-term is deferred with a tracked task, not dropped.
