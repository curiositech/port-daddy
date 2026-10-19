# Cascading Approximation: Speed vs. Accuracy Trade-offs

```mermaid
quadrantChart
%%{init: {"themeVariables": {"quadrantPointFill": "#345995"}}}%%
    title Cascading Approximation: Speed vs. Accuracy Trade-offs
    x-axis Fast --> Slow
    y-axis Noisy --> Precise
    
    quadrant-1 High Speed, High Accuracy
    quadrant-2 Low Speed, High Accuracy
    quadrant-3 Low Speed, Low Accuracy
    quadrant-4 High Speed, Low Accuracy
    
    Policy Network: [0.25, 0.85]
    Value Network: [0.45, 0.75]
    Fast Rollouts: [0.8, 0.35]
```
