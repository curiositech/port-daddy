# Tooling Choices for Small and Solo Moderation Teams

**Read when**: choosing (or re-evaluating) the admin/review UI a small or
solo team will use to work moderation queues, especially when there's no
budget or headcount for a bespoke trust & safety platform.

## The four realistic options

The moderation review UI is, mechanically, an internal CRUD/admin tool over a
few tables (reports, flagged_content, accounts, actions, audit_log). You do
not need a dedicated "trust & safety platform" product to start — you need a
fast way to look at a report, see context, and click an action. Four
approaches cover almost every small/solo team:

### 1. Directus — database-first admin layer

Directus introspects an **existing** Postgres/MySQL schema and generates a
full admin UI (data tables, kanban boards, dashboards, relational views) plus
row- and field-level permissions, without requiring a separate data model or
proprietary storage format.

- **Best fit**: you already have (or are willing to design) a relational
  schema for `reports`, `flagged_content`, `accounts`, `violation_history`,
  and `actions`. Directus reads that schema and gives you working CRUD +
  kanban + permission-scoped views same-day.
- **Cost model**: free at solo/small-company scale (the free tier is
  revenue-gated, not seat-gated — check current thresholds before assuming
  eligibility, they change).
- **Why it fits moderation specifically**: row/field-level permissions map
  directly onto the Tier 0 isolation requirement (see
  `references/queue-architecture.md`) — you can restrict the CSAM/imminent-harm
  table to a specific role without building custom auth.
- **Trade-off**: you own and evolve the schema yourself; Directus is a layer
  on top, not a replacement for schema design work.

### 2. Retool — fastest path to a polished custom tool

Retool gives you drag-and-drop components (tables, kanban, charts, file/image
viewers, forms) to assemble a custom internal app quickly, including
moderation-specific patterns like side-by-side content preview + one-click
action buttons.

- **Best fit**: rapid prototyping, or a company with budget that values
  reviewer time far more than the subscription cost.
- **The real trade-off — vendor lock-in**: the app *lives inside Retool's
  platform*. There is no "eject" to a standalone deployable app. If payment
  stops, the tool stops. For a cost-sensitive solo operator building a
  permanent core operational system, this is a material risk, not a minor
  inconvenience — your entire review workflow becomes hostage to a recurring
  bill with no owned artifact if you need to walk away.
- **Verdict**: fine for an early prototype or a well-funded team; risky as the
  *sole* review interface for a growing platform with no exit plan. If you
  choose Retool, have an explicit answer to "what do we do if we stop paying"
  before it becomes the only way to moderate your platform.

### 3. Refine — AI-assisted, but you own the code

Refine positions itself as generating a real, owned React/TypeScript admin
application (not a hosted proprietary format) that you can deploy anywhere —
a middle ground between Directus's introspection model (you bring the schema,
it generates the UI) and Retool's hosted-platform model (the platform owns the
app).

- **Best fit**: teams that want Retool-speed scaffolding but need the
  resulting app to be a portable codebase they can modify, self-host, and
  keep even if they stop using Refine's tooling/cloud services.
- **Trade-off**: still newer and less battle-tested than Directus or Retool
  for this specific use case; expect to write more custom code than with
  either alternative once you go past the generated scaffold.

### 4. Self-built (e.g., Next.js + shadcn/ui data table)

Full control over moderation-specific UX: custom severity-queue behavior
(auto-routing, forced deliberate-entry to the isolated queue), one-click
action buttons tailored to exact policy categories, and no dependency on a
third party's roadmap or pricing.

- **Best fit**: once the generic tools' UX friction is *measurably* costing
  more reviewer-hours than the build would take. Don't reach for this first —
  reach for it when you have data (see `references/metrics-and-audit.md` on
  time-per-report) showing the generic tool is the bottleneck.
- **Trade-off**: real build and maintenance time. This is the highest-control,
  highest-cost option; justify it with evidence, not preference.

## Decision guide

```
Do you already have a relational schema for reports/accounts/flags?
├─ Yes, and you want the fastest working UI  → Directus
├─ No schema yet, need something TODAY, budget is fine → Retool (with an exit plan)
├─ Want an owned, portable app generated fast → Refine
└─ Generic tools' friction is now costing more than a build would → Self-built
```

## Anti-pattern: choosing Retool as a permanent system without an exit plan

See the Anti-Patterns section in SKILL.md — "Vendor-Locked Core System." The
failure isn't using Retool; it's using it as the *permanent, sole* review
interface for a growing platform with no plan for what happens if the
subscription lapses or the platform needs to scale past what the no-code tool
comfortably supports.
