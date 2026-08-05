# FleetBar Triage Example

Use this when the source tree says a feature exists but FleetBar or the console
does not show it.

```bash
pd status
eval "$(pd use stable)"
launchctl print gui/$(id -u)/homebrew.mxcl.port-daddy
pd services --project port-daddy
pd fleet status --project port-daddy
```

Then inspect the product surface:

- FleetBar screenshot paths:
  - `website-v2/public/img/app-screens/fleetbar-native-shell-light.webp`
  - `website-v2/public/img/app-screens/fleetbar-native-shell-dark.webp`
- Console screenshot paths:
  - `website-v2/public/img/app-screens/fleet-flow-light.webp`
  - `website-v2/public/img/app-screens/resources-light.webp`
  - `website-v2/public/img/app-screens/sorties-light.webp`

Good triage separates process truth from visual truth. A build can pass while
the installed app still points at an older daemon or stale bundle.
