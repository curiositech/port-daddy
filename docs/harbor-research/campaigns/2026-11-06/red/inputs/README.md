# Admission revision model

The abstract Check action assumes a correct complete finite-model verdict. ChangeModel represents a new checked-artifact revision whose future model contains a conflict. Admission and revision comparison are atomic. This model tests cache invalidation at the effect boundary; it does not prove the Python checker, hash collision resistance, the implemented scheduler, or liveness.

`bound.cfg` must satisfy SafeAdmission. `unbound.cfg` must violate it. `accepted.cfg` deliberately violates NoAdmission to show successful admission is reachable. `stale_rejected.cfg` deliberately violates NoStaleRejection to show stale rejection is reachable. These last two are non-vacuity witnesses, not bugs. No host/process isolation follows from TLC.
