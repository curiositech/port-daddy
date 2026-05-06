# Primitive Map Variant

Status: official Port Daddy website/design-system variant  
Scope: concept pages, product explainers, Mac preview proof surfaces, and runtime primitive diagrams  
Introduced: 2026-05-06

The Primitive Map variant is the official visual language for explaining Port Daddy runtime primitives.

Use it when a page needs to show how live coordination state works: sessions, claims, locks, channels, tuples, activity, salvage, Arbiter checks, budget gates, telemetry gates, FleetBar, Fleet Control Center, and Shipwright.

## Why This Variant Exists

Generic marketing cards make runtime coordination look like a list of features. Port Daddy needs a different treatment: the reader should be able to see ownership, evidence, authority, and recovery at a glance.

The page should feel like an operator instrument:

- structured;
- source-backed;
- compact but readable;
- typographic before decorative;
- explicit about current runtime truth.

## Layout Rules

- Use a strict grid with visible alignment between hero, fact map, topology cards, and source lists.
- Prefer bordered modules and thin rules over floating cards.
- Use square or nearly square corners. Do not use soft pill-card marketing chrome for primitive explanations.
- Keep one primary CTA per viewport. Secondary links belong in text, notes, or source rows.
- Use concise top navigation and avoid utility clutter around search.
- Use fact tables when the reader needs comparison or proof.
- Use source rows when a claim maps to code.

## Color Semantics

Use restrained semantic color, not decoration.

| Family | Meaning |
| --- | --- |
| Ink / black | primary action, active nav, committed authority |
| Blue | runtime state and live coordination |
| Green | evidence, successful verification, recovery proof |
| Amber | caution, preview status, pending gate |
| Red | conflict, failed invariant, stop condition |

Do not introduce a new accent family for a single page.

## Typography

- Headlines should be short, concrete, and grid-anchored.
- Eyebrows label the kind of evidence, not the mood of the section.
- Body copy should explain the operational fact in plain language.
- Code and command snippets must include output, observable state, or a next visible effect.

## Content Rules

Primitive Map pages must avoid architecture theater.

Required:

- name the primitive;
- name what it stores or enforces;
- name its lifetime;
- link to source or a runtime surface when possible;
- separate current runtime behavior from design target behavior.

Forbidden:

- vague claims like "AI orchestration layer" without a concrete primitive;
- generated-sounding summaries that flatten every mechanism into "governance";
- mystery download CTAs;
- diagrams that imply runtime support the product cannot actually execute.

## Canonical Use Cases

- `docs/concepts/primitives.md`
- `/docs/concepts/primitives`
- `/mac-preview`
- primitive-heavy launch pages
- runtime proof boards and review artifacts

## Implementation Notes

The current website implementation should compose this variant from the existing public primitives:

- `PageContainer`
- `SwissGrid`
- `SurfacePanel`
- `SectionIntro`
- `PanelEyebrow`
- `PanelTitle`
- `PanelBody`
- `PanelList`
- `DocsNoteCard`
- `DocsCodeBlock`

If a page needs a new primitive-map component, add it to the shared component layer first. Do not invent a one-off visual language inside a route file.
