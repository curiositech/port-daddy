# Epistemic Graphics: Principles of Mike Bostock & Edward Tufte

## 1. Visual Channel Ranking by Perceptual Accuracy

Cleveland & McGill (1984) and Heer & Bostock (2010) empirically measured human perceptual error across visual encodings:

1. **Position along a common scale** (Highest accuracy, lowest variance)
2. **Position along non-aligned scales**
3. **Length / Direction / Angle**
4. **Area** (Subject to systematic underestimation: Stevens' Power Law exponent $\beta \approx 0.8$)
5. **Volume / 3D curvature** (Severely distorted by perspective foreshortening)
6. **Color hue / saturation** (Lowest quantitative accuracy; best reserved for categorical identity or binary alert states)

## 2. The Lie Factor & Coordinate Invariants

$$\text{Lie Factor} = \frac{\text{Size of effect shown in graphic}}{\text{Size of effect in data}}$$
An epistemic graphic must maintain $\text{Lie Factor} = 1.00 \pm 0.05$.
- Baseline zero must be maintained on bar and area marks.
- Broken scales must be explicitly demarcated with zigzag breaks.
- Scale transforms (log, sqrt, symlog) must be labeled with their mathematical function on the axis.

## 3. Small Multiples Architecture

When comparing $N > 4$ series:
- Discard single spaghetti chart with $N$ overlapping lines.
- Construct an $M \times K$ grid of small multiples.
- Shared domain: Every multiple shares the exact same X and Y domains so height directly conveys relative magnitude.
- Subtle background baseline: In each facet, render the aggregate/swarm mean in faint gray (`#334155`) with the facet's specific series highlighted in vivid color (`#38bdf8`).
