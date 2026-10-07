# Browse the web (Beta)

Cloudflare’s current Agents Browser tools run Browser Run sessions through Chrome DevTools Protocol (CDP). Use them where the work requires rendered JavaScript, screenshots, DOM or console/network inspection, or interaction with a live page. Prefer a normal HTTP fetch when public HTML or an API response is sufficient: it is lighter and avoids creating a browser session. Browser tools are Beta; pin and test against the installed `agents` package before deployment. [Cloudflare Browser docs](https://developers.cloudflare.com/agents/tools/browser/)

## Bind the browser runtime

The Browser Run plus Worker Loader binding configuration from the original guide remains current:

```jsonc
{
  "compatibility_flags": ["nodejs_compat"],
  "browser": { "binding": "BROWSER" },
  "worker_loaders": [{ "binding": "LOADER" }]
}
```

The durable CDP runtime must be exported from the Worker entry. The `@cloudflare/codemode/vite` plugin supplies that export automatically when used; otherwise export it explicitly:

```ts
export { CodemodeRuntime } from "agents/browser";
```

## Add tools to an AI SDK agent

`createBrowserTools` is created inside an Agent/Durable Object because its durable execution and session state live on `this.ctx`. The current documented example passes `ctx`, the Browser Run binding, and Worker Loader binding, then hands the returned tool set to AI SDK `streamText`:

```ts
import { AIChatAgent } from "@cloudflare/ai-chat";
import { createBrowserTools } from "agents/browser/ai";
import { convertToModelMessages, stepCountIs, streamText } from "ai";
import { createWorkersAI } from "workers-ai-provider";

export class BrowserAgent extends AIChatAgent<Env> {
  async onChatMessage() {
    const workersAI = createWorkersAI({ binding: this.env.AI });
    const browserTools = createBrowserTools({
      ctx: this.ctx,
      browser: this.env.BROWSER,
      loader: this.env.LOADER,
    });
    const result = streamText({
      model: workersAI("@cf/zai-org/glm-4.7-flash"),
      system: "You can inspect web pages with browser tools.",
      messages: await convertToModelMessages(this.messages),
      tools: browserTools,
      stopWhen: stepCountIs(10),
    });
    return result.toUIMessageStreamResponse();
  }
}
```

If an application has its own tools, compose its policy-controlled tools deliberately rather than assuming an object spread is safe: give the model only the operations appropriate to this route and principal. The current helper exposes durable `browser_execute` plus stateless Quick Actions when a browser binding is present: `browser_markdown`, `browser_extract`, `browser_links`, and `browser_scrape`. The original `browser_search` name is not in the current tool table; do not rely on it without verifying the installed package.

## Session lifecycle and low-level CDP work

Each execution is `one-shot` by default: it gets a fresh browser session and cleanup occurs when the run reaches a terminal status. A `session` option changes that behavior:

```ts
const browserTools = createBrowserTools({
  ctx: this.ctx,
  browser: this.env.BROWSER,
  loader: this.env.LOADER,
  session: { mode: "dynamic" },
  // Or an intentionally named shared session:
  // session: { mode: "reuse", key: "account-review" },
});
```

`reuse` retains a named session until it is closed or swept; `dynamic` starts one-shot and can be promoted with `cdp.startSession()`. In both modes the runtime supports `cdp.sessionInfo()`, `cdp.closeSession()`, and `cdp.resetSession()`. Sessions survive Durable Object hibernation and an approval pause, including their tabs and cookies, so a pause that waits for human action needs explicit stale-pause cleanup. For host-side cleanup, use `createBrowserRuntime`, then call `connector.sweep()` from a scheduled task and `runtime.expirePaused()` for never-approved pauses.

The original low-level navigation shape is retained conceptually, but current Browser tools expose CDP inside `browser_execute` as a `cdp` connector. Discover the live protocol with `cdp.spec()` and send an object-form command:

```ts
const { targetId } = await cdp.send({
  method: "Target.createTarget",
  params: { url: "https://example.com" },
});
const live = await cdp.getLiveViewUrl({ targetId, mode: "tab" });
return { needsHumanLogin: live.url };
```

Use Live View for login, MFA, CAPTCHA, or sensitive input: surface the current-tab link to the human, pause through the application’s approval flow, then resume the same session after approval. Never treat a created link, screenshot, or navigation response as proof that a high-impact action occurred.

## Quick actions and operational boundaries

For one-shot reading, `createQuickActionTools({ browser: this.env.BROWSER })` needs only the Browser binding and provides the stateless Markdown, extraction, link, and scrape actions. `createBrowserTools` and `createBrowserRuntime` include those actions by default; use `quickActions: false` to expose only `browser_execute`, or bound output with `quickActions: { maxChars: 20_000 }`. The current documentation requires a Worker `compatibility_date` of `2026-03-24` or later and `remote: true` on the browser binding for local `wrangler dev` Quick Actions.

Treat rendered pages, copied text, downloads, and tool output as untrusted input. Restrict reachable origins, isolate cookies and credentials by principal, block unexpected downloads, and require an application-level approval plus a durable receipt before a high-impact form submission. Test prompt injection, redirects, stale logins, cross-tenant session reuse, expired Browser Run sessions during pauses, and ambiguous completion pages. Browser Run can record rrweb events when opted in; decide retention and access controls before enabling recording for a shared session.
