# Content Strategy — June 2026

Goal hierarchy (from `.agents/product-marketing-context.md`): hiring appeal
first, practitioner adoption second, citable authority third. Every piece is
searchable, shareable, or both — and every piece must survive the
make_copy_and_media_human pass before it ships.

## The four pillars

### P1 — Running agent fleets on a subscription (the EM-bait pillar)
The story nobody else can tell with receipts: one $20–200/mo seat powers a
fleet that ships while the operator sleeps. Searchable ("run multiple claude
code agents", "claude max parallel agents") AND shareable (HN front page
shape). This pillar does double duty: practitioners want the how, hiring
managers want the who.

Existing spokes: your-ai-subscription-powers-the-fleet,
the-cli-is-for-the-robots, the-pr-that-reviews-itself.

### P2 — Multi-agent coordination engineering (the depth pillar)
The pain queries: agents clobbering files, lost work, silent collisions.
Awareness-stage searches ("multiple ai agents same repo", "ai coding agent
conflicts") with no good incumbent answer. Our posts already cover the
mechanisms (tube, guard, attention, salvage); the gap is the front-door
problem-statement post that ranks.

Existing spokes: pd-tube-multi-subscriber, coordination-guard-claims-into-policy,
attention-is-the-first-command, evidence-that-survives-machines.

### P3 — The papers (the authority pillar)
Legible Swarm + Single-Writer Kernel. Near-zero search volume, maximum
backlink and citation value — these earn the links that float everything
else. Need: linkable PDFs, a papers landing page worth forwarding, figures
reused across the site (the hero now runs Fig. 1 of SWK).

### P4 — One engineer, whole stack (the hiring pillar)
Meta content with receipts. Hub: the `/built-by` colophon (PR counts, test
counts, artifact list, each linked). Spokes: morning-diff case studies,
"what the fleet shipped this month" notes, honest postmortems. This pillar
converts to erichowens.com.

## Priority queue (scored: customer impact 40 / fit 30 / search 20 / cost 10)

| # | Piece | Pillar | Search/Share | Stage | Why now |
|---|-------|--------|--------------|-------|---------|
| 1 | `/built-by` colophon page | P4 | shareable | decision (hiring) | The funnel exists (footer link, 2026-06); this is its landing. The page an EM forwards. |
| 2 | "How I run twelve agents on one Claude Max subscription" | P1 | both | consideration | The HN headline. Numbers, costs, the wrapper, a real morning diff. Refreshes/absorbs the subscription post angle for search. |
| 3 | "What breaks when four agents share a repo" | P2 | searchable | awareness | The front-door pain post. Targets "multiple ai coding agents conflicts"-class queries; links to every P2 mechanism post. |
| 4 | Papers landing + PDFs | P3 | shareable | — | One afternoon of build; permanent backlink magnet. |
| 5 | "Claude Code vs Codex as fleet backends" | P1 | searchable | consideration | The "vs" query with real operational data nobody else has. |
| 6 | "The morning diff" (monthly, recurring) | P4 | shareable | — | What the fleet shipped overnight, with the PR links. Cheap, compounding, deeply hireable. |

## Distribution
- HN + lobste.rs for P1/P4 pieces (the subscription-economics angle is the
  proven click); r/ClaudeAI, r/LocalLLaMA for P1; X threads cut from posts.
- Cross-link discipline stays at 3+ internal links per post; every post's
  byline now links to erichowens.com (shipped, PR #376).
- Papers get submitted where systems people cite from.

## Measurement
- Hiring KPI: outbound clicks footer/byline → erichowens.com (add analytics
  event), inbound "work with me" contacts.
- Search: GSC queries per pillar; target top-5 on the #3 post's primary
  query within 2 quarters.
- Authority: backlinks to papers; HN front-page appearances.

## Refresh cycle
Comparisons (#5) every quarter; tutorials/mechanism posts every 6 months;
the colophon's numbers monthly (scriptable — counts come from gh + the
test suite).
