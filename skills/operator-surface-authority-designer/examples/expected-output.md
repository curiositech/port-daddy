# Example Output: Operator Surface Authority Designer

Scenario: a team is speccing Agent Harbor's operator triad. FleetBar's popover grew a "review full diff and transcript" pane because it felt convenient to keep the operator in one window, an "approve merge into main" button was wired to a stub that always returns success, a capability duplicated its distance classification without moving its bus subscription, and the spec author left `surfacesOwnRuntimeState: true` because FleetBar caches roster state locally "for snappiness." This is the "bad spec" `surface_authority_audit.mjs` is designed to catch.

## Bad spec — input

```json
{
  "capabilities": [
    {
      "name": "approve-merge-into-main",
      "assignedSurface": "fleetbar",
      "distance": "ambient",
      "evidenceScreens": 1,
      "daemonEnforceable": false,
      "busSubscription": "hot"
    },
    {
      "name": "review-full-diff-and-transcript",
      "assignedSurface": "fleetbar",
      "distance": "ambient",
      "evidenceScreens": 3,
      "daemonEnforceable": true,
      "busSubscription": "hot"
    },
    {
      "name": "capture-region-with-evidence",
      "assignedSurface": "scout",
      "distance": "intake",
      "evidenceScreens": 1,
      "daemonEnforceable": true,
      "busSubscription": "hot"
    },
    {
      "name": "transcript-search",
      "assignedSurface": "fleetbar",
      "distance": "deep",
      "evidenceScreens": 1,
      "daemonEnforceable": true,
      "busSubscription": "cool"
    },
    {
      "name": "resume-recent-session",
      "assignedSurface": "browser-tab",
      "distance": "ambient",
      "evidenceScreens": 1,
      "daemonEnforceable": true,
      "busSubscription": "cool"
    }
  ],
  "surfacesOwnRuntimeState": true
}
```

## Bad spec — audit result

```json
{
  "pass": false,
  "score": 28,
  "findings": [
    { "severity": "critical", "id": "surface-owns-runtime-state", "message": "A surface owns runtime state directly instead of rendering daemon truth — this breaks \"no surface owns runtime state; all three render daemon truth and submit commands through the same envelopes.\"" },
    { "severity": "critical", "id": "unenforceable-control-rendered", "message": "Capability \"approve-merge-into-main\" is rendered on \"fleetbar\" but the daemon cannot enforce it (daemonEnforceable: false)." },
    { "severity": "critical", "id": "deep-evidence-in-fleetbar", "message": "Capability \"review-full-diff-and-transcript\" needs 3 screens of evidence but is assigned to FleetBar; anything requiring more than one screen of evidence belongs in pd-console." },
    { "severity": "critical", "id": "bus-distance-mismatch", "message": "Capability \"capture-region-with-evidence\" has distance \"intake\" (expects the cool bus: Work Intents are cool-bus objects) but subscribes to \"hot\"." },
    { "severity": "critical", "id": "capability-multi-surface", "message": "Capability \"transcript-search\" is assigned to \"fleetbar\" but its distance (\"deep\") is canonically owned by \"pd-console\" — a capability whose surface disagrees with its distance is effectively unassigned from its rightful owner." },
    { "severity": "critical", "id": "capability-multi-surface", "message": "Capability \"resume-recent-session\" has no valid assigned surface (got \"browser-tab\"): every capability must belong to exactly one of scout, fleetbar, or pd-console." }
  ],
  "recommendations": [
    "Move the owned state into the daemon (ledger/projection) and have every surface render it, rather than letting a surface be the source of truth for its own slice.",
    "Either wire \"approve-merge-into-main\" through a daemon-enforced gate before rendering its control, or remove the control until the daemon can back it (acceptance criterion 6: controls are enabled only when the daemon can actually enforce them).",
    "Move \"review-full-diff-and-transcript\" to pd-console and have FleetBar deep-link into it instead of growing a pane.",
    "Subscribe \"capture-region-with-evidence\" to the cool bus, or reclassify its distance if it is genuinely ambient-only ephemeral chatter.",
    "Reassign \"transcript-search\" to \"pd-console\", or correct its declared distance if the current surface is actually right.",
    "Assign \"resume-recent-session\" to exactly one of scout, fleetbar, or pd-console, matching its declared distance."
  ]
}
```

## What fixing it actually looked like

1. **Wired the merge-approval button to a real daemon gate.** `approve-merge-into-main` was a UI affordance sitting in front of a stub; it now round-trips through the C5 human-gate broker so the button is disabled whenever the daemon cannot actually enforce the decision (acceptance criterion 6).
2. **Moved `review-full-diff-and-transcript` to pd-console.** FleetBar now shows a "3 files changed, review in console" card that deep-links into the pd-console pane instead of growing its own multi-screen diff viewer — FleetBar deep-links into pd-console rather than growing panes.
3. **Reclassified `capture-region-with-evidence`'s bus.** Scout's intake submission is a Work Intent, a cool-bus object, so its subscription moved from `hot` to `cool`. Scout kept a separate hot-bus topic scoped to its own submission for live status, which is a distinct capability entry, not this one.
4. **Reassigned `transcript-search` to pd-console.** It was left on FleetBar from an earlier mockup; since its distance is `deep`, its canonical surface is pd-console, and it was moved there along with its bus subscription (already correctly `cool`).
5. **Fixed the typo'd surface.** `resume-recent-session`'s `assignedSurface` was `"browser-tab"` — a leftover from when re-entry lived in a web dashboard PR #652 retired. Corrected to `"fleetbar"`, matching its `ambient` distance.
6. **Removed FleetBar's local roster cache as a source of truth.** FleetBar still renders roster state instantly, but it now renders the daemon's hot-bus digest stream rather than a locally-owned copy that could drift; `surfacesOwnRuntimeState` flipped to `false`.

## Fixed spec — input

This is `examples/sample-input.json`, unmodified:

```json
{
  "capabilities": [
    { "name": "capture-region-with-evidence", "assignedSurface": "scout", "distance": "intake", "evidenceScreens": 1, "daemonEnforceable": true, "busSubscription": "cool" },
    { "name": "ask-agent-scoped-reply", "assignedSurface": "scout", "distance": "intake", "evidenceScreens": 1, "daemonEnforceable": true, "busSubscription": "cool" },
    { "name": "approve-deny-human-gate", "assignedSurface": "fleetbar", "distance": "ambient", "evidenceScreens": 1, "daemonEnforceable": true, "busSubscription": "hot" },
    { "name": "roster-digest-glance", "assignedSurface": "fleetbar", "distance": "ambient", "evidenceScreens": 1, "daemonEnforceable": true, "busSubscription": "hot" },
    { "name": "resume-recent-session", "assignedSurface": "fleetbar", "distance": "ambient", "evidenceScreens": 1, "daemonEnforceable": true, "busSubscription": "cool" },
    { "name": "full-transcript-replay", "assignedSurface": "pd-console", "distance": "deep", "evidenceScreens": 3, "daemonEnforceable": true, "busSubscription": "cool" },
    { "name": "claims-and-diff-inspection", "assignedSurface": "pd-console", "distance": "deep", "evidenceScreens": 2, "daemonEnforceable": true, "busSubscription": "cool" }
  ],
  "surfacesOwnRuntimeState": false
}
```

## Fixed spec — audit result

```json
{
  "pass": true,
  "score": 100,
  "findings": [],
  "recommendations": [
    "Every capability has exactly one surface matching its distance, every control is daemon-enforceable, and no surface owns runtime state. Ship it."
  ]
}
```

Note that `approve-deny-human-gate` and `roster-digest-glance` legitimately subscribe to the `hot` bus even though FleetBar is their surface: `bus-distance-mismatch` only checks `intake` and `deep` capabilities, because ambient is the one distance the triad chapter explicitly lets mix hot (roster ticks, pending gates) and cool (approval decisions) traffic.
