# Source and claim correction ledger

| Inherited recommendation | Disposition | Replacement |
|---|---|---|
| Fixed sweep/poll intervals, clock tolerances, restart windows, crash counts | Removed as general thresholds | Choose from property, failure model, measured latency/cost, and deployment policy. A timeout indicates suspicion, not crash proof. |
| `100%` finite-corpus coverage as universal acceptance | Reframed | Report exact corpus, cases, omissions, and observed detection/false-positive results; a finite corpus is not all traces. |
| O(1)/O(active agents)/O(N) as general invariant costs | Removed as asserted complexity | Complexity depends on monitor state/property and implementation; measure pinned code. |
| Double-check then salvage, or always fail-closed/open | Replaced with property-specific recovery contract | Require fresh authoritative evidence for consequential remediation and separately define read/write behavior. |
| Arbiter alert described as prevention | Corrected | Detection is distinct from enforcement; prevention needs a fresh decision checked by an independent effect controller on every in-scope route. |
| Count monitor treated as a state invariant or as proof of append-only notes | Corrected | Distinguish a per-state predicate from a before/after action relation; counts establish only scoped count nondecrease, while identity/integrity require stronger event evidence. |
| Missing baseline silently initialized or a decrease becomes the next baseline | Corrected | Baseline establishment is explicit and bound to an authoritative active session; unknown stays unknown; a violating decrease never lowers the retained verified baseline; accepted increases persist through an exact-prior CAS before in-memory advancement. |
| Unknown evidence routed through violation event types | Corrected | Use declared `PASS`, `VIOLATION`, `UNKNOWN`, baseline, and retirement outcomes with separate audit event types. |
| NTP attributed as a count-decrease cause; fixed hourly alert policy | Removed as unsupported defaults | Trace the count source and comparison path; define incident aggregation and temporal ordering from local evidence and policy. |
| Historical `pd` CLI snippets | Kept with explicit non-execution label | Local runtime remains halted; snippets are examples only. |

The finite corpus and TLA+ examples are illustrative; no TLC run was performed. The local JavaScript adapter example was executed only against its zero-effect in-memory fixtures; no production storage, daemon, receipt signer, controller, or deployment was tested.
