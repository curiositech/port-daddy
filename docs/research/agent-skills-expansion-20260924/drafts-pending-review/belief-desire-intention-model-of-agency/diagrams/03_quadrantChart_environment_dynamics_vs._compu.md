# Environment Dynamics vs. Computational Cost: Reconsideration Strategy Selection

```mermaid
flowchart TD
    Context[Declared environment trace and computation budget] --> Compare[Compare commitment candidates]
    Compare --> Blind[Blind: reconsider achievement]
    Compare --> Single[Single-minded: reconsider impossibility]
    Compare --> Open[Open-minded: reconsider desirability]
    Blind --> Measure[Measure completion, missed opportunities, and deliberation cost]
    Single --> Measure
    Open --> Measure
    Measure --> Policy[Choose a local policy and review date]
```
