# Parley: Converging Three Redesign Lineages into One Design

**Convened:** 2026-07-05 by the operator · **Status:** verdicts RULED by the operator 2026-07-05 — dark substrate = palette v2 near-black `#101216`; flag map = work states (H/F/B/V/D/Y/M/Q); display face = Plex + Recursive (settled). Punch list executing; converged renders in `mockups-ch20/`.
**Parties:**
- **A — FleetBar lineage** (`docs/design/fleetbar-mockups/`: interactive-mockup, research-report, fleetbar-technical-spec): paper/ink/cobalt, fractional borders, stripe+dot six-state, 380pt popover contract.
- **B — Triad package** (PR #671, `docs/design/2026-07-05-surface-redesign/` + console v12/feelpass): hard-2px flat neobrutalism, cobalt/mustard two rooms, full ICS flag grammar, Big Shoulders + Recursive, seven surface mockups incl. login/account/coop-harbor.
- **C — Story Linework** (PR #657, binder ch. 20, `docs/design/story-linework/`): palette v2 hue-as-layer, fractional linework primitives, stripe+dot+micro-flag+label+time grammar, IBM Plex + Recursive casual axis, cut-paper art, normative mocks for FleetBar/console/Control Center/CLI/Harbor co-edit.
- **D — Triad spec pixels** (PR #658, `docs/design/fleetbar-mockups/triad-*.html`): the merged ch. 19 specs (#651) rendered as static HTML — FleetBar popover, Scout panel, console detail — on canonical paper/ink hexes with cobalt accent, a violet-blocked six-state set, and hairline/bracket fractional tokens.

**Settled by the operator (not argued):** the cut-paper generated-image style (ch. 20 "blessed 2026-07-04"), fractional edge work, palette v2. Chapter 20 is approved binder truth; it is the constitution. What follows argues everything the constitution leaves open, steelmanning each party.

## 1. Gestalt flow — what tops the FleetBar popover?

- **Steelman A/B (intent-first):** ch. 19's own words — *"the fleet is plumbing; the front door is intent."* Gates are rare; a gates-first popover greets the operator with an empty section 90% of the time, which trains them that the top of the surface is dead space. The composer is the daily verb; muscle memory deserves it at a fixed position.
- **Steelman C (gates-first, violet):** ch. 19 equally says FleetBar is *the* consent surface and gates are the only items permitted to demand attention. A gate below the fold is a gate that waits, and waiting gates are exactly the operator-latency the daemon can't fix. The buildable contract (fleetbar-technical-spec) lists gates first.
- **Steelman D (#658, gate-privileged static order):** the spec pixels already render header → "Waiting on you" gate card → command bar → resume → quick actions. The gate card is styled as "the privileged object" — the spec's own answer.
- **Verdict — state-dependent stacking (D's order, made conditional):** the gate queue section *does not render at all* when empty. When a gate exists, the popover renders exactly D's order (gate above composer, zone-colored), and the menu-bar icon already warned you before you opened it. Resting state = composer on top (A/B's daily feel); armed state = D's order (C's and the spec's contract). Both binder sentences satisfied; no dead space ever.

## 2. Functionality — the state grammar

- A ships stripe+dot (Running/OK/Warn/Error/Blocked/Idle, "no spinner beside the dot," pulse only in flight). B ships full ICS letter flags (feelpass; PR #663's corpus makes them citable). C's rule 8 is the merger: **stripe + dot + micro-flag + label + relative time**.
- **Verdict — C verbatim, with B's corpus as its dictionary.** The micro-flag is the semantic channel (Foxtrot means *communicate with me* — citable against Pub. 102 via the ICOS skill), the stripe/dot is the pre-attentive channel, label+time is the accessibility floor. B's full-size flag SVGs demote to micro-flag chips everywhere except ch. 20 rule 7's "one giant flag per page placed where its signal meaning is literally true." A's dot contract (pulse only in-flight, repaint on change not poll) is adopted as motion law — it already matches B's reduced-motion LIVE dot.

## 3. Appeal — type

- **Steelman B (Big Shoulders Display):** mastheads with genuine industrial-editorial punch; nothing else in devtools looks like it; it photographs well in marketing.
- **Steelman C (IBM Plex + Recursive casual axis):** Plex is a superfamily (Sans/Mono/Serif) that actually ships on all three runtimes — SwiftUI, GPUI, and web — so the triad can be *literally* one type system, not three approximations. Recursive's CASL axis supplies the display personality Big Shoulders was hired for, tunable per surface instead of binary. A's Inter/Geist was already rejected by A's own spec as "the 2026 defaults that make every dev tool look the same."
- **Verdict — C.** Big Shoulders retires (it was B's guess at a personality the approved system already provides); display em-phrases use Recursive casual per ch. 20. v11's General Sans dies with v11.

## 4. Uniqueness & cleverness — accent policy

- **Steelman B (two rooms: cobalt storefront / mustard operator deck):** room-scoped accents tell you at a glance which product you're in; the mustard CI gate already enforces it; consent-yellow is a strong operator identity.
- **Steelman C (one palette, hue = layer, one color zone per view):** color that *means* something everywhere beats color that brands rooms — cobalt isn't "the website's color," it's **L0 truth wherever truth is shown**; gold isn't "the console's brand," it's **economy wherever money is shown**. Two brand accents is the first step toward A's own defect rule ("three competing accents is a defect"). And the operator's beloved budget-as-consent surfaces wear gold *legitimately* under C — the mustard feeling survives exactly where it earned its keep.
- **Verdict — C.** Retire mustard-as-brand; budget/economy surfaces wear palette-v2 gold, so the operator deck keeps its warm signature where money and consent live. `scripts/check-brand-colors.mjs` migrates to palette v2 (one PR, listed below). The two-rooms idea survives only as a *density* distinction (storefront breathes, deck is dense), not a hue distinction.

## 5. Ease — border doctrine

Three doctrines shipped: A's fractional hairlines ("never box-shadow, never border-radius"), B's hard-2px-everywhere flat, v12's 8px radius + 6px offset shadow. The operator settled fractional. Remaining reconciliation:
- **Verdict — ch. 20 rule 6 is the whole law:** 1px texture / 1.5px linework / 2px enclosure, never adjacent-mixed; brackets on live panels only; 3px state stripes; midlines; max one color zone per view. B's 2px borders survive *only* in the enclosure role. v12-synthesis's radius and offset shadow are **superseded** (they contradicted A, B, and C simultaneously — nobody defends them in this parley). The research report's "eight patterns, use two" collapses into the spec's four; ch. 20 already made that cut.

## 6. Feel — what B actually contributes

B's skin loses on every contested dimension above — argued honestly. What B built that neither A nor C has, and that survives reskinning because it is *content architecture*, not chrome:
1. **The storefront surfaces exist**: login (trust-model-in-one-screen: local-first block, OIDC + 4-digit pairing ritual, no-custodial-keys honesty), account home (keyring / receipt drawer / consent ledger, devices with plain-language capability roles), grounded in ADR-0029/0039/0040/0027. C's apps.html covers five operator surfaces and zero storefront ones.
2. **Consent-cost lines** on every gate card ("est. $0.14 to run the merge sortie") — cost at the decision moment, nowhere else.
3. **Teaching empty states** — ch. 20 names "Papa empty states" for Control Center; B wrote the doctrine and the copy patterns.
4. **Honest-truth chips**: Scout's ONLINE/OFFLINE with remediation, stale-truth "showing cached truth — last sync 47s," LIVE-means-stream-evidence.
5. **Remediation rows** replacing debug rows ("no purpose recorded — nudge to declare scope").
6. **The pratique lane** rendered (Quebec + [NEW] + reduced ceiling) and the durable-ledger strip with sequence numbers.
7. **Scout itself** — absent from C's surface list entirely; B's popup IA (evidence hero, consent footer, deep-link discipline) is the only current design.

## 7. Co-op vibe coding — two surfaces, one language

C's Harbor co-edit dream is in-buffer governance: participant letter flags, claims as left-edge stripes on the exact held line ranges, hatched semantic-conflict forecast bands, radio-voice parley strip, salvage tide-line. B's coop-harbor is the *remote web session view*: crew rail with capability cards, claims map, structured parley panel, gates, ledger tail.
- **Verdict — both, C's language:** the co-edit buffer is the editor surface (pd-console / Harbor editor, M9); B's page becomes the **portdaddy.dev remote view** of the same harbor, reskinned to C (claims render as line-range stripes wherever code is shown; parley strip adopts `--voice-securite`/`--voice-pan-pan`; participants fly letter flags). They are one design at two distances from the buffer.

## 8. Party D's standing contributions (PR #658)

D is the nearest existing render to the converged skin: canonical paper `#F2EEE6` / ink `#121212`, cobalt accent, **violet for blocked** (palette-v2-consistent), hairline + bracket fractional tokens, both themes. Beyond the gate-privileged order (verdict 1), D contributes: Scout's **three honest daemon-chip states** and the **routed-shape confirmation showing the Work Intent id** (the ch. 19 intent-trace made visible), the closed annotation-category taxonomy, and the console's *"live — events arriving"* eyebrow (LIVE-means-stream-evidence as literal copy). These are adopted verbatim. D still needs from C: palette v2's full expansion, micro-flag chips, Plex/Recursive type, cut-paper art; and from B: the storefront surfaces and the consent-cost/teaching-empty-state copy.

## The converged design

**Story Linework (ch. 20) is the skin and law for every surface. The triad spec pixels (PR #658) are the base renders to evolve — they already sit on canonical hexes and fractional tokens. The Triad package (PR #671) supplies the missing surfaces and the honesty-content doctrine. The FleetBar lineage's dot/motion contract is adopted as motion law. One addition: state-dependent gate stacking in FleetBar (D's order, rendered only when armed).**

### Migration punch list (each item one PR)
1. Evolve D's three triad mockups (#658) to full ch. 20: palette v2 expansion, micro-flag chips in the rule-8 grammar, IBM Plex + Recursive casual, cut-paper art slots. Re-skin the four #671-only surfaces (login, account, coop-harbor, control-center) to the same standard; retire the #671 renders of FleetBar/console/Scout in favor of D-evolved ones, porting B's content patterns into them. Drop Big Shoulders, hard-2px-everywhere, mustard-as-brand, the two-rooms hue split.
2. FleetBar mockup: implement state-dependent stacking (gate section above composer only when non-empty).
3. `scripts/check-brand-colors.mjs`: migrate console gate from mustard `#FFDB33` to palette v2 set; add the never-list from ch. 20.
4. Mark `operator-console-v12-synthesis.html` superseded-by-ch20 in `fleetbar-mockups/README.md` (radius/shadow explicitly retired).
5. Adopt Scout + login/account/coop-harbor into the ch. 20 surface set (addendum section or apps.html extension), carrying B's content doctrine verbatim.
6. Port the #671 spec docs' laws that ch. 20 lacks (consent-cost lines, teaching-empty-state copy patterns, honest-truth chips, remediation rows) into ch. 20 or a companion binder note — so the *content* law is as citable as the *skin* law.
