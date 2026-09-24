# Resource-bounded cycle: measure rather than infer a bottleneck

```mermaid
sequenceDiagram
    participant C as Interpreter
    participant Q as Event queue
    participant P as Plan selection
    participant A as Attitude state
    participant E as Environment
    C->>Q: read queued events
    Q-->>C: events under local queue policy
    C->>P: generate options and deliberate
    P-->>C: selected subset, possibly empty
    C->>A: update intention stacks
    A-->>C: enabled atomic action, if any
    opt an atomic action is enabled
        C->>E: execute enabled action
    end
    Note over C,Q: Queue internal events as they occur.<br/>No fixed extra stage is implied.
    E-->>C: external observations accumulated during cycle
    C->>Q: append collected external events
    C->>A: drop successful and impossible attitudes
    Note over C,E: Measure queue delay, matching, selection, updates,<br/>execution and observation lag separately.
```

The event queue stores events; it does not decide which attitudes to drop. The interpreter updates attitude state, and external observations come from the environment, including changes unrelated to the agent's action. The abstract loop in [Rao–Georgeff 1995, p. 317](https://cdn.aaai.org/ICMAS/1995/ICMAS95-042.pdf) is the source for ordering. Instrumentation and component boundaries are constructed. The paper gives no universal duration or measured bottleneck for this fixture.
