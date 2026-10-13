# Two-Phase Planning Architecture: outline then content

This is a proposed operating procedure, not a transcription of HTP Algorithm 1. It makes explicit the review gates that an implementation must supply. The HTP source establishes an outline `O` followed by self-guided content `C`; it does not establish branch independence, a scheduler, or automatic acceptance.

```mermaid
flowchart TD
    I[Input problem q] --> A[Assess whether a rule applies]
    A -->|no applicable rule| L[Keep node as a leaf for content work]
    A -->|applicable rule| R[Instantiate a child-set rule]
    R --> V{Outline O meets local review criteria?}
    V -->|no| A
    V -->|yes| C[Self-guided content work C at leaves]
    L --> C
    C --> E[Record evidence and constraints]
    E --> Q{Integration checks pass?}
    Q -->|no| F[Revise the affected outline or leaf]
    F --> A
    Q -->|yes| P[Return completed plan P]
```

A rejection only identifies work for revision; it does not authorize an effect or prove an action succeeded.
