# P03 — Evidence classes constrain different claims

```mermaid
flowchart TD
  Syntax[Syntax: grammar shape only] --> Scope[Combine only the evidence needed for the stated claim]
  Tests[Local tests: named cases only] --> Scope
  Model[Finite model: stated bounds and assumptions] --> Scope
  Runtime[Runtime observation: observed runs only] --> Scope
  Mediation[Pre-effect mediation: covered routes only] --> Scope
  Effect[Effect truth: independent target evidence] --> Scope
  Scope --> Limits[Record missing evidence and limits separately]
```

These are complementary evidence classes, not prerequisite rungs. The skill's separate claim ladder is a local audit protocol whose cumulative requirements are explicitly declared.
