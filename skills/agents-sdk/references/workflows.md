# Agents and Workflows

API snapshot checked 2026-09-24 against [Run Workflows](https://developers.cloudflare.com/agents/runtime/execution/run-workflows/). Bind by environment binding name, not exported class name.

| Operation | Current shape / distinction |
|---|---|
| Start | `runWorkflow(binding, params, { id?, metadata?, agentBinding? })` returns ID |
| Event | `sendWorkflowEvent(binding, id, { type, payload })` |
| Refresh status | `getWorkflowStatus(binding, id)` |
| Stored tracking | `getWorkflow(id)`; `getWorkflows(criteria)` returns `{ workflows, total, nextCursor }` |
| Control | `pauseWorkflow(id)`, `resumeWorkflow(id)`, `terminateWorkflow(id)`, `restartWorkflow(id, options?)` |
| Approval | `approveWorkflow(id, options?)`, `rejectWorkflow(id, options?)`; Workflow `waitForApproval(step, options?)` throws on rejection |
| Tracking cleanup | `deleteWorkflow(id)` / `deleteWorkflows({ status: [...], createdBefore: Date })`; not cancellation |

`AgentWorkflow<AgentType, Params, ProgressType, Env>` exposes the originating agent as `this.agent`. Progress/broadcast notifications may repeat; durable step helpers report completion/error, send events, or update/merge/reset agent state. Agent callbacks `onWorkflowProgress`, `onWorkflowComplete`, `onWorkflowError`, and `onWorkflowEvent` receive binding name, instance ID, then their payload. Sub-agent tracking belongs to that child; `agentBinding` identifies its root binding. Controls require deployed validation; the documented local-development limitations matter.

## Choose by recovery needs

Use a durable workflow when restart-safe sequencing, waits, or scheduled retries are requirements. An arbitrary thirty-second threshold is not an architecture rule. A queue is appropriate only when its recovery, ordering and duplicate-execution behavior meets the job contract. Chat state, workflow state, and provider outcome are separate records.

## Durable work and repeatable notification

Adapted application sketch; `prepare` and `deliverWithApplicationReceipt` are application helpers, not SDK exports:

```typescript
import { AgentWorkflow } from "agents/workflows";
import type { AgentWorkflowEvent, AgentWorkflowStep } from "agents/workflows";
type Task = { requestId: string; operationKey: string; data: string };

export class ProcessingWorkflow extends AgentWorkflow<MyAgent, Task> {
  async run(event: AgentWorkflowEvent<Task>, step: AgentWorkflowStep) {
    const input = event.payload;
    const prepared = await step.do("prepare", () => prepare(input.data));
    await this.reportProgress({ step: "prepare", status: "complete" });
    const outcome = await step.do("deliver", () =>
      deliverWithApplicationReceipt(input.operationKey, prepared));
    await step.do("record-outcome", () =>
      this.agent.recordOutcome(input.requestId, outcome));
    await step.reportComplete({ requestId: input.requestId });
    return outcome;
  }
}
```

The delivery helper must recheck current authorization, bind the key to the exact payload, reconcile ambiguous provider outcomes, and make retried delivery safe. The agent's `recordOutcome` must accept duplicate equivalent receipts and reject conflicts. A crash after provider acceptance but before saving a step result must not create a second effect. Workflow completion alone does not demonstrate provider acceptance or completed delivery.

## Bindings and callbacks

Keep the exported class, Wrangler workflow binding, and start call consistent:

```jsonc
{
  "workflows": [
    { "name": "processing-workflow", "binding": "PROCESSING_WORKFLOW", "class_name": "ProcessingWorkflow" }
  ]
}
```

```typescript
// Agent method, after validation/authorization of the request:
const workflowId = await this.runWorkflow("PROCESSING_WORKFLOW", task, {
  id: task.requestId
});
```

This fragment omits the Agent binding and build setup; complete them with [configuration.md](configuration.md). Persist request-to-workflow identity before reporting admission to a client. Handle duplicate starts and uncertain start responses by checking the existing identity, not minting a new one. In callbacks, store lifecycle evidence under the supplied binding/instance identity; do not let a late progress callback overwrite a terminal effect receipt.

## Approval and control boundaries

An approval event is an input to a decision. Bind it to workflow ID, exact action digest, authenticated approver, scope, expiry and consumption record. Reject stale/replayed approval and recheck authorization immediately before effects. Do not combine an arbitrary `step.waitForEvent` event type with the SDK approval helpers and assume their envelopes match. A missing, timed-out, rejected or malformed approval never authorizes execution.

Cancellation/termination cannot roll back a provider effect already accepted. Restart may revisit external work; retain its operation identity and receipts. Test duplicate events, revocation after approval, lost clients, crashes between provider acceptance and durable recording, and callbacks after termination. These are application acceptance cases, not tests performed by this document.

Examples are illustrative and package-untypechecked. No Workflow, approval, event, Worker, or deployment was run.
