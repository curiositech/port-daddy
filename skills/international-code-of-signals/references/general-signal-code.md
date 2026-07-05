# General Signal Code (Pub. 102, Chapter 2)

The two-letter tier: 645 base signals + 723 numbered complements, organized by subject. Full corpus in `data/signals.json` → `general_code` (each entry carries `section`, `topic`, `kind`, and `see_also` when the signal is defined by equivalence to a single-letter signal). Query: `scripts/icos_lookup.py code <XX>` or `search <free text>`.

## Namespace Layout

The code allocates alphabet ranges to subjects — a signal's first letters roughly locate its domain:

| Section | Range | Count | Subject |
|---|---|---|---|
| 1 | AA–HT | 192 | Distress — Emergency (abandon, doctor, aircraft/SAR, assistance, boats/rafts, disabled, position of distress, search, survivors) |
| 2 | HV–LJ | 89 | Casualties — Damages (collision, damage, fire, aground, leak, tow) |
| 3 | LK–QC | 122 | Aids to Navigation — Navigation — Hydrography (bearings, canals/channels, lights, mines, dangers, port entry) |
| 4 | QD–SQ | 61 | Maneuvers (ahead/astern, alongside, anchoring, course, speed, stopping) |
| 5 | ST–VF | 61 | Miscellaneous (cargo, crew, fishery, quarantine-adjacent odds and ends) |
| 6 | VG–YD | 76 | Meteorology — Weather (clouds, gale/storm, ice + icebreaker support signals, sea state, visibility) |
| 7 | YG | 1 | Routing of Ships (`YG` = "you appear not to be complying with the traffic separation scheme") |
| 8 | YH–ZR | 35 | Communications (acknowledgment, calling, exercise, reception/transmission) |
| 9 | ZS–ZZ | 8 | International Health Regulations (pratique) |

## Signals to Know Cold

Distress core: `NC` I am in distress and require immediate assistance • `CB` I require immediate assistance (`CB` + Table 2 digit names the kind: `CB 6` = towing) • `AN` I need a doctor • `DX` I am sinking • `GW` man overboard, please pick him up • `AE` I must abandon my vessel • `CP` I am proceeding to your assistance • `CV` I am unable to give assistance • `EL` repeat the distress position • `GX` report results of rescue.

Working the ship: `MG` you should steer course... • `PH` you should steer as indicated • `SQ` you should stop or heave to • `QO` you should not come alongside • `RU` keep clear, maneuvering with difficulty • `NG` you are in a dangerous position • `PD` your navigation lights are not visible • `LO` I am not in my correct position (lightvessel) • `UM` harbor closed to traffic • `UP` permission to enter harbor urgently requested: emergency case.

Communications: `YZ` words which follow are plain language • `YV 1` groups which follow are from the local code • `ZL` your signal received but not understood • `ZQ` your signal appears incorrectly coded • `ZK` I cannot distinguish your signal, repeat by... (Table 1) • `ZD` please relay to all shipping in the vicinity • `YK` I am unable to answer your question.

Social grace exists too: `UW` = "I wish you a pleasant voyage" (the customary sail-past salute).

## Complements Tables (Section 10)

Shared enumerations referenced by many signals — use them **only** where a signal's text says so:

| Table | Digit → Value |
|---|---|
| 1 — Means of communication | 1 Morse by hand flags/arms · 2 loud hailer · 3 Morse lamp · 4 sound signals |
| 2 — Kind of assistance | 0 water · 1 provisions · 2 fuel · 3 pumping equipment · 4 firefighting appliances · 5 medical assistance · 6 towing · 7 survival craft · 8 vessel to stand by · 9 icebreaker |
| 3 — Direction | 0 unknown/calm · 1 NE · 2 E · 3 SE · 4 S · 5 SW · 6 W · 7 NW · 8 N · 9 all directions / confused / variable |

## Pratique Messages (Section 9)

The health-clearance handshake, still the origin of the yellow-flag customs: `Q` my vessel is healthy and I request free pratique (two-letter equivalent `ZS`) • `QQ` I require health clearance • `ZT` my Maritime Declaration of Health has negative answers to the six Health Questions • `ZU` ...positive answer to Health Question(s) 1–6 (by complement) • `ZV` I believe I have been in an infected area during the last thirty days • `ZW` I require Port Medical Officer • `ZX` you should make the appropriate pratique signal • `ZY` you have pratique • `ZZ` you should proceed to anchorage for health clearance.

## Composition Pattern

A message = base group + complements + typed data fields, in order:

```
CH L2537N G4015W        vessel indicated requires assistance at 25°37'N 40°15'W
CB 6                    I require immediate assistance: towing        (Table 2)
YP LABC                 I wish to communicate with vessel LABC by ... (identity used to speak TO)
HY 1 LABC               vessel LABC ... has resumed her voyage        (identity used to speak OF)
RPT AB KL               repeat all before group KL                    (procedure scope)
CY N                    boats are NOT coming to you                   (negation operator)
CW RQ                   is boat/raft on board?                        (question operator)
```

## Anti-Pattern: Free-Composing Two-Letter Groups

**Novice**: invents `XZ`-style groups or strings signals into "sentences," assuming the code is a spelling alphabet.
**Expert**: every group is a registered, complete speech act; unallocated groups mean nothing, and meaning never composes across groups (only complements, modality operators `C`/`NO`/`RQ`, and typed data fields modify a group). The 1965 revision deleted sentence-composition ("the vocabulary method") on purpose: partial receipt of a complete-meaning signal fails safe, a half-received sentence fails dangerous.
**Detection**: any usage that concatenates two-letter groups expecting grammatical meaning, or a "signal" absent from `data/signals.json`.
