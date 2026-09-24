# Evaluate semantics, evidence, and scope

Feature names alone do not establish control-flow semantics. Publish a matrix with the
pattern, engine/version, trace fixture, classification, observed limitation, and any
separate authority required for cancellation or effects. An encoding is identified from its implementation, and tested traces are separate
evidence about its behavior; neither silently becomes native or universal support.

The original paper compared fifteen commercial products using information available by
the end of 2001. Its historical comparison motivates a taxonomy, but does not support
current product rankings, prevalence estimates, or cost thresholds. Use contemporary
claims only with a current source and a reproducible evaluation.

## A reviewable comparison matrix

Use a row per requirement, not one overall “expressiveness” score:

| Required behavior | Implementation | Evidence | Tested result | Remaining boundary |
|---|---|---|---|---|
| Structured OR join waits only for active branches | Explicit active-set encoding | Named fixture and inspected transition | Pass for B,C / inactive E | General unstructured joins untested |
| Discriminator absorbs late arrivals before reset | Candidate primitive | Only feature documentation | Unknown | No event trace or reset inspection |
| Cancellation preserves unknown effects | Separate effect protocol | Lost-ack fixture | Pending | Control cancellation alone is insufficient |

Rows are illustrative, not results for a named product. Do not give a real engine a
rating until the specified evidence exists. The local NATIVE/ENCODED/UNSUPPORTED/UNKNOWN
labels are a review convention; they are not the paper's exact grading system.

## User-facing decision

Ask which required behavior remains impossible or unproved in the proposed deployment,
what an encoding costs to understand and maintain, what observable failure will look
like, and who owns recovery. A choice can deliberately accept an unsupported optional
feature while requiring proof for a mandatory one. Record that decision and its scope.

To compare cost, first require the same outcome and failure semantics. If implementation
A cancels background work and B leaves it running, their apparent latency/spend numbers
are not equivalent. Report actual units, workload, sample size and uncertainty; no live
measurements or rankings are supplied by this skill.
