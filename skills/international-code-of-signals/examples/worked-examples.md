# Worked Examples

All groups verified against `data/signals.json` via `scripts/icos_lookup.py`.

## 1. Decode a hoist

Sighted: `CB` over `6` on one halyard.

- `CB` = "I require immediate assistance." Complement `6` per Table 2 = towing.
- Answer: **"I require immediate assistance: towing."**
- Reply sequence as receiver: answering pennant at the dip on sighting → close up once decoded. If instead you can see it but not decode it: keep at the dip and hoist `ZL`.

## 2. Compose: disabled vessel requesting a doctor rendezvous

Situation: engine room casualty, need medical help, will divert toward the nearest port, 6 hours out.

```
W                    I require medical assistance          (single letter, any method)
AN                   I need a doctor                       (two-letter, Distress—Emergency)
MAD 6                I am 6 hours from the nearest port    (medical code + figure)
MAE                  I am converging on nearest port
```

By radiotelephony this is urgency, not distress: `PAN PAN` ×3, identity, then `INTERCO Whiskey / Alfa November / Mike Alfa Delta UNAONE... ` — or plain language if no language barrier (the Code defers to plain language whenever it works).

## 3. Flag hoist with substitutes

Signal your position report time `T1100`:

```
$ python3 ../scripts/icos_lookup.py hoist T1100
1. Tango
2. numeral pennant 1
3. first substitute (repeats 1)
4. numeral pennant 0
5. third substitute (repeats 0)
```

The third substitute (not second!) repeats the `0` because substitutes count as positions within the numeral class — Ch.1 §5 ¶6.

## 4. Flashing-light exchange, end to end

```
TX: AA AA AA ...         general call            RX: TTTT ...   answering
TX: DE GABC              from GABC               RX: DE GABC    (repeats back) DE GXYZ
TX: YU                   code groups follow
TX: NC                   distress, immediate assistance   RX: T   (group received)
TX: AR                   ending                  RX: R          received
```

Mid-message error: TX sends `EEEEEE`, RX answers `EEEEEE`, TX resumes from last correct word. RX missed a stretch: `RPT AB NC` = repeat all before group `NC`.

## 5. Modality operators

- `CW` = "Boat/raft is on board." → `CW RQ` = *"Is boat/raft on board?"*
- `CY` = "Boat(s) is(are) coming to you." → `CY N` (visual/sound) or `CY NO` (voice/radio) = *"Boats are NOT coming to you."*
- Illegal: `V RQ` — modality operators never combine with single-letter signals.

## 6. Agent-protocol transfer (mechanism → design)

Designing a fleet halt: ICOS allocates the *shortest* codes to the most urgent meanings and separates transport-ack from semantic-ack. So: a one-token reserved `HALT` interrupt (analog of `L`/`X`), a two-phase receipt (`delivered` ≠ `parsed-and-understood`, the answering-pennant dip/close-up), and a schema NAK distinct from retransmission request (`ZL` vs `RPT`). Full mapping: `references/agent-protocol-adaptation.md`.

## 7. pd symbology audit (folklore detection)

Claim under review: "R flag = the way is off my ship."

```
$ python3 ../scripts/icos_lookup.py code R
R  [procedure]
  'Received' or 'I have received your last signal'.
```

No single-letter allocation → the gloss is 1931-code folklore; keep it out of tooltips that cite ICOS. Honest alternatives for an "inform" state: a two-letter group, or reserve R visually without claiming a book meaning. Full audit table: `references/port-daddy-symbology.md`.
