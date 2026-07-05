# Single-Letter Signals, Procedure Signals, Morse, and Phonetics

The urgent tier of the Code plus its control-plane vocabulary. Machine-readable form: `data/signals.json` (`single_letter`, `single_letter_complements`, `procedure_signals`, `icebreaker_signals`, `morse`, `phonetic_*`). Query with `scripts/icos_lookup.py`.

## The 26 Single-Letter Signals

May be made by **any** method of signaling. Asterisk (*) = when made by *sound*, only in compliance with COLREGS 1972 (they collide with Rule 34/35 maneuvering and fog signals).

| Ltr | Morse | Meaning |
|---|---|---|
| A | `.-` | I have a diver down; keep well clear at slow speed |
| B* | `-...` | I am taking in, or discharging, or carrying dangerous goods |
| C* | `-.-.` | Yes / affirmative (previous group to be read in the affirmative) |
| D* | `-..` | Keep clear of me; I am maneuvering with difficulty |
| E* | `.` | I am altering my course to starboard |
| F | `..-.` | I am disabled; communicate with me |
| G* | `--.` | I require a pilot. (Fishing vessels on the grounds: "I am hauling nets") |
| H* | `....` | I have a pilot on board |
| I* | `..` | I am altering my course to port |
| J | `.---` | I am on fire and have dangerous cargo on board: keep well clear — or, I am leaking dangerous cargo |
| K | `-.-` | I wish to communicate with you |
| L | `.-..` | You should stop your vessel instantly |
| M | `--` | My vessel is stopped and making no way through the water |
| N | `-.` | No / negative. Visual or sound only — voice/radio uses "NO" |
| O | `---` | Man overboard |
| P | `.--.` | In harbor: all persons report on board, vessel about to proceed to sea (the "Blue Peter"). At sea (fishing): "my nets have come fast upon an obstruction". As sound: "I require a pilot" |
| Q | `--.-` | My vessel is "healthy" and I request free pratique |
| R | `.-.` | **No signification as a single letter.** Procedure signal only: "Received" |
| S* | `...` | I am operating astern propulsion |
| T* | `-` | Keep clear of me; I am engaged in pair trawling |
| U | `..-` | You are running into danger |
| V | `...-` | I require assistance |
| W | `.--` | I require medical assistance |
| X | `-..-` | Stop carrying out your intentions and watch for my signals |
| Y | `-.--` | I am dragging my anchor |
| Z* | `--..` | I require a tug. (Fishing vessels on the grounds: "I am shooting nets") |

Context re-binds meaning: `K` and `S` double as shore landing signals for boats in distress (SOLAS V/16); several letters change meaning between icebreaker work, fishing grounds, and open water. **The signal's meaning is (letter × context), not letter alone.**

## Single Letters + Numeral Complements

| Signal | Meaning |
|---|---|
| `A` + 3 digits | Azimuth or bearing |
| `C` + 3 digits | Course |
| `D` + 2/4/6 digits | Date |
| `G` + 4–5 digits | Longitude |
| `K` + 1 digit | I wish to communicate with you by... (Table 1) |
| `L` + 4 digits | Latitude |
| `R` + digits | Distance (nm) |
| `S` + digits | Speed (knots) |
| `T` + 4 digits | Local time |
| `V` + digits | Speed (km/h) |
| `Z` + 4 digits | GMT |
| `Z` + 1 digit | Call shore visual station (numeral set by port authority) |

## Icebreaker Channel (a scoped sub-protocol)

`WM` opens icebreaker support (special signals now in force, continuous watch required); `WO` closes it. Between those brackets, single letters are **re-bound** to paired imperative/acknowledge meanings — e.g. `G`: icebreaker "I am going ahead; follow me" / assisted "I am going ahead; I am following you"; `L`: "stop your vessel instantly" / "I am stopping"; `4`: "Stop. I am icebound" (both directions); `5`: "Attention". Full table in `data/signals.json` → `icebreaker_signals`. Sound-only `..-..` = "stop your headway" (never by radiotelephone). This is the Code's cleanest example of *session-scoped semantics*.

## Procedure Signals (control plane)

| Signal | Role |
|---|---|
| `AA` / `AB` / `BN` / `WA` / `WB` | Repetition scopes after `RPT`: all-after / all-before / between / word-after / word-before |
| `AR` | End of transmission |
| `AS` | Wait — or group separator when inserted mid-signal |
| `C` / `N` or `NO` / `RQ` | Modality: read previous group as affirmative / negative / question (never with single-letter signals) |
| `CS` | What is your name or identity signal? |
| `CQ` | General call to all stations |
| `DE` | "From..." — precedes the caller's identity |
| `K` | Invitation to transmit |
| `OK` | Correct repetition / it is correct |
| `R` | Received |
| `RPT` | Repeat (I repeat / repeat what you sent / repeat what you received) |
| Light only: `AA AA AA` call, `TTTT` answer, `T` word received, `EEEEEE` erase, `AAA` full stop/decimal | |
| Voice only: `INTERCO` (code groups follow), `STOP`, `DECIMAL`, `CORRECTION` | |

## Phonetic Tables

Letters: Alfa Bravo Charlie Delta Echo Foxtrot Golf Hotel India **Juliett** Kilo Lima Mike November Oscar Papa Quebec Romeo Sierra Tango Uniform Victor Whiskey X-ray Yankee Zulu. (Spellings are normative: *Alfa*, *Juliett* — not Alpha, Juliet.)

Figures (maritime/aeronautical compound words): 0 NADAZERO, 1 UNAONE, 2 BISSOTWO, 3 TERRATHREE, 4 KARTEFOUR, 5 PANTAFIVE, 6 SOXISIX, 7 SETTESEVEN, 8 OKTOEIGHT, 9 NOVENINE, decimal DECIMAL, full stop STOP. Each syllable equally emphasized; the second component is the ICAO code word.

## Anti-Pattern: "Every Letter Has a Flag Meaning"

**Novice**: assigns a single-letter meaning to all 26 letters (e.g. R = "the way is off my ship; you may feel your way past me").
**Expert**: the 1969 Code allocates **no** single-letter signification to R — it is reserved as the procedure signal "Received". The "way is off my ship" meaning is from the pre-1965 code and survives only in folklore (and in some downstream systems' flag tables).
**Timeline**: 1931 code: R = way-is-off-my-ship → 1969 code (effective 1 April 1969): R = procedure only.
**Detection**: any flag table that lists a navigational meaning for plain R is quoting the dead code.
