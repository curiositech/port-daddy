# JADE-LEAP split-container deployment

## Documented topology and constraints

JADE-LEAP split mode has a FrontEnd and BackEnd. A JADE container must already run where the BackEnd is created; it is called the Mediator and need not be the Main Container. The Main Container cannot be split. Mobility and cloning are unsupported on a split container. These are LEAP execution-mode constraints, not a general edge/server durability architecture.

## Deployment checklist

Before choosing split mode, name the Mediator/container, FrontEnd state, network/authentication mechanism, and which application messages can become stale. Test reconnection, persistence, buffering, firewall traversal, and recovery in the selected environment; do not infer them from the mode. Do not retain invented RAM, battery, lambda, JAR-size, or listener guarantees.

Official JADE-LEAP User Guide, “Execution modes,” pp. 7 onward, accessed 2026-09-24, supports the topology and constraints; guide release metadata is not asserted.
