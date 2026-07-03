# Example Output

## Product Promise

Build a project planner for AI-assisted builders who need a concrete execution plan before spawning agents.

## Cold Start

- First screen shows a sample plan and an "import idea" action.
- Account creation supports email magic link and local demo mode.
- Missing provider fallback uses mocked agent output plus a bring-your-own-key setup panel.

## Build Slices

| Slice | Acceptance Gates | Proof |
| --- | --- | --- |
| Intake and plan schema | Manifest validates and empty state renders. | Unit test and screenshot. |
| Plan scorer | Missing cold-start and rollback gates fail the score. | Focused Jest output. |
| Review loop | Reviewer produces must-fix and can-build-with-risk findings. | Review transcript. |

## Scorecard

```json
{
  "score": 92,
  "pass": true,
  "missingRequiredSections": [],
  "criticalGaps": []
}
```
