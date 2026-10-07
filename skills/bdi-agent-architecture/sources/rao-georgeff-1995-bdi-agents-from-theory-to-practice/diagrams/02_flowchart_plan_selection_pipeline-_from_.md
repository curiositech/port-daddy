# Plan selection: invocation then precondition

```mermaid
flowchart TD
    E[queued event] --> M[match invocation conditions]
    M --> C[candidate plans]
    C --> P[test preconditions against current beliefs]
    P --> S[applicable options; possibly empty]
    P -. rejected candidates and reasons .-> R[diagnostic record]
    S --> D[deliberate; select subset]
    D --> I[update intention stacks<br/>empty selection adds no plan]
    I --> A{Enabled action on any stack?}
    A -->|yes| X[execute next atomic action]
    A -->|no| Q[continue interpreter cycle]
    X --> Q
```

Invocation and precondition must both hold for a new plan to be an option ([Rao–Georgeff 1995, pp. 317–318](https://cdn.aaai.org/ICMAS/1995/ICMAS95-042.pdf)). The selected subset can be empty while an existing intention remains executable. The practical representation also posts subgoals as internal events; this figure isolates filtering and the action boundary rather than enumerating every plan-body transition. Diagnostic recording is a local instrumentation choice.
