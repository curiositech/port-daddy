# Drydock Control Room prototype

Open [`index.html`](index.html) directly in a browser. It is a self-contained static interaction prototype, not a shipped console. It starts no service, makes no network request, emits no command, and represents no live Port Daddy state.

The prototype demonstrates the first safe product wedge:

- one repository;
- one proposed agent run;
- one desktop Control Room path;
- Proposal, Workroom, and Review/Evidence views;
- projection-only run selection;
- a visibly separate Switchboard preview for consequential commands;
- typed `PROPOSED`, `OBSERVED`, `PENDING`, `UNKNOWN`, `STALE`, and `BLOCKED` states;
- native-unit capacity presentation, meaning provider-native allowances such as tokens, requests, elapsed execution time, and reset-window remainder rather than a misleading zero-dollar ledger entry;
- two-activation evidence zoom ending in primary evidence or an unavailable-evidence receipt;
- keyboard, 200% zoom, forced-colors, and reduced-motion foundations.

Buttons manipulate only local prototype state. Every such control says so in the interface. Runtime containment, Stop delivery, provider behavior, live accessibility, and operator comprehension remain unproved.

Validate its inert control and accessibility contract with:

```text
node docs/research/drydock-anchor-convention/operator-prototype/validate-static-prototype.mjs
```

## Static visual audit

The artifact was inspected at the default desktop viewport and a narrow phone
viewport. Proposal, Workroom, staged Stop preview, Review, and both evidence
zoom activations were exercised. A mobile intrinsic-grid overflow found during
that audit was corrected; the final narrow layout has equal document client and
scroll widths. This is browser-rendered fixture evidence, not a human
accessibility result or a live-product claim.
