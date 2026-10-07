# The original twenty patterns and trace semantics

Van der Aalst et al. (2003) group the original control-flow taxonomy as:

1. Sequence; 2. Parallel Split; 3. Synchronization; 4. Exclusive Choice;
5. Simple Merge; 6. Multiple Choice; 7. Synchronizing Merge; 8. Multi-Merge;
9. Discriminator; 10. Arbitrary Cycles; 11. Implicit Termination; 12. Multiple
Instances without Synchronization; 13. Multiple Instances with A Priori Design-Time
Knowledge; 14. Multiple Instances with A Priori Run-Time Knowledge; 15. Multiple
Instances without A Priori Run-Time Knowledge; 16. Deferred Choice; 17. Interleaved
Parallel Routing; 18. Milestone; 19. Cancel Activity; 20. Cancel Case.

Pattern 8 is not an N-out-of-M join: each incoming activation can start the following
activity. Pattern 9 fires on the first arrival, then waits for the remaining branches
and ignores their arrivals until reset; it does not cancel those branches. Patterns 19
and 20 are distinct cancellation scopes and require an engine to specify cleanup and
late-arrival behavior.

The paper compares fifteen commercial products with information available at the end of
2001. Treat it as a historical taxonomy and comparison, not a current prevalence survey:
[TU/e publication record](https://research.tue.nl/en/publications/workflow-patterns-2/) and
[paper PDF](https://cliplab.org/Projects/S-CUBE/papers/aalst03%3Aworkflow_patterns.pdf).
