type: fixed

- **Squid recovery status no longer gets stuck in a phantom half-open state.** Hook wrappers now enforce a fixed one-second execution budget plus bounded termination grace, serialize stale-marker reclamation so only one recovery probe can run, and share conservative whole-second boundaries with FleetBar. Expired markers become recovery-ready, implausibly future markers require explicit repair, and the operator can see the probe's actual start and expected-finish timestamps without capturing hook payloads.
