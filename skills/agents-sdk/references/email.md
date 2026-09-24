# Email handling

Agents send, receive, route, and reply to email through Cloudflare Email Service and the Agents SDK. Outbound delivery uses a `send_email` Worker binding. Inbound delivery requires a Cloudflare Email Service routing rule that sends mail to the Worker, then `routeAgentEmail` selects an Agent instance. [Email agent example](https://developers.cloudflare.com/agents/examples/email-agent/) and [Email channel guide](https://developers.cloudflare.com/agents/communication-channels/email/).

## Setup and bindings

Onboard a sending domain in Cloudflare Email Service, publish its required DNS records, add the Worker `send_email` binding, and configure an inbound routing rule to this Worker. The Agent Durable Object binding/migration remains required for an Agent class; the current Email Service binding replaces the original obsolete `destination_address` form.

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "durable_objects": {
    "bindings": [{ "name": "EmailAgent", "class_name": "EmailAgent" }]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["EmailAgent"] }],
  "send_email": [{ "name": "EMAIL", "remote": true }]
}
```

`remote: true` lets `wrangler dev` call the real Email Service API. It is not a test double: use a controlled recipient/domain for any development delivery. Store `EMAIL_SECRET` as a Wrangler secret only when secure reply routing is needed; it must not be committed as a variable.

## Receive, parse, and reply

`onEmail` receives `AgentEmail`, which provides sender/recipient addresses, headers, `rawSize`, `getRaw()`, `reply()`, `forward()`, and `setReject(reason)`. Parse raw MIME before using the subject or body, and treat fields and attachments as untrusted message content.

```ts
import { Agent } from "agents";
import { type AgentEmail, isAutoReplyEmail } from "agents/email";
import PostalMime from "postal-mime";

type EmailState = { acceptedCount: number };

export class EmailAgent extends Agent<Env, EmailState> {
  initialState: EmailState = { acceptedCount: 0 };

  async onEmail(email: AgentEmail) {
    // Application gate before MIME parsing: source/tenant policy and size ceiling.
    await authorizeInboundEnvelopeAndSize(this, email);
    const raw = await email.getRaw();
    const parsed = await PostalMime.parse(raw);
    if (isAutoReplyEmail(parsed.headers)) return;
    const subject = parsed.subject ?? "(no subject)";

    // Application transaction: inbox identity + exact reply payload + outbox intent.
    // Duplicate/conflicting inbound identities are handled before creating new work.
    const admission = await admitInboundAndReply(this, email, parsed, {
      fromName: "Support Agent",
      subject: `Re: ${subject}`,
      body: "Thanks for your email. We received it.",
      contentType: "text/plain",
    });
    if (admission.kind !== "new") return;
    // State is a small authorized projection, not raw sender/subject history.
    this.setState({ acceptedCount: admission.acceptedCount });
    await deliverAdmittedEmail(admission, () =>
      this.replyToEmail(email, admission.replyOptions));
  }
}
```

The named authorization/admission/delivery helpers are application contracts, not SDK APIs. They must reject malformed MIME and mailing-list/auto-reply traffic, bind tenant and payload digest to an inbound identity, persist a recoverable send intent, and preserve uncertain provider results instead of blindly retrying. The SDK does not supply these guarantees merely because this snippet names them. Keep raw sender/subject history in access-controlled storage under retention policy rather than broadcasting it as Agent state.

Do not automatically reply to auto-replies, mailing-list traffic, or malformed messages. Apply sender/tenant authorization before an inbound message changes records, sends a notification, or calls an external tool; an email `From` header alone is not an application identity proof.

`replyToEmail` requires the live `AgentEmail` object and therefore belongs inside `onEmail`. For a delayed response from a schedule, callable method, or approval completion, persist the sender, message ID, and subject, then call `sendEmail({ inReplyTo: messageId, ... })` from that later method.

## Send a new email

Use `sendEmail` for a new conversation. A `replyTo` mailbox must route back to this Worker if recipients should continue the same conversation. At least one of `text` or `html` is required by the documented send options.

```ts
import { callable } from "agents";

export class WelcomeEmailAgent extends Agent<Env> {
  @callable()
  async sendWelcomeEmail(to: string, requestId: string) {
    const message = {
      binding: this.env.EMAIL,
      to,
      from: "support@yourdomain.com",
      replyTo: "support@yourdomain.com",
      subject: "Welcome to our service",
      text: "Thanks for signing up. Reply to this email if you need help.",
    };
    // Application admission binds authenticated caller, recipient, payload and requestId.
    const admission = await admitAuthorizedOutbound(this, requestId, message);
    return deliverAdmittedEmail(admission, () => this.sendEmail(message));
  }
}
```

The current send shape also supports `html`, `cc`, `bcc`, `inReplyTo`, custom `headers`, and a `secret` for secure reply routing. Validate recipient and business authority before calling this method, use an operation key to suppress duplicate effects on retried requests, and avoid placing secrets or internal identifiers in the subject/body.

## Route inbound mail

`routeAgentEmail` is called from the Worker's `email` handler. Keep normal HTTP Agent routing in `fetch` when the Worker serves both channels:

```ts
import { routeAgentEmail, routeAgentRequest } from "agents";
import { createAddressBasedEmailResolver } from "agents/email";

export default {
  async email(message: ForwardableEmailMessage, env: Env) {
    await routeAgentEmail(message, env, {
      resolver: createAddressBasedEmailResolver("EmailAgent"),
      onNoRoute(email) {
        console.warn({ code: "email-route-missing" });
        email.setReject("Unknown recipient");
      },
    });
  },

  async fetch(request: Request, env: Env) {
    await requireAuthorizedAgentRoute(request, env); // Application gate before upgrade/data.
    return (await routeAgentRequest(request, env)) ?? new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
```

The resolver decides the Agent destination; the Email Service rule decides which inbound mail reaches this Worker. Reject or explicitly handle an unmatched recipient instead of silently converting it into a default tenant action.

## Resolver choices

### Address-based inbound routing

`createAddressBasedEmailResolver("EmailAgent")` maps recipient addresses to Agent names/instance IDs. It supports a default Agent class based on the local part and `agent+id@domain` routing for distinct Agent namespaces and instances:

```ts
import { createAddressBasedEmailResolver } from "agents/email";

const resolver = createAddressBasedEmailResolver("EmailAgent");
// support@example.com -> EmailAgent instance "support"
// NotificationAgent+user123@example.com -> NotificationAgent instance "user123"
```

Agent class matching in recipient addresses is case-insensitive because email infrastructure commonly lowercases addresses. This resolver maps delivery, not permission; ensure a recipient-derived instance ID cannot cross a tenant boundary.

### Secure replies

`createSecureReplyEmailResolver` verifies HMAC-SHA256 routing headers and their timestamp before returning an Agent route. Use it when an Agent initiates a conversation and replies must return to the same instance without trusting forgeable routing headers.

```ts
import { createSecureReplyEmailResolver } from "agents/email";

const secureReplyResolver = createSecureReplyEmailResolver(env.EMAIL_SECRET, {
  maxAge: 7 * 24 * 60 * 60,
  onInvalidSignature: (email, reason) => {
    console.warn({ code: "email-signature-invalid" }); // Do not log sender or raw input.
  },
});
```

The documented default `maxAge` is 30 days. Supply the same secret on an outbound `sendEmail` or `replyToEmail` to sign the routing headers:

```ts
await this.replyToEmail(email, {
  fromName: "Support Agent",
  body: "Thanks for your email.",
  secret: this.env.EMAIL_SECRET,
});
```

When mail arrived through the secure resolver, `replyToEmail` requires a secret or explicit `null` opt-out. Use the secret; `null` deliberately disables signing for that reply and should be an exceptional, audited policy decision.

### Distinct ingress policies; no invalid-signature fallback

A catch-all is appropriate only for a deployment-authorized shared inbox. Preserve its construction as a separate lane:

```ts
import { createCatchAllEmailResolver } from "agents/email";
const sharedInbox = createCatchAllEmailResolver("EmailAgent", "default");
```

Choose a resolver from authenticated deployment routing policy before processing the message. Never try secure replies and then fall through to address or catch-all routing on failure: that turns an invalid/expired signed reply into an unsigned tenant action. An unsigned new-message lane needs its own recipient/sender and tenant admission policy; it is not recovery for failed secure replies.

```ts
import { routeAgentEmail } from "agents";
import { createSecureReplyEmailResolver } from "agents/email";

export default {
  async email(message: ForwardableEmailMessage, env: Env) {
    // This Worker ingress is configured exclusively for signed conversation replies.
    await routeAgentEmail(message, env, {
      resolver: createSecureReplyEmailResolver(env.EMAIL_SECRET),
      onNoRoute: (email) => email.setReject("Reply route could not be verified"),
    });
  },
} satisfies ExportedHandler<Env>;
```

A valid routing signature identifies a route, not the current sender's authority to perform arbitrary actions. Recheck that authority in the admitted operation. Exercise invalid and expired signatures and prove neither reaches the address/shared-inbox lane.

## Lifecycle and safety checks

An email is an inbound Agent lifecycle event: raw bytes are retrieved with `getRaw`, parsed content is handled in `onEmail`, and delivery succeeds or rejects through the Email Service path. Before enabling production routing, exercise normal inbound mail, missing/malformed MIME, auto-reply suppression, unknown-recipient rejection, a valid signed reply, an expired/invalid signature, send failure/retry, and duplicate inbound delivery. Record the external message ID or application operation key before performing a non-idempotent downstream effect.
