# MCP integration

Cloudflare Agents can connect to MCP servers as clients, discover tools/resources/prompts, and pass compatible tools to an AI SDK call. They can also expose a server. The current server guidance has two distinct paths: new servers use stateless `createMcpHandler` with `@modelcontextprotocol/server`; the stateful `McpAgent` path remains for legacy migration and is deprecated and feature-frozen. [MCP client API](https://developers.cloudflare.com/agents/model-context-protocol/apis/client-api/), [MCP handler APIs](https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api/), and [transport](https://developers.cloudflare.com/agents/model-context-protocol/protocol/transport/).

Treat every remote endpoint, MCP description, schema, resource, prompt, and tool result as untrusted input. Do not let a model or a request parameter choose an arbitrary server URL, and do not forward bearer, Access, user, or OAuth credentials to an endpoint that has not been authorized for that exact credential audience.

## Connect an MCP server

`addMcpServer()` persists a connection in the Agent's SQL storage. It is idempotent when the HTTP server name and normalized URL match an active connection, so it can be installed from `onStart()` without duplicate recovery rows. A caller-supplied stable `id` makes tool keys and storage records readable; do not reuse a stable ID for a different name/URL pair.

```ts
import { Agent, callable } from "agents";

export class ToolAgent extends Agent<Env> {
  async onStart() {
    // URL and token are deployment-controlled allowlisted configuration, not user input.
    await this.addMcpServer("catalog", this.env.CATALOG_MCP_URL, {
      id: "catalog",
      transport: {
        type: "streamable-http",
        headers: { Authorization: `Bearer ${this.env.CATALOG_MCP_TOKEN}` },
      },
      retry: { maxAttempts: 3, baseDelayMs: 500 },
    });
  }

  @callable()
  async connectGitHubForCurrentPrincipal() {
    // Application helper: authenticate caller and require current instance ownership.
    await requireCurrentInstanceOwner(this);
    const result = await this.addMcpServer(
      "github",
      "https://api.githubcopilot.com/mcp/",
      { id: "github", callbackHost: this.env.PUBLIC_ORIGIN },
    );

    if (result.state === "authenticating") {
      // Return this only to the authenticated initiating application route.
      // The OAuth provider, not the model, owns the user authentication page.
      return { state: result.state, authUrl: result.authUrl };
    }
    return { state: result.state, id: result.id };
  }
}
```

GitHub documents its remote endpoint at `https://api.githubcopilot.com/mcp/`; client authentication support must be checked for the chosen host. [GitHub setup](https://docs.github.com/en/enterprise-cloud%40latest/copilot/how-tos/provide-context/use-mcp-in-your-ide/set-up-the-github-mcp-server). The `requireCurrentInstanceOwner` helper is application code; a shared multi-principal instance also needs separately keyed credential storage and callback binding.

For an OAuth server, the documented client flow returns `authUrl`, directs the authenticated initiating user to the provider, then completes through the Agent callback. The built-in `DurableObjectOAuthClientProvider` stores a nonce and server ID, validates the callback, and cleans up on use or expiration. If `sendIdentityOnConnect: false`, set a custom `callbackPath` and route it to the authenticated instance to avoid exposing an instance name in the default callback URL.

The SDK blocks private/internal, link-local, unspecified, metadata, and mapped-private URL targets to reduce SSRF risk. Loopback is allowed for local development, which is not production authorization. For a production internal service, use the RPC binding path below rather than HTTP. Never accept an arbitrary endpoint, redirects from it, or headers supplied with it as authorization to send a credential.

## Use MCP tools with a configured model

`this.mcp.getAITools()` converts current MCP schemas into AI SDK tools and namespaces tool names by server ID. Use raw catalog APIs for inspection; pass a narrowed ready-server tool set to the model. `configuredModel` below is intentionally application-selected rather than a hard-coded model recommendation.

```ts
import { streamText } from "ai";

// `configuredModel` is supplied by this application's model-policy layer;
// this example deliberately makes no model/vendor recommendation.
const mcpTools = this.mcp.getAITools({ state: "ready" });
// Application helper: derive current principal/scope, filter exact operations,
// and reject colliding names instead of silently replacing a local tool.
const admittedTools = await authorizeAndCombineToolSets(this, localTools, mcpTools);
const result = streamText({
  model: configuredModel,
  messages: await convertToModelMessages(this.messages),
  tools: admittedTools,
});
return result.toUIMessageStreamResponse();
```

Tool namespacing prevents same-named server tools from silently colliding, but it does not establish semantic safety. Filter to the server IDs and operations the route is permitted to expose, and bind a high-impact MCP call to an application authorization decision plus an effect receipt.

## Inspect servers, tools, resources, and prompts

The old `listServers()` call is superseded by `getMcpServers()`. Current catalog methods retain the original resource-discovery intent:

```ts
const state = this.getMcpServers();
const catalogTools = this.mcp.listTools({ state: "ready" });
const resources = this.mcp.listResources({ state: "ready" });
const prompts = this.mcp.listPrompts({ state: "ready" });
const templates = this.mcp.listResourceTemplates({ state: "ready" });

for (const [id, server] of Object.entries(state.servers)) {
  console.log({ serverId: id, state: server.state }); // No protected URL or credentials.
}
```

`getMcpServers().tools`, `.resources`, and `.prompts` expose the aggregate discovered catalog. `listTools`, `listResources`, `listPrompts`, and `listResourceTemplates` accept the same server ID/name/state filter. A catalog listing is discovery evidence, not permission to read a resource or invoke a tool.

## Remove or replace a server

```ts
const current = this.getMcpServers().servers[serverId];
if (current) {
  await this.removeMcpServer(serverId);
}
```

`removeMcpServer(id)` disconnects and removes the registration from storage. Adding the same name with a different URL keeps both HTTP connections active and merges their tools, so remove the old server deliberately when the intent is replacement.

## Build a new stateless MCP server

New servers should use `createMcpHandler`. Cloudflare's handler API currently documents `agents`, `@modelcontextprotocol/server@2.0.0`, and `zod` for this path. Pin the package versions required by the installed Agents release before changing an existing deployment; the documentation does not establish cross-version interchangeability.

```bash
npm i agents @modelcontextprotocol/server@2.0.0 zod
```

```ts
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

function createServer() {
  const server = new McpServer({ name: "counter-server", version: "1.0.0" });
  server.registerTool(
    "nextInteger",
    { description: "Return the next integer without changing stored state",
      inputSchema: { amount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1) } },
    async ({ amount }) => ({ content: [{ type: "text", text: String(amount + 1) }] }),
  );
  return server;
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return createMcpHandler(createServer)(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
```

This path handles stateless Streamable HTTP. It has no protocol-level session; place durable business data behind an explicit storage boundary instead of assuming legacy session semantics survive the migration.

## Historical stateful `McpAgent` reference

The original durable counter/resource recipe, which lacks production authorization and duplicate-write handling, remains useful for an existing legacy server, but it must keep the legacy package. The current McpAgent API says an SDK v2 `@modelcontextprotocol/server` server cannot run inside `McpAgent`; use `@modelcontextprotocol/sdk@1.30.0` only when it matches the installed Agents release, when reading historical code. This recipe records the previous stateful API; do not introduce a legacy lane into a new implementation.

```bash
npm i agents @modelcontextprotocol/sdk@1.30.0 zod
```

```jsonc
{
  "durable_objects": {
    "bindings": [{ "name": "MyMCP", "class_name": "MyMCP" }]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["MyMCP"] }]
}
```

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";

type CounterState = { counter: number };

export class MyMCP extends McpAgent<Env, CounterState, {}> {
  server = new McpServer({ name: "counter-server", version: "1.0.0" });
  initialState: CounterState = { counter: 0 };

  async init() {
    this.server.resource("counter", "mcp://resource/counter", (uri) => ({
      contents: [{ uri: uri.href, text: String(this.state.counter) }],
    }));
    this.server.tool(
      "increment",
      "Increment the counter",
      { amount: z.number().default(1) },
      async ({ amount }) => {
        this.setState({ ...this.state, counter: this.state.counter + amount });
        return { content: [{ type: "text", text: `Counter: ${this.state.counter}` }] };
      },
    );
  }
}

export default MyMCP.serve("/mcp");
```

`McpAgent.serve("/mcp")` handles its Streamable HTTP path. SSE is historical context here, not a proposed fallback; this reference does not assert an unverified `serveSSE` signature. Follow the repository replacement policy: replace old paths and callers in the same slice. Build coexistence or migration lanes only when the operator explicitly requests them for that surface.

## Transport choices and internal RPC

| Transport | Current use | Compatibility boundary |
| --- | --- | --- |
| Streamable HTTP | New remote MCP endpoint through `createMcpHandler` | Current standard remote transport |
| SSE | Reading historical deployments | Deprecated; no new fallback lane |
| Durable Object RPC | Agent and legacy `McpAgent` within Cloudflare | Uses a binding, not public HTTP |

For a same-Worker integration, pass the Durable Object namespace binding, not a URL. The binding and `props` persist so the SDK can restore the connection after hibernation:

```ts
export class ChatAgent extends Agent<Env> {
  async onStart() {
    await this.addMcpServer("internal-counter", this.env.MyMCP, {
      id: "internal-counter",
      props: { tenantId: this.name },
      retry: { maxAttempts: 3, baseDelayMs: 500 },
    });
  }
}
```

For that RPC form, both Durable Object classes need bindings and SQLite migration entries in `wrangler.jsonc`; the legacy `McpAgent` section's config gives the one-server base, and a two-class configuration must add the Agent class as well. Props are initialization context, not authorization: validate tenant identity and scopes at every tool boundary.

## Retry, OAuth, and server security

`addMcpServer` accepts `retry: RetryOptions` for connection/reconnection. Current client documentation lists defaults of three attempts, 500 ms base delay, and 5 s maximum delay; explicit call-site values above avoid relying on a global default. Retrying a connection does not make a remote tool effect idempotent. Give tool handlers an application operation key and make retries, reconnects, and restored connections safe to replay.

For an MCP server protected with OAuth, the current Cloudflare examples use `@cloudflare/workers-oauth-provider` as the token-management, registration, and validation layer. The legacy route can be placed behind it as follows:

```ts
import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { MyMCP } from "./mcp";

export default new OAuthProvider({
  apiHandlers: { "/mcp": MyMCP.serve("/mcp") },
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  defaultHandler: AuthHandler,
});
```

Current Cloudflare pages show two OAuthProvider shapes: the McpAgent API uses `apiHandlers`, while the security guide shows `apiRoute` plus `apiHandler`. The example above follows the current McpAgent API page; verify the `@cloudflare/workers-oauth-provider` release paired with the installed Agents package before choosing either shape. Do not infer cross-version compatibility from either snippet.

When proxying a third-party OAuth provider, implement a real consent decision before forwarding upstream, bind OAuth state to the authenticated browser session, use CSRF protection, and issue scoped server credentials. Do not expose tokens or protected URLs in tool output, model-visible text, resources, prompts, or elicitation URLs. URL elicitation acceptance only records consent to open the URL; it is not proof that the external authorization or effect finished.
