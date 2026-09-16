type: fixed

- Add daemon-independent persistent local Off controls in FleetBar and pd-console, keeping saved stop state distinct from shutdown verification and hosted Fleet settings.
- Gate native requests, CLI/bootstrap, Dispatch, Fleet/reload and backend admission on canonical Off controls; preserve operator halt records and deny unknown control state.
- Serialize FleetBar request/process admission with the local Off latch, cancel idle streams on external Off, and bound SSE buffering. Inject independent controls into intercepted store tests.
- Gate automatic appwatch/installer work and deferred app starts, refuse ungated historical packagers, and include appwatch plus the latest FleetBar lane in the stop plan.
- Recheck Off at the JS loader launch, final subprocess handoff, Fleet output and trigger admission boundaries; retain late-trigger cleanup failures. Add synthetic shim-parity and asynchronous-race regressions. Deferred effects inside individual provider/sink adapters remain an explicit unverified boundary.
