# ICOS → Port Daddy Symbology and Design

Port Daddy already speaks a dialect of ICOS: `lib/maritime.ts` (flag rendering, radio message formatting), `lib/maritime-signals.ts` (`SIGNAL_FOR_STATE`, per-letter ANSI colors, hoist combos), `core/pd-console/src/maritime.rs` (ANSI flag blocks), and the operator-console roadmap §8 (Maritime Flags Reference). This reference audits that dialect against the actual Pub. 102 and gives rules for extending it. Read this **with the repo files open** — the mapping below reflects the roadmap as of 2026-07; verify against `SIGNAL_FOR_STATE` before citing it.

## Current State → Flag Mapping (audited)

| pd state | Flag | ICOS meaning | Fidelity verdict |
|---|---|---|---|
| `claim-active` | H | I have a pilot on board | ✅ apt — a claim *is* pilotage of a surface |
| `claim-stale` | Y | I am dragging my anchor | ✅ excellent — position held but slipping |
| `awaiting-human` | F | I am disabled; communicate with me | ✅ the canonical HITL flag |
| `burning-cash` | B | Taking in / carrying dangerous goods | ✅ witty and correct — B is the fuel/explosives flag |
| `conflict` | V | I require assistance | ⚠️ V is a *distress-adjacent* ask; consider U ("you are running into danger") for the warned party and keep V for the party needing arbitration |
| `blocked` | D | Keep clear; maneuvering with difficulty | ✅ |
| `idle` | M | Stopped, making no way | ✅ |
| `spawning` | A | Diver down; keep well clear at slow speed | ✅ delicate operation in progress, give room |
| `fleet-healthy` | P | Blue Peter — about to put to sea | ✅ in-harbor meaning, correctly used |
| `mayday` | J | On fire with dangerous cargo | ✅ J is the strongest single-letter emergency |
| `inform` | R | "The way is off my ship..." | ❌ **1931 code.** R has *no* single-letter meaning in the 1969 code (procedure "Received" only). Fine as folklore; do not cite it as ICOS |
| `request` | K | I wish to communicate with you | ✅ |
| `refuse` / `affirmative` | N / C | No / Yes | ✅ exactly the ICOS modality pair |
| newcomer (ADR-0040a) | Q | Healthy, request free pratique | ✅ perfect — an unproven vessel requesting clearance is precisely a new actor pre-first-sortie |

Reserved-but-unmapped letters worth claiming, in ICOS-faithful order:

| Flag | ICOS meaning | Natural pd state |
|---|---|---|
| X | Stop carrying out your intentions and watch for my signals | **Guard interception** (`pd guard` block) — X is the Code's own "halt, await instruction" |
| O | Man overboard | Agent crashed / lost mid-sortie (crew member in the water, drop everything) |
| L | You should stop your vessel instantly | Hard kill / `TaskStop` |
| U | You are running into danger | Pre-conflict warning (semantic-conflict prediction firing *before* the collision) |
| Z | I require a tug | Needs-reboot / needs-rescue-by-operator (dead daemon, stuck session) |
| G | I require a pilot | Needs-orchestrator: agent requests a supervisor take the conn |
| W | I require medical assistance | Escalated agent failure needing diagnostic intervention (pair with the `M**` idea below) |

## Hoist Grammar (multi-flag states)

pd's hoists (`U-Y` conflict+stale, `D-V` needs-arbitration, `O-W` crashed+mayday, `P-Q` fleet startup) follow real hoist practice: **one halyard, read top-down, most significant flag uppermost**. Extension rules from Pub. 102:

- Groups on one halyard are separated by a tackline — in UI terms, a visible separator between *distinct signals*, vs adjacent flags forming *one* group. `U-Y` (two one-letter signals: danger + dragging) needs the separator; a two-letter group like `NC` does not.
- The answering pennant is the ack primitive: **at the dip** = seen, **close up** = understood, **hoisted singly by sender** = transmission complete. This maps onto inbox/notification UX: render delivered vs comprehended as visually distinct states, and give the sender an explicit "conversation closed" mark.
- Substitutes solve repeated letters (see `signaling-instructions.md`); if a hoist badge ever needs `AA`-style repetition, render the substitute rather than duplicating the flag — flying two identical flags from one set is the tell of a fake hoist.

## Color Semantics: ANSI Groups vs Flag Faces

`SIGNAL_ANSI` groups letters by *pd semantic color* (green C/H/P/Q, red D/F/N/O/V/W/X, ...). Note this is a deliberate departure from the flags' actual faces (B is solid red swallow-tailed; Q is solid yellow — the quarantine flag; N is a blue-white checker). Two rules keep it honest:

1. **Never let the state color contradict a famous flag face.** Q rendered green reads fine in a roster, but Q is *the* yellow flag — in any context invoking the flag itself (imagery, marketing, big UI badges), keep Quebec yellow, Bravo red.
2. **Story-palette alignment**: the console palette's mayday-red / amber / settled-green tiers already mirror MAYDAY / PAN PAN / SECURITE. Make that mapping explicit wherever alert tiers are named: distress (red, preempts), urgency (amber), safety/info (blue-green) — and enforce the ICOS discipline that only *grave and imminent* states may use the distress tier (see `distress-and-lifesaving.md` anti-pattern).

## Protocol Symmetries Already in the House

- `pd note` ≈ time-of-origin-stamped signal text: durable, immutable, reference-numbered.
- Coordination preflight ≈ the flag-signaling answering discipline: don't hoist the next group until the last was answered close-up.
- `pd guard check --staged` ≈ X-flag interception: stop carrying out your intentions and watch for my signals.
- Pratique (`Q`/`ZS`→`ZY`) ≈ trust-gate onboarding: newcomer declares health, authority grants clearance or sends to anchorage (`ZZ` = sandbox until reviewed). ADR-0040a's `[NEW]` badge already walks this path; the *grant* signal (`ZY` "you have pratique") is the natural badge-removal event.
- A future structured failure-triage vocabulary for agents (symptom → localization → diagnosis → treatment over enumerated tables) has a complete blueprint in the Medical Code (`medical-signal-code.md`): fixed report order, shared enum tables, and `MQB` as the schema NAK.

## Anti-Pattern: Decorative Nautical Theming

**Novice**: sprinkles flags/anchors as vibes — a flag means whatever the nearest tooltip says today, meanings drift per surface.
**Expert**: pd's maritime layer works because each flag carries its *registered* ICOS meaning into the new domain (F really means "disabled, communicate with me"; the metaphor does explanatory work and the tooltip can cite the book). The moment a symbol's UI meaning contradicts its ICOS meaning (see R above), the system is training operators on folklore. Extend from the registry (`data/signals.json`), never from vibes; when a needed state has no honest flag, use a two-letter group (there are 645) instead of corrupting a single-letter one.
**Detection**: diff every `SIGNAL_FOR_STATE`-style table against `data/signals.json` single-letter meanings; any row whose gloss isn't in the corpus is folklore.
