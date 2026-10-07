# Durable execution with fibers

Primary source read 2026-09-24: [Cloudflare durable execution with fibers](https://developers.cloudflare.com/agents/runtime/execution/durable-execution/), including runFiber, startFiber, snapshots, recovery, inspection, cancellation, concurrency, and local testing. Fibers preserve recovery metadata across Durable Object eviction; they do not make an outside provider exactly-once.

## Inline fiber and complete checkpoints

    type ResearchSnapshot = {
      completed: string[];
      results: Record<string, unknown>;
      pendingSteps: string[];
    };

    // Method excerpts inside a configured Agent. executePureStep is an
    // application-owned deterministic computation with no external effect.
    async research() {
      const results = await this.runFiber("research", async ctx => {
        const steps = ["collect", "analyze", "summarize"];
        const completed: string[] = [];
        const results: Record<string, unknown> = {};
        for (const step of steps) {
          if (ctx.signal.aborted) throw new Error("computation cancelled");
          results[step] = await this.executePureStep(step);
          completed.push(step);
          ctx.stash({ completed, results, pendingSteps: steps.slice(completed.length) });
        }
        return results;
      });
      this.setState({ ...this.state, researchResult: results });
      return results;
    }

    async onFiberRecovered(ctx: FiberRecoveryContext) {
      if (ctx.name !== "research") return;
      // Application validator: allowed steps/order, completed/pending partition,
      // results shape, schema version, job binding and cancellation policy.
      const snapshot = parseAuthorizedResearchSnapshot(ctx);
      if (!snapshot) throw new Error("unusable research recovery snapshot");
      for (const step of snapshot.pendingSteps) {
        snapshot.results[step] = await this.executePureStep(step);
        snapshot.completed.push(step);
      }
      this.setState({ ...this.state, researchResult: snapshot.results });
      return { status: "completed" as const,
        snapshot: { ...snapshot, pendingSteps: [] } };
    }

This local sketch deliberately permits repeated pure computation during recovery.
It does not checkpoint within the recovery hook: another eviction may repeat the
remaining pure steps. Do not substitute email, payment, mutable reads or another
non-repeatable operation for `executePureStep`. The parser and step implementation
are application helpers, not SDK methods. Serialize distinct jobs or bind final
state to a job/version so one completion cannot overwrite another job's result.

ctx.stash(data) writes a JSON snapshot synchronously and replaces, rather than merges, the prior snapshot. The original closure and its return value do not survive eviction; recover from ctx.name, ctx.snapshot, and metadata. The source documents no automatic retry after a thrown callback. Multiple fibers may share a name and have independent snapshots, so a name is not a unique identity.

## Durable acceptance for background work

    const receipt = await this.startFiber(
      "reply-to-webhook",
      async ctx => {
        ctx.stash({ webhookId, threadId });
        await postReplyWithApplicationReceipt(threadId, webhookId);
      },
      { idempotencyKey: "webhook:" + webhookId, metadata: { threadId } },
    );
    if (!receipt.accepted) {
      // Earlier delivery already owns the retained fiber record.
    }
    const current = await this.inspectFiberByKey("webhook:" + webhookId);

startFiber returns managed status, not the callback result. waitForCompletion: true waits for a terminal fiber status. Cancellation is cooperative: inspect ctx.signal.aborted around expensive work and before visible effects; it cannot roll back a completed effect. Managed `startFiber` rows remain interrupted unless recovery resolves them with a `FiberRecoveryResult` or `resolveFiber`. Unmanaged `runFiber` rows are deleted after the recovery hook returns successfully; a thrown recovery leaves a row for a later scan. Therefore await recovery work and do not fire-and-forget a new fiber while discarding the old recovery handle. A shared name is not a transfer-of-ownership or deduplication key.

Checkpoint before a non-idempotent provider call, then consult an application receipt on recovery. Test eviction after a checkpoint, before a provider reply, and after provider acceptance with the reply lost. Illustrative code is untypechecked; no fiber, provider, or eviction test ran here.
