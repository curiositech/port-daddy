# Agent Labor Pricing Decision Brief

## Evidence label

- **Decision status**: [draft / revised / blocked]
- **Evidence scope**: [declared planning inputs; dated official price source; measured internal ledger]
- **Not established**: [market acceptance, runtime enforcement, demand, theorem property]

## Buyer, service, and metric

- **Buyer and authority**: [who decides and forecast horizon]
- **Service boundary**: [what is and is not included]
- **Buyer-facing value unit**: [unit and why it is predictable before commitment]
- **Seller cost unit**: [calls/tool/review basis; distinct from value unit]

## Model choice

| Chosen model | Why it fits | Rejected model | Reconsider if |
| --- | --- | --- | --- |
| [model] | [buyer/use distribution] | [model] | [observable condition] |

## Cost ledger and price points

| Component | Allocation rule | $ per unit | Source/date/status |
| --- | --- | ---: | --- |
| Model work | [calls and token basis] | | |
| Tools/compute | | | |
| Support/review/infra | | | |
| Collection/payment | | | |
| **Fully-loaded total** | | **[sum]** | |

| Tier | Base | Included unit | Excess-use treatment | Heavy-persona result |
| --- | ---: | ---: | --- | --- |
| | | | | |

## Guardrails and outcome policy

| Requirement | Declared state | Hand-check artifact |
| --- | --- | --- |
| Buyer cap | [true/false] | |
| Pre-commitment preview | [true/false] | |
| Per-task estimate | [true/false] | |
| Line-item receipt | [true/false] | |
| Outcome verifier / unknown policy | [not applicable or named] | |

## Stress report

Paste `pricing_stress.mjs` JSON and identify each blocked, negative, thin, retry, missing excess-treatment, and unknown-result case. `marginByPersona` is an array so every named input is preserved. A `pass` is static evidence limited to this input; default CLI output is report-only, while `--strict` turns `blocked` into exit status 2.

## Decision and next check

[Revision, rejection, or scoped draft decision.] Name the changed assumption and the event that requires a re-run.
