# Diagram 1: Resolution signal investigation

Require completion evidence and an invalidation policy before recording a signal. Pin both the read helper and the consumer. Workload tests include unresolved, partial, falsely completed, reopened and urgent tasks; measure missed useful work alongside duplicate revisits.

```mermaid
flowchart TD
 A{Evidence and reopen policy defined?} -->|No| B[Define them; keep signal advisory]
 A -->|Yes| C[Record event; pin helper and consumer]
 C --> D{Consumer applies attenuation?}
 D -->|No or unknown| E[No routing claim]
 D -->|Yes| F[Test arithmetic and workload effects]
 F --> G{Local acceptance criteria met?}
 G -->|No| H[Revise or remove policy]
 G -->|Yes| I[Propose scoped policy with reset path]
```
