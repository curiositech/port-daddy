# Signaling Instructions (Pub. 102, Chapter 1)

The transmission layer of the Code: how any signal travels over any medium. The signal *content* (which groups mean what) lives in the other references and in `data/signals.json`.

## Design Principles of the Code

- **Complete-meaning principle** (1965 revision): every signal carries a complete meaning on its own. The older "vocabulary method" — composing sentences from word-signals — was deliberately abolished.
- **Urgency-ranked namespace**: single-letter signals = very urgent, important, or very common; two-letter = General Signal Code; three-letter starting with `M` = Medical Signal Code.
- **Transport invariance**: the same group means the same thing by flag hoist, flashing light, sound, voice, radiotelegraphy, radiotelephony, or hand flags.
- **Complements** extend a base signal four ways: (a) variation of meaning (`CP` "I am proceeding to your assistance" → `CP 1` "SAR aircraft is coming to your assistance"), (b) question on the same subject (`DY 4` "What is the depth of water where vessel sank?"), (c) answer to the base question (`HX 1`), (d) supplementary detail (`IN 1` "I require a diver to clear propeller"). Recurring complement value-sets are factored into shared Tables 1–3 (see `general-signal-code.md`).

## Definitions Worth Knowing Exactly

| Term | Definition |
|---|---|
| Station | A ship, aircraft, survival craft, or any place at which communications can be effected by any means |
| Originator / Addressee | The authority ordering the signal / the authority it is addressed to (default: Master to Master) |
| Identity signal (call sign) | Group of letters+figures assigned to each station by its administration; allocated internationally, so it indicates nationality |
| Group | More than one continuous letter and/or numeral composing a signal |
| Hoist | One or more groups on a single halyard; **at the dip** = hoisted half-way; **close up** = hoisted fully |
| Tackline | ~2 m of halyard separating groups in one hoist |
| Procedure signal | A signal that facilitates the conduct of signaling itself (`AR`, `AS`, `RPT`, ...) |

## The Data Grammar (Section 4)

How structured values embed inside a signal — the letter is the type tag:

| Prefix | Field | Format |
|---|---|---|
| `A` | Azimuth/bearing | 3 digits 000–359, true, clockwise; prefix only if ambiguous |
| `C` | Course | 3 digits 000–359, true |
| `D` | Date | 2, 4, or 6 digits: day / day+month / day+month+year (`D181063` = 18 Oct 1963) |
| `L` | Latitude | 4 digits ddmm, optional N/S (`L3740S`) |
| `G` | Longitude | 4–5 digits (d)ddmm, optional E/W (`G13925E`) |
| `R` | Distance | Digits, nautical miles |
| `S` / `V` | Speed | Digits, knots / km per hour |
| `T` / `Z` | Time | 4 digits hhmm, local / GMT |
| `F` / `M` suffix | Unit marker | Feet / meters after depth figures |

Composition example: `CH L2537N G4015W` = "Vessel indicated is reported as requiring assistance in lat 25°37'N, long 40°15'W". Figures that are part of a signal's basic signification travel with the basic group: `DI 20` = "I require boats for 20 persons."

Names of vessels/places are spelled out (`RV Gibraltar`). Plain-language stretches are announced with `YZ` ("the words which follow are in plain language"); local-code stretches with `YV 1`. Time of origin (4 digits, nearest minute) may be appended as both timestamp and reference number.

## Flag Signaling (Section 5)

Flag set: 26 alphabetical flags, 10 numeral pennants, **3 substitutes**, 1 answering pennant (40 pieces).

```mermaid
sequenceDiagram
    participant TX as Transmitting station
    participant RX as Receiving station
    TX->>RX: Hoist group (+ identity of addressee, else "all stations in visual range")
    RX->>TX: Answering pennant AT THE DIP (= hoist seen)
    RX->>TX: Answering pennant CLOSE UP (= hoist understood)
    TX->>RX: Haul down; next hoist
    RX->>TX: Dip, then close up again per hoist
    TX->>RX: Answering pennant hoisted SINGLY (= signal completed)
```

- One hoist at a time; keep flying until answered. Multiple groups on one halyard are separated by tacklines.
- Cannot identify the addressee? Hoist `VF` ("hoist your identity signal") or `CS` ("what is your name or identity signal?"), or `YQ` (with bearing).
- Signal distinguishable but not understood: keep the pennant at the dip and hoist `ZQ` ("your signal appears incorrectly coded; check and repeat") or `ZL` ("received but not understood").
- **Substitutes** let one flag set repeat a character: the *N*th substitute repeats the *N*th flag of the same class (alphabet vs numeral), counting from the top and counting substitutes as positions; no substitute is used twice in one group. `1100` = `1`, first substitute, `0`, **third** substitute. The answering pennant used as a decimal point is disregarded in the count. (`scripts/icos_lookup.py hoist <GROUP>` computes this.)
- A ship of war signals a merchant vessel by flying the Code pennant conspicuously throughout.

## Flashing Light (Section 6)

Message anatomy: **call** (`AA AA AA` general, or addressee identity — answered `TTTT...`) → **identity** (`DE` + identity, each repeated back) → **text** (code groups preceded by `YU`; plain language allowed for names/places; each word/group acknowledged with `T`) → **ending** (`AR`, answered `R`).

- Morse timing ratio — dot 1 unit; dash 3; intra-symbol gap 1; inter-symbol 3; inter-word 7. Err toward shorter dots for legibility. Standard rate: 40 letters/minute.
- Erase: `EEEEEE...`, answered in kind; resume from the last correct word.
- `RPT` from TX = "I repeat"; from RX = "repeat what you sent". Scoped by `AA` (all after), `AB` (all before), `BN` (all between), `WA`/`WB` (word after/before): `RPT AB KL` = repeat all before group KL. If the signal is *not understood*, do **not** use `RPT` — reply `ZL`.
- Modality operators appended after the main signal: `C` affirmative, `N` (visual/sound) or `NO` (voice/radio) negative, `RQ` interrogative. `CY N` = "boats are NOT coming to you"; `CW RQ` = "is boat/raft on board?". **Never combined with single-letter signals.**
- `AS` alone/at end = wait; between groups = separator. `OK` = correct repetition (also "it is correct").

## Sound (Section 7)

Slow by nature and dangerously easy to misuse: keep to a minimum in fog; anything beyond single-letter signals only in extreme emergency, never in frequented waters. Asterisked single letters (B C D E G H I S T Z) may only be sounded in COLREGS-compliant contexts.

## Radiotelephony (Section 8)

Call = addressee call sign/name ×≤3, `DE` (DELTA ECHO), caller ×≤3. `CQ` (×≤3) calls all stations in the vicinity. `INTERCO` announces that ICOS groups follow; `YZ` marks plain language; `AS` + minutes defers traffic; `R` acknowledges receipt; `RPT` (+ AA/AB/BN/WA/WB) requests repetition; `AR` ends. Letters/figures spelled per the phonetic tables (see `single-letter-and-procedure.md`).

## Hand Flags or Arms (Section 9)

Request the mode with `K 1` by any method (or call `AA AA AA`); addressee answers or replies `YS 1` if unable. Both arms normally; end with `AR`.

## Anti-Pattern: Treating RPT as a Universal "Say Again"

**Novice**: replies `RPT` whenever a message is confusing.
**Expert**: `RPT` means the *transmission* was not received correctly. If reception was fine but the decoded meaning is unintelligible, `RPT` is wrong — signal `ZL` (received but not understood) or `ZQ` (appears incorrectly coded). The Code separates transport-layer failure from semantic failure.
