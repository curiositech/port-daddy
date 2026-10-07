# PRD Template (generate only after lock-in)

```markdown
# [Product Name] — PRD v1

## Summary
One paragraph: who this is for, what it does, why now.

## Goals & non-goals
- Goals: [from interview Q1]
- Explicit out-of-scope for v1: [from interview Q3 — carry these forward verbatim, don't silently drop them]

## Feature list
For each `locked` node in the graph, one entry:

### [Node label]
- **Type**: screen / feature / system
- **User story**: As a [user], I want to [action], so that [outcome].
- **Acceptance criteria**: [bulleted, testable]
- **Depends on**: [nodes this requires, from `depends-on` edges]
- **Navigates to / from**: [from `navigates-to` edges]

## Sitemap
[Embed the Mermaid diagram generated from the locked node-graph — see node-graph-schema.md]

## Design direction
- Brand adjectives: [from interview Q4]
- Light/dark: [from interview Q4]
- Existing brand assets to anchor to, if any: [from interview Q4]

## Technical constraints
[from interview Q5 — existing infra, scale expectations, compliance context]

## Open questions
[Anything the founder deferred during the interview — don't silently resolve these yourself]
```

## Rules for filling this in
- Only include nodes with `status: locked` — a `proposed` or `sketched` node in the PRD signals false confidence to whoever reads it next (a designer, an engineer, an investor).
- Copy user language from the interview transcript into user stories where possible — don't paraphrase into generic PM-speak that loses what the founder actually said they wanted.
- The out-of-scope section is not optional — it's what prevents "wait, I thought that was included" disputes later.
