# Worked Example: Clarify an Ambiguous Data-Pipeline Request

This is a hypothetical policy walkthrough, not a measured outcome or validation of a scalar score.

## Scenario

A user asks: *"Set up the ETL thing so the dashboards update faster."* Before any decomposition or federation, the gate records the request version and checks fields needed for the proposed transition.

## Step-by-step application

**Step 1 — Record knowns and unknowns.**

| Field | Assessment | Evidence / question |
|---|---|---|
| Objective | Unknown | Which pipeline and dashboards? |
| Acceptance condition | Unknown | What refresh time counts as success? |
| Scope constraints | Unknown | May schemas, credentials, or schedules change? |
| Authority | Must be checked before any write | Which environment/account is in scope? |
| Rollback | Unknown | What recovery path is authorized? |

No confidence value or average determines this outcome. If the next stage would propose writes, unknown authority/scope blocks federation. A reversible read-only investigation can proceed only if explicitly authorized and bounded.

**Step 2 — Ask decision-changing questions.**

- Which pipeline and dashboards are in scope?
- What current and target refresh intervals are acceptable?
- Are schema, credentials, and schedule changes allowed?
- Which environment may be inspected or changed, and who approves rollback?

**Step 3 — Clarification and fresh assessment.**

Suppose the user says: *"The Redshift → dbt → Metabase pipeline. Dashboards currently refresh every 4 hours; target under 15 minutes. No schema changes. Inspect staging only; ask before any production write. Roll back the schedule change if validation fails."* Record this as a new input version, preserve the prior assessment, verify access/authority and the staging boundary, and rerun the gate. Decomposition can proceed only for that declared staging inspection and plan; production execution remains outside the supplied authority.

## Failure modes

- **Aggregate hides a hard blocker:** explicit unknown authority must still block a consequential transition even if all descriptive fields are clear.
- **Clarification reuses stale state:** cached outputs derived from the old request must be invalidated or version-checked before reassessment.
- **Read-only investigation widens silently:** enforce the stated environment and action limits at the tool/effect boundary.
- **Gate result is advisory only:** the caller must enforce a halt before creating DAG edges or dispatching work.
