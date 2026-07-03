# FleetBar And Console

FleetBar is the native Mac entry point. Fleet Control Center is the full browser
console served by the daemon. When agent work touches launch, readiness,
Shipwright, resources, spawned runs, YAML, or recent activity, source inspection is
not enough. The operator has to be able to see the state in the product.

## Screenshot Pointers

These paths are packaged with the public website and are safe to point users at
from docs or pages:

- `website-v2/public/img/app-screens/fleetbar-native-shell-light.png`
- `website-v2/public/img/app-screens/fleetbar-native-shell-dark.png`
- `website-v2/public/img/app-screens/fleet-flow-light.png`
- `website-v2/public/img/app-screens/fleet-flow-dark.png`
- `website-v2/public/img/app-screens/resources-light.png`
- `website-v2/public/img/app-screens/resources-dark.png`
- `website-v2/public/img/app-screens/sorties-light.png`
- `website-v2/public/img/app-screens/shipwright-control-light.png`

## What To Verify

- FleetBar opens the real control plane, not a reduced dashboard.
- Embedded Fleet Control Center hides duplicate chrome when launched from
  FleetBar.
- Readiness states show missing backends, missing keys, and dependency failures
  before launch.
- Agent details include meaningful recent activity, touched files, handoffs, and
  artifacts.
- Touched-file actions resolve against the project/workdir, not a bare relative
  path.
- FleetBar and console agree on daemon provenance.

## Failure Smells

- A command succeeds but FleetBar still shows stale or blank product state.
- The console shows agents but the registry says zero live bodies.
- A launched agent disappears from live registry but has no separate job/history
  lens.
- Screenshots prove only a loading state.
- A popover clips diagnostic text that the operator needs to act on.
