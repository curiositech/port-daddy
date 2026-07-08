# fleet-config-ui is deprecated

Do not add new Port Daddy operator features here.

Fleet Control Center owns the operator surface now. New tabs, panels, controls,
and proof views belong in the native SwiftUI app under:

```text
apps/FleetBar/FleetBar/
```

This package remains only as the legacy `/fleet-ui/` compatibility bundle while
old embedded surfaces are folded into Fleet Control Center.

Allowed changes:

- security fixes for existing legacy routes
- build fixes needed to keep old `/fleet-ui/` assets serving
- deletion or migration work that removes legacy webview dependence

Not allowed:

- new product tabs
- new operator workflows
- new demo surfaces
- new agent-control-plane UI

The one sanctioned exception is **Galaxy** (`SessionGalaxyPanel`), shipped here as the
Fleet UI face of the four-surface session-embedding map (daemon + Fleet UI + pd-console +
FleetBar). It also renders natively in Fleet Control Center; the fleet-config-ui tab is a
transitional compatibility surface, not a new net product surface. The rule above bars
adding *further* net-new surfaces beyond it.

If a feature needs to be visible to the operator, put it in Fleet Control Center.
