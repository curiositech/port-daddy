type: fixed

- Add daemon-independent persistent local Off controls in FleetBar and pd-console, keeping saved stop state distinct from shutdown verification and hosted Fleet settings.
- Gate native requests, CLI/bootstrap, Dispatch, Fleet/reload and backend admission on canonical Off controls; preserve operator halt records and deny unknown control state.
