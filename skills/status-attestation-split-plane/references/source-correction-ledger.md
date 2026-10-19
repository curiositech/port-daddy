# Source and claim correction ledger

| Inherited claim | Disposition | Replacement |
|---|---|---|
| F0–F3 and A0–A4 as required tiers | Local descriptive labels only | They are not standards. Map actual common-mode failure domains. |
| Renderer must be F2+, F3 dead-man mandatory | Removed as universal prescription | Placement depends on threat model and shared deployment, identity, provider, network, and alert paths. |
| A3 anchor required in v1; A4 verifier | Replaced by custody/verification questions | A label does not prove an independent party retains or checks a commitment. |
| Quorum makes manipulation impossible | Narrowed | Quorum alone does not establish independence; specify authentication, freshness, Sybil/correlation model, and aggregation. |
| Fixed 7-day retention, 5s SLO, once-per-window dedup | Removed as defaults | No universal basis supplied; use service objectives, privacy, and load evidence. |

[NIST SP 800-137](https://csrc.nist.gov/pubs/sp/800/137/final) is organizational continuous-monitoring guidance, not a definition of these taxonomies or proof of independent anchoring.

## Root follow-up

| Inherited claim | Disposition | Replacement |
|---|---|---|
| Every timeout means unknown | Corrected | A functioning probe may observe a deadline violation; instrument failure is missing evidence. Interpret per capability and vantage point. |
| No client may gate on a monitor | Corrected | Specify dependencies per capability; current evidence may be required for consequential actions. |
| No boolean anywhere | Corrected | A result flag is acceptable inside a record that separately preserves validity, coverage, age and reason. |
| All tamper evidence requires an external head | Scoped by attack | Signatures provide integrity under key assumptions; retained checkpoints and cross-view comparison address additional truncation, rewrite and equivocation threats. |

The last four rows record root review corrections. Detailed source methods and local examples are in [observation and history verification](observation-and-history-verification.md).
