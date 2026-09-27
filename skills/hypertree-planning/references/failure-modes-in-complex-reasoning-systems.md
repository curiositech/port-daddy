# HTP diagnostics: source observations and proposed controls

## Source-labelled ablation observation

For the paper’s GPT-4o TravelPlanner ablation, Table 3 reports 20.0 for HTP, 6.1 without division, and 8.3 without self-guided planning. This supports further investigation of those components in that configuration. It does not prove a universal failure taxonomy, a fixed chain-length threshold, or a single causal explanation.

## Diagnostic procedure

1. **Rule mismatch:** a selected leaf has no applicable rule. Record the leaf and keep it for content work or revise `R`.
2. **Pruning loss:** candidate count exceeds `W`. Log every candidate, filter policy, retained IDs, and reason.
3. **Incomplete outline:** a required concern is absent. Check rule coverage before content work.
4. **Leaf evidence gap:** a leaf needs current facts. Record allowed knowledge source and evidence before self-guided content.
5. **Integration conflict:** branches disagree on a shared constraint. Identify the constraint and re-open the affected leaf/rule.

These are proposed engineering controls around the source procedure. They do not claim that an LLM has a particular attention failure or that any rejected outline caused an external effect.

## Constructed negative check

For `Plan -> {Route,Lodging}`, let Route cost 800 and Lodging cost 500 against budget 1000. Each leaf can be internally plausible; the combined candidate fails. The correct result is `integration_failed`, not “parallel branches succeeded.”
