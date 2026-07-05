# Distance-Based Authority Model

Use this when deciding which of the three operator surfaces — Scout, FleetBar, pd-console — should own a given capability, or when reviewing a spec that already claims an owner.

## One operator, three distances from the work

Agent Harbor's operator triad (`docs/architecture/agent-harbor-technical-binder/19-operator-surface-triad.md`) places one human operator at three distances from the running work, never three competing surfaces:

| Surface | Distance | Job | One-line contract |
| --- | --- | --- | --- |
| Scout (Chrome extension) | *inside the artifact* | intake and observation at the point where the operator sees the product misbehave | turn what the operator is looking at into a Work Intent, with evidence attached |
| FleetBar (macOS menu bar) | *ambient, glanceable* | presence, consent, and re-entry | the only surface allowed to demand the operator's attention, and only for human gates |
| pd-console (GPUI native app) | *deep, seated* | inspection, steering, transcripts, files, claims, editing | the proof surface where daemon truth is rendered in full |

The rule that keeps the triad honest, quoted verbatim because it is the whole point: **"Scout captures intent. FleetBar grants consent. pd-console shows the truth. No surface owns runtime state; all three render daemon truth and submit commands through the same envelopes."**

## Distance is the classifier, not convenience

The failure mode this model exists to prevent is a capability landing on whichever surface was fastest to build it in, not the surface its distance-from-work actually calls for. Concretely:

- **Intake** capabilities (Scout) exist at the moment of observation. If the operator is looking at a broken UI element, the capability that turns that into a filed, evidence-backed Work Intent belongs on Scout — never re-implemented as a "quick fix" button bolted onto FleetBar or pd-console, because neither surface is present at the point of observation.
- **Ambient** capabilities (FleetBar) exist to be glanced at without interrupting whatever the operator was doing, and to demand attention only for a human gate. A capability that needs sustained attention or multi-screen context does not belong here regardless of how convenient the menu bar felt to build against.
- **Deep** capabilities (pd-console) exist for seated inspection: transcripts, diffs, claims, files. A capability that needs more than a glance belongs here, full stop — see `deep-evidence-in-fleetbar` below.

`scripts/surface_authority_audit.mjs` encodes the canonical mapping as `{ intake: 'scout', ambient: 'fleetbar', deep: 'pd-console' }` and treats any capability whose `assignedSurface` disagrees with this mapping (for its declared `distance`) as a `capability-multi-surface` finding — the capability is effectively unassigned from its rightful owner even though it claims one, because the claim contradicts the classification.

## Exactly one owner, never a spread

"Each capability belongs to exactly ONE surface by distance-from-work" is a cardinality rule, not just a placement rule. Two ways this gets violated in practice:

1. **A capability is claimed by two surfaces.** This usually happens when a mockup or an early prototype builds the same affordance twice — once as a FleetBar quick action, once as a pd-console command — and both survive into the shipped spec. The auditor groups capability entries by name and flags any name whose entries disagree on `assignedSurface`.
2. **A capability is claimed by no valid surface.** A typo (`"browser-tab"`, a retired surface name, an empty string) or a surface that predates the triad consolidation (PR #652 retired the standalone web dashboard) leaves a capability with no real owner. The auditor treats any `assignedSurface` outside `{scout, fleetbar, pd-console}` as unassigned.

Both collapse to the same finding id, `capability-multi-surface`, because both are the same underlying defect: the capability does not have exactly one enforceable owner.

## The evidence-screen rule

"Anything requiring more than one screen of evidence belongs in pd-console, not FleetBar" is the sharpest, most concrete instance of the distance rule. FleetBar's popover is deliberately shallow — a command bar, pending gates, a resume list, quick actions — and chapter 19 is explicit that "FleetBar deep-links into pd-console rather than growing panes." A capability that needs `evidenceScreens > 1` and is assigned to FleetBar is not an ambient-consent action anymore; it is a console feature wearing FleetBar's chrome, and the fix is always to relocate it and leave a deep link, never to grow FleetBar's surface area to accommodate it.

## No surface owns runtime state

The triad's authority model only works if all three surfaces are rendering the *same* daemon truth. A surface that caches its own copy of state and treats that cache as authoritative — even for something as small as "the roster I last saw" — breaks the guarantee that killing the daemon degrades all three surfaces to the same honest disconnected state, and that restarting rebuilds all three from ledger truth with no surface remembering phantom state (chapter 19, IT-017 Triad Consistency). `surfacesOwnRuntimeState: true` is therefore always a critical finding regardless of how small the cached slice is — there is no safe amount of surface-owned runtime state, only degrees of how visible the resulting drift will be.
