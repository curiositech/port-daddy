# Routing Agents

**Primary source read 2026-09-24:** Cloudflare [Routing](https://developers.cloudflare.com/agents/runtime/communication/routing/) (URL grammar, default and custom routing, instance naming, identity, options, and API reference). The SDK routes a request to an Agent instance; it does not turn an instance name, URL segment, or credential-shaped query value into application authorization.

## Default URL pattern

The minimal handler below demonstrates routing only. A private deployment must authenticate and authorize both HTTP and WebSocket paths before routing; see the custom-route example for one server-selected private instance.

`routeAgentRequest()` recognizes the default route:

```text
/agents/{agent-name}/{instance-name}
```

Agent class names are kebab-cased in URLs. The router accepts both the declared class spelling and the kebab-case spelling for a client `agent` option.

| Agent class | Default path example |
| --- | --- |
| `Counter` | `/agents/counter/user-123` |
| `ChatRoom` | `/agents/chat-room/lobby` |
| `MyAgent` | `/agents/my-agent/default` |

Use an awaited routing result. The helper returns `Promise<Response | undefined>`; omitting `await` makes the null fallback ineffective and can return a Promise where a Response is required.

```ts
import { routeAgentRequest } from "agents";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const response = await routeAgentRequest(request, env);
    return response ?? new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
```

Subpaths after the instance name route to the Agent's `onRequest` handler. Use `buildAgentPath()` or `buildAgentUrl()` for a known nested Agent address rather than composing `/sub/` segments by hand:

```ts
import { buildAgentPath, buildAgentUrl } from "agents";

const address = [
  { className: "Inbox", name: userId },
  { className: "Chat", name: chatId },
];

const pathname = buildAgentPath(address, { leafPath: "/callbacks/job" });
const url = buildAgentUrl("https://app.example.com", address, {
  leafPath: "/callbacks/job",
});
```

## Custom paths with server-selected instances

`basePath` lets a browser connect to a custom URL. When the instance identity comes from a session, resolve it on the Worker rather than treating a browser-supplied name as authority. `getAgentByName()` must be awaited before using the stub. Returning the fetch Promise directly from an async handler is also valid; the explicit await below makes the request flow visible.

```ts
import { getAgentByName } from "agents";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/user" || url.pathname.startsWith("/user/")) {
      // Application-owned boundary: verify credential, expiry, and membership.
      const session = await requireAuthorizedSession(request, env.AUTH);
      if (!session) return new Response("Unauthorized", { status: 401 });

      // Do not derive this private name from an unverified query/path parameter.
      const agent = await getAgentByName(env.UserAgent, session.subject);
      return await agent.fetch(request);
    }

    // Do not expose this private class through a fallback /agents/... route.
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
```

`requireAuthorizedSession` is application code: it must verify the configured credential and decide whether the caller may access this Agent class and instance. The routing helper does not make that decision. If no such verifier is configured, reject the private route.

The matching client uses a custom path without placing the private instance name in the browser configuration:

```tsx
import { useAgent } from "agents/react";

function UserPanel() {
  const agent = useAgent({
    agent: "UserAgent", // required by the client API but ignored with basePath
    basePath: "user",
  });

  return <p>{agent.identified ? "Connected" : "Connecting…"}</p>;
}
```

The server sends the resolved identity after connection. `agent.identified` is reactive; if the Agent disables identity sending because its names are sensitive, it remains false and `agent.ready` never resolves. Use synchronized state or an application-safe display name in that case.

## Instance naming choices

Each unique name owns an isolated Agent with its own state. Choose a stable name from a server-verified scope:

| Scope | Name example | Result |
| --- | --- | --- |
| Per user | `user-${subject}` | separate state per verified subject |
| Shared room | `roomId` | all authorized room members share one instance |
| Application singleton | `"default"` | one intentionally global instance |
| Document/session | `doc-${documentId}` | state follows a verified document/session |

Names organize instances; they do not enforce tenancy. Apply membership/tenant checks before resolving the name and again inside any sensitive Agent method.

## Routing options

Both `routeAgentRequest()` and `getAgentByName()` accept documented routing options.

```ts
const response = await routeAgentRequest(request, env, {
  cors: {
    "Access-Control-Allow-Origin": "https://app.example.com",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  },
  locationHint: "enam",
  jurisdiction: "eu",
  props: { subject: session.subject, role: session.role },
  onBeforeConnect: async (upgrade) => authorizeUpgrade(upgrade, env.AUTH),
  onBeforeRequest: async (incoming) => authorizeHttp(incoming, env.AUTH),
});
```

Use an explicit allowed origin, methods, and headers for a cross-origin deployment rather than treating `cors: true` as an authentication boundary. Location hints are placement preferences; jurisdiction is a data-residency setting. Neither substitutes for authorization.

`props` are passed when the runtime initializes an Agent, including through `routeAgentRequest`:

```ts
export class UserAgent extends Agent<Env, UserState> {
  private subject?: string;

  async onStart(props?: { subject: string; role: string }) {
    this.subject = props?.subject;
  }
}
```

Validate and authorize the request before creating props. Props are initialization arguments, not a hidden trusted channel from a browser.

## Naming, routing, and identity changes

Use `onIdentityChange` when an authenticated session can switch to a different principal during reconnect. Clear local data tied to the old identity before displaying data from the new one.

The minimal UserPanel renders only connection identity status. A production view with user data must clear that state on identity change and refetch through the newly authorized connection; do not render data from the prior identity while reconnecting.

Do not log raw request URLs, session tokens, or full props in routing hooks. Log a fixed event purpose and a non-sensitive route class if operational evidence is needed.

## Common mistakes

- Forgetting `await routeAgentRequest(request, env)` or `await getAgentByName(...)`.
- Exposing a private Agent through the generic fallback route after protecting only its custom URL.
- Assuming a class name's URL spelling without allowing for kebab-case routing.
- Letting a browser choose a private instance name when the server already has a verified session identity.
- Treating CORS, `basePath`, location hints, props, or an identity callback as authorization.
- Waiting on `agent.ready` after opting out of `sendIdentityOnConnect`.

This reference validates the Cloudflare public API described above, not a deployed Worker, CORS policy, authentication implementation, or tenant model. Check the installed `agents` package and Worker configuration before deployment.
