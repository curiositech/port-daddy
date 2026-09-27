---
name: charrier-et-al-big-brother-logic
description: Model surveillance knowledge only with explicit camera geometry, observation, action, and epistemic assumptions.
category: Research & Academic
tags: [epistemic-logic, surveillance, pdl, model-checking, knowledge]
---

# Big Brother Logic: surveillance assumptions made explicit

Charrier et al. (AAMAS 2014) model stationary planar cameras with known exact
positions, changing orientation/vision, a finite vision abstraction, and PDL
translation. The paper leaves mobile-camera model checking/satisfiability for
future work. Its complexity statements belong to specified logic fragments.

```mermaid
flowchart LR
  W[Planar world and exact camera positions] --> C[Stationary camera orientation]
  C --> V[Vision partition or observation]
  V --> M[Possible-world epistemic model]
  M --> P[PDL action/knowledge formula]
  P --> R[Model-checking or satisfiability question]
```

```mermaid
flowchart TB
  O[No observation of event p] --> S[Set of worlds compatible with observation]
  S --> K{All compatible worlds exclude p?}
  K -- yes --> N[Know not p under model]
  K -- no --> U[Do not infer knowledge of not p]
  U --> A[Seek observation or report uncertainty]
```

## Extension gate

A mobile camera, uncertain camera pose, noisy detection, asynchronous delivery,
or privacy boundary changes the model. Name the state transition, observation
relation, and logic before reusing a stationary-camera result. Do not call
absence of an observation evidence of absence without the possible-world set.

See [Kripke models](references/kripke-models-for-agent-uncertainty.md),
[knowledge operators](references/distributed-vs-common-knowledge.md), and
[model-checking limits](references/model-checking-vs-satisfiability-dual-problems.md).