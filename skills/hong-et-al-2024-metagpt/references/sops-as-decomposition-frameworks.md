# SOPs as artifact decomposition

Hong et al. describe a software SOP from PRD through design, task assignment, implementation, and QA (arXiv:2308.00352v7, §§3.1–3.3). Use it as a decomposition aid only when the work has genuine stages and reviewable handoffs.

**Procedure.** Start a PRD requirement with its source and any unresolved point. Have the design name a file/module, data or interface decision, and the PRD item it answers. Let the task card name the dependent design artifact, owner, intended action, and completion evidence. QA records a test case and its observed result. A useful short chain is: `PRD: zero CSV rows produce a summary total of 0` → `design: summarize(rows) accepts an array` → `task: Engineer implements the zero-row sum after design is available` → `QA: empty-input fixture/result`. If locale behavior remains unspecified, it remains an open PRD item rather than becoming an accidental implementation policy.

Subprocedures can be composed when they add a real prerequisite: a design subprocedure may separately settle data shape and interface before a task is assigned. Do not treat the historical “executable SOP” framing as automatic enforcement. This constructed CSV exercise is a local teaching trace, not a paper experiment or evidence that SOPs always fit.

## Constructed artifact cards

| Artifact | Concrete fields carried to the consumer | Consumer check |
|---|---|---|
| PRD `P-v1` | `R-empty`: no data rows means total 0; `R-sum`: amounts 2 and 3 mean total 5; locale formatting unresolved | Architect preserves both requirements and the unresolved item |
| Design `D-v1` | `sum.mjs`; `sum(rows: number[]): number`; parsed finite amounts; output formatting handled separately | Project Manager identifies implementation and formatting as distinct work |
| Task `T-sum` | Engineer; requires `P-v1` and `D-v1`; implement the sum; fixtures `[]` and `[2,3]` | Engineer waits until both exact inputs are present and compatible |
| QA `Q-v1` | Requirement and task IDs; implementation revision; fixture input; actual error/result | Reviewer can reproduce the observed result on that revision |

These cards show an artifact relationship, not a framework schema. Missing `D-v1` leaves `T-sum` waiting; a new `D-v2` is not silently substituted without checking the task against its changed interface. A separate formatting task stays unresolved until its requirement is settled.
