# Human-in-the-loop

Primary source read 2026-09-24: [Cloudflare human-in-the-loop patterns](https://developers.cloudflare.com/agents/concepts/agentic-patterns/human-in-the-loop/), including pattern selection, Workflow waits, timeout handling, agent approve/reject methods, Code Mode approval, and MCP elicitation. The pause location determines authority and lifetime. First check existing standing authorization; create a new approval gate only when the requested effect is outside that authority or an applicable policy requires a new decision.

| Pattern | Boundary and lifetime | Current API direction |
| --- | --- | --- |
| Workflow approval | Durable application work; can wait months or longer | waitForApproval(step, { timeout }) |
| Code Mode approval | Connector call from model-generated code | requiresApproval, approve(), reject() |
| MCP elicitation | MCP client request/structured input | configureElicitationHandlers() |
| Browser-owned action | Browser tool/client authority | application-specific client handler |

## Durable workflow gate

    class ExpenseWorkflow extends AgentWorkflow<ExpenseAgent, { amountMinor: number; requestedBy: string }> {
      async run(event, step) {
        const validated = await step.do("validate", async () => {
          // Local fixed-currency minor-unit example; no floating-point money.
          if (!Number.isSafeInteger(event.payload.amountMinor) || event.payload.amountMinor <= 0)
            throw new Error("invalid amount");
          // Resolve requestedBy from authenticated context at ingress, not a
          // caller-supplied self-asserted identity. Validate remaining fields.
          return event.payload;
        });
        const approval = await this.waitForApproval<{ approvedBy: string }>(step, {
          timeout: "7 days",
        });
        if (!approval) {
          await step.reportError("approval timed out");
          throw new Error("approval timeout");
        }
        return step.do("process", () => processBoundApproval(validated, approval));
      }
    }

The published pattern includes agent methods that call approveWorkflow/reject counterparts. Exposing such a method with callable does not authenticate the approver: resolve principal identity from the authenticated session, authorize it for the workflow/action, and make repeated approve/reject delivery idempotent.

## Approval record and replay boundary

An application record should bind workflow/action ID, canonical action digest, affected resource, principal, decision, expiry, and use state. The application helper `processBoundApproval` must recheck the action digest, current principal authority, decision/expiry and atomic use state immediately before effect, and bind a provider idempotency key and receipt. That helper is a required implementation boundary, not an SDK-provided verifier. A chat confirmation, stale UI, or approval for changed parameters is not authority for a new action. Preserve timeout, denial, duplicate decision, lost access, modified parameter, and post-approval provider-failure tests.

Examples are illustrative and untypechecked. No person, Workflow, connector, MCP client, or browser action was invoked.
