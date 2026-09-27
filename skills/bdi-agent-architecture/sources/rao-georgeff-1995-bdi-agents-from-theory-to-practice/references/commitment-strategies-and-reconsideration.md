# Commitment strategies and reconsideration

## Two independent axes

A commitment has a **commitment condition** and a **termination condition**. The paper also distinguishes committing to an intention whose object holds on one possible future from holding on all relevant futures. Keep that object axis separate from the policy below.

| Termination policy | Printed characterization | Review trigger |
| --- | --- | --- |
| Blind | Denies belief or desire changes conflicting with commitments. | Conflict is recorded but rejected by that policy. |
| Single-minded | Entertains belief changes and drops commitments accordingly. | A relevant belief change may trigger review. |
| Open-minded | Allows belief and desire changes that force commitments to drop. | A relevant belief or desire change may trigger review. |

No policy is prescribed as generally best. A blind policy is not “retain until achieved or impossible”; that wording confuses the generic attitude-dropping loop with its defining refusal of conflicting updates.

## Interpreter-level method

The practical interpreter can delay intention-status events until the end of a cycle. Posting particular status events determines which intention changes the option generator notices. Implement a local version by recording:

1. stack event (succeeded, failed, suspended, or other declared state);
2. policy rule that exposes or suppresses it;
3. whether a belief or desire update is accepted;
4. option set after review; and
5. selected replacement or unresolved result.

**Positive fixture.** With short_route active, a trusted blocked(route) belief update causes a single-minded review; detour is selected only if its plan precondition holds. An open-minded run can additionally react to a separately recorded priority change.

**Negative fixture.** “Medium volatility plus medium budget means open-minded.” The paper supplies no such threshold or mapping. Compare policies on an identical trace and report the local scores.

## OASIS distinction

**Paper-reported OASIS method, not a current-system claim.** The case assigns one aircraft agent to each arriving aircraft and global Sequencer, Wind Modeller, Coordinator, and Trajectory Checker roles. Wind alternatives form possible-world trajectory trees; feasible branches vary speed and altitude within aircraft limits. Desired paths are pruned to those reaching the target ETA; intention paths retain the best candidates for fuel consumption and aircraft performance. Its practical aircraft plan options expose only maximally fuel-efficient trajectories for the desired ETA. The paper reports up to 70–80 concurrent agents and parallel evaluation trials at Sydney airport using live radar data. The sequencer is single-minded: it stays committed until it believes all aircraft landed in sequence or no longer believes the next aircraft can meet its assigned ETA.

## Source boundary

Official paper, dynamic constraints, abstract interpreter, and OASIS discussion, read 2026-09-24. Later experiment/performance claims are outside this paper unless separately sourced.

Primary source: [Rao–Georgeff 1995, ICMAS pp. 312–319](https://cdn.aaai.org/ICMAS/1995/ICMAS95-042.pdf). Constructed fixtures and local engineering choices are identified above.
