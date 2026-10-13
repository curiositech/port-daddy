# Observation and knowledge state

```mermaid
stateDiagram-v2
  [*] --> Uncertain
  Uncertain --> Observed: vision relation includes event
  Observed --> Shared: public report under protocol
  Shared --> Uncertain: model changes or report unavailable
  Uncertain --> Uncertain: absence does not settle event
```
