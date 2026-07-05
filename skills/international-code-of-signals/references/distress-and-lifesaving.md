# Distress and Lifesaving Signals, Radiotelephone Procedures (Pub. 102, Chapter 4)

The emergency layer: what counts as a distress signal, how shore and ship coordinate a rescue, and the voice-radio priority system.

## The 14 Distress Signals (COLREGS 1972, Annex IV)

Used together or separately, **only** by a vessel (or seaplane on the water) in distress requiring assistance — misuse or confusable signals prohibited:

1. Gun or explosive signal at ~1 minute intervals
2. Continuous sounding of any fog-signaling apparatus
3. Rockets/shells throwing red stars, one at a time at short intervals
4. `SOS` (`...---...`) by radiotelegraphy or any signaling method
5. Spoken word **MAYDAY** by radiotelephony
6. International Code signal of distress: **NC**
7. Square flag with a ball (or anything resembling one) above or below it
8. Flames on the vessel (burning tar/oil barrel)
9. Rocket parachute flare or hand flare showing a red light
10. Orange-colored smoke signal
11. Slowly and repeatedly raising and lowering outstretched arms
12. Radiotelegraph alarm (twelve 4-second dashes at 1-second intervals — trips auto-alarms)
13. Radiotelephone alarm (alternating 2200 Hz / 1300 Hz tones, 30–60 s)
14. EPIRB transmissions

Air-identification aids: orange canvas with black square-and-circle; dye marker.

Note the redundancy strategy: *fourteen* transport-diverse encodings of one meaning, spanning sound, light, RF, pyrotechnics, body motion, and dye — chosen so at least one survives any given sensor/visibility/equipment failure.

## Lifesaving Signals (shore ↔ ship, SOLAS)

**Landing guidance for small boats in distress** — the semantics ride on *motion axis* and *color*:

| Signal (day / night) | Meaning |
|---|---|
| Vertical motion of white flag/arms / white light — or green star — or letter `K` by light/sound | This is the best place to land (a steady white light lower and in line gives the range) |
| Horizontal motion of white flag/arms / light — or red star — or letter `S` | Landing here highly dangerous |
| Horizontal motion, then plant the flag and carry a second one in a direction — or red star vertical + white star toward the better place — or `S` then `R` (better landing to the right in the approach direction) / `S` then `L` (to the left) | Landing dangerous; better location in direction indicated |

**Shore lifesaving apparatus (breeches buoy / rocket line)**: vertical motion or green star = *affirmative* (specifically: rocket line held — tail block fast — hawser fast — man in the buoy — haul away); horizontal motion or red star = *negative* (slack away — avast hauling).

**SAR aircraft to surface craft**: circling + crossing low ahead + heading = "follow me toward the casualty"; crossing low astern = "your assistance no longer required."

## Radiotelephone Priority Words (Section 3)

| Prefix | Class | Meaning |
|---|---|---|
| **MAYDAY** | Distress | Ship/aircraft threatened by grave and imminent danger, requests immediate assistance |
| **PAN PAN** | Urgency | Very urgent message concerning the safety of a ship/aircraft/person |
| **SECURITE** | Safety | Message concerning safety of navigation or important meteorological warning |

Distress traffic protocol: distress call ×3 → `MAYDAY` + identity + position + nature of distress + assistance required. Distress traffic imposes **radio silence** on all stations not involved (`SEELONCE MAYDAY`); the controlling station lifts it when done. Distress outranks urgency outranks safety outranks routine — a strict priority queue enforced socially, not by hardware.

## Anti-Pattern: Using a Distress Signal to Get Attention

**Novice**: fires a red flare or keys MAYDAY for a serious-but-not-grave problem ("we lost engine power, no immediate danger").
**Expert**: distress means *grave and imminent danger to vessel or persons requiring immediate assistance* — anything less is urgency (`PAN PAN`, or code signals like `F` "I am disabled; communicate with me" / `CB` with the right Table 2 complement). False distress erodes the alarm channel every real emergency depends on, and is legally prohibited (COLREGS Annex IV ¶2).
**Detection**: distress escalation without the "grave and imminent" predicate satisfied.
