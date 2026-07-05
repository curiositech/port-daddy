# Medical Signal Code (Pub. 102, Chapter 3)

The three-letter `M**` tier: 445 signals enabling a master with no medical training and a doctor with no shared language to run a remote consultation. Full corpus in `data/signals.json` → `medical_code` (sections `REQUEST FOR MEDICAL ASSISTANCE`, 327 signals, and `MEDICAL ADVICE`, 118 signals).

## Why It Matters as Protocol Design

This is a 1965 solution to *structured telemedicine over a lossy, low-bandwidth, cross-language channel*. Its moves — a fixed case-description schema, enumerated vocabularies for body regions/diseases/drugs, an explicit "your message doesn't parse, resend in standard form" NAK — predate and prefigure structured clinical messaging.

## Roles and Contract

- **Masters** describe the case using the standard order of Section 2; they never guess at diagnosis beyond `MQE`-style structured fields.
- **Doctors** answer with Section 3 signals; instructions reference the same tables the master used.
- Parse failure has a dedicated signal: `MQB` = "I cannot understand your signal; please use standard method of case description." (A schema-validation NAK, 1965 edition.)

## Case-Description Schema (Section 2 order)

1. **Request** — `MAA` I request urgent medical advice · `MAB` request rendezvous at position · `MAC` request you arrange hospital admission · `MAD` I am (n) hours from nearest port · `MAE`/`MAF` converging on / moving away from nearest port.
2. **Description of patient** — sex, age, occupation aboard, prior state.
3. **Previous health** — e.g. `MBB` patient has had previous operation (Table M-2 names it).
4. **Localization** — where on the body: signals take a Table M-1 complement; `MBE` = "the whole body is affected."
5. **General symptoms** — temperature, pulse, respiration, sweating, consciousness, pain (`MDF` patient is in pain — Table M-1 locates it).
6. **Particular symptoms** — the long tail: bleeding, burns (`MGG` superficial / `MGH` severe, located by Table M-1), poisoning (`MGI`–`MGO` distinguish corrosive vs non-corrosive vs unknown, and whether an emetic was given and worked), bites, discharges, fractures, mental state.
7. **Progress report** — better / worse / unchanged since last signal.

## Advice Schema (Section 3)

- **Request for more info** — `MQC` please answer the following question(s); `MQB` NAK above.
- **Diagnosis** — `MQE` my probable diagnosis is... (Table M-2 disease code).
- **Special treatment** — positioning, compresses (`MRP` apply ice-cold compress, renew every n hours), baths (`MSJ` place patient in hot bath), and procedures.
- **Treatment by medicaments** — `MTD` you should give... (Table M-3 drug list); dosing signals down to spoon calibration: `MTF` = "you should give one tablespoon (15 ml)".
- **Diet** — e.g. `MUC` give water only in small quantities.
- **Childbirth, vaccination, general instructions** — dedicated blocks.

## The Three Medical Tables (Section 4)

| Table | Contents | Used by |
|---|---|---|
| M-1 | Regions of the body, numbered, front and back plates | Localization and symptom signals |
| M-2 | List of common diseases, numbered | `MBB` previous operation, `MQE` diagnosis |
| M-3 | List of medicaments, numbered (a standardized ship's medicine chest) | `MTD` and dosing signals |

The tables are the shared ontology; the M-signals are verbs and relations over it. A consultation is a sequence of (signal, table-coordinates) tuples — legible to both parties in their own printed edition of the book, in their own language.

## Worked Shape of an Exchange

```
Master:  MAA                      request urgent medical advice
         MSD 25                   (patient data signals: male, age 25 — per Section 2 order)
         MDF 30                   patient in pain, region 30 (Table M-1: abdomen region code)
         MFE ...                  particular symptoms as applicable
Doctor:  MQC                      please answer the following
         (question signals)
Master:  (answer signals)
Doctor:  MQE 26                   probable diagnosis: Table M-2 item 26
         MTD 14                   give medicament: Table M-3 item 14
         MTF                      one tablespoon
Master:  (progress signals daily)
```

(Illustrative composition; verify each group with `icos_lookup.py code M..` before use — the schema order is normative, the specific patient-data codes vary.)

## Anti-Pattern: Skipping the Standard Order

**Novice**: leads with the dramatic symptom and improvises the rest, assuming the doctor will ask for whatever is missing.
**Expert**: the Section 2 order (request → patient → history → localization → general → particular) *is* the message format; the receiving doctor decodes against that order, and round-trips cost tens of minutes each over flags or W/T. Front-loading the full schema minimizes round-trips; the Code even budgets for the failure with `MQB`. Same law as any high-latency protocol: spend bandwidth to save round-trips.
