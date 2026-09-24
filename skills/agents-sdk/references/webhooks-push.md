# Webhooks and push notifications

Primary source read 2026-09-24: [Cloudflare Agents webhooks](https://developers.cloudflare.com/agents/communication-channels/webhooks/) plus current Agents navigation to push notifications. Webhook providers and Web Push are external protocols; SDK queue/state records do not authenticate ingress or prove a recipient saw a notification.

## Verified webhook ingress

    async onRequest(request: Request) {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
      const raw = await readBoundedBody(request); // app helper; one read, size limit
      const delivery = await verifyAndNormalizeWebhook(
        request.headers, raw, this.env.WEBHOOK_SECRET,
      );
      if (!delivery) return new Response("Unauthorized", { status: 401 });

      // Application transaction: inbox key + payload digest + outbox intent.
      // The key is scoped to provider, tenant and event ID, not just event ID.
      const accepted = await this.inbox.acceptWithOutbox(delivery);
      if (accepted.kind === "same-key-different-payload")
        return new Response("Conflicting delivery", { status: 409 });
      return Response.json({
        status: "durable_intent_recorded",
        operationId: accepted.operationId,
      }, { status: 202 });
    }

`readBoundedBody`, `verifyAndNormalizeWebhook` and `inbox.acceptWithOutbox` are
application-owned interfaces, not Agents SDK methods. The last operation requires
one transaction or equivalent atomic write: create the authenticated delivery key,
canonical payload digest and pending outbox intent together, or read the matching
prior record. A duplicate with different content must not reuse the first receipt.
No “accepted” response is issued before this durable intent exists.

A recovery dispatcher scans pending outbox rows and submits them to the execution
queue with the same application operation ID. Queue submission may repeat if the
dispatcher loses an acknowledgement; the consumer must atomically claim/reconcile
that ID and bind any provider-side idempotency key. Marking an inbox row before a
separate queue call is insufficient: a crash between the two can lose work.
Test before/after-commit crashes, duplicate deliveries and payload-key conflicts.

The verifier authenticates according to the provider contract, validates shape,
freshness/replay identity, intended Agent instance and authorized scope. Do not log
raw payloads or treat parsed data as trusted model instructions. Transactional
admission prevents lost local intent only under the actual tested store contract;
it does not make queue dispatch or a provider effect exactly-once.

## Push subscription and outcome boundary

    async subscribePush(request: Request, subscription: PushSubscription) {
      const principal = await authenticatedPrincipal(request); // app boundary
      await this.requirePushConsent(principal.id);
      await this.upsertValidatedSubscription(principal.id, subscription);
      return { status: "subscription_saved" };
    }

    async sendReminder(operationKey: string, subscriptionId: string) {
      // App admission resolves current recipient, endpoint version and consent,
      // then atomically binds them to this operation. Caller-supplied IDs alone
      // do not establish authority or justify an arbitrary destination.
      const permit = await this.admitPush(operationKey, subscriptionId);
      if (permit.kind !== "ready") return permit; // prior, denied, or unknown
      try {
        const providerResult = await sendVapidNotification(permit);
        await this.recordPushAttempt(operationKey, providerResult);
        return { status: "provider_result_recorded" };
      } catch {
        await this.recordPushUnknown(operationKey);
        return { status: "outcome_unknown" };
      }
    }

These are application interfaces and pseudocode-level policy boundaries. The
provider adapter, authenticated principal resolver, admission transaction, endpoint
validation and receipt implementations are not supplied by this example. Recheck
recipient eligibility at the actual sending boundary, including revocation while
queued. Do not retry an unknown send merely because the first response was lost.

Use an authorized principal/consent record and removal policy for endpoints. Package/VAPID invocation and provider response codes must be verified against the chosen push library at implementation time. A saved subscription is not delivery; provider acceptance is not evidence that a device displayed or read the push. Retain unknown response outcomes for readback/retry policy.

Examples are illustrative and package-untypechecked. No webhook, signature verifier, queue, VAPID package, subscription, or push provider ran.
