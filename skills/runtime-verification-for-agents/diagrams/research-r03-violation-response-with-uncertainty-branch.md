# R03 — Response follows the verified verdict

A recovered source is not itself a confirmed violation. Re-evaluate the property before selecting a separately authorized response. Reconciliation retries follow a declared bound; persistent uncertainty holds only effects whose controller policy requires a current verdict.

```mermaid
flowchart TD
 Result{Monitor verdict} -->|PASS| Record[Record scoped observation]
 Result -->|VIOLATION| Fresh{Evidence still current?}
 Result -->|UNKNOWN| Reconcile[Bounded source and baseline reconciliation]
 Fresh -->|No| Reconcile
 Fresh -->|Yes| Scope[Choose authorized response for affected scope]
 Scope --> Local[Notify owner or invoke owned recovery]
 Scope --> Hold[Controller holds required in-scope effects]
 Reconcile --> Ready{Sufficient consistent evidence?}
 Ready -->|Yes| Evaluate[Re-evaluate the property]
 Evaluate --> Result
 Ready -->|No or retry bound reached| Unknown[Keep UNKNOWN and apply declared hold policy]
```
