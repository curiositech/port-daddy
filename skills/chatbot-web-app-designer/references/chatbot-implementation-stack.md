# Implementation Stack: A Live, Stateful Discovery Chatbot

For running this skill's process as an actual hosted chatbot (not manually), this is the stack and why.

## Agent runtime: Cloudflare Think harness
`@cloudflare/think` extends a single base class into a stateful agent backed by a Durable Object (one DO instance = one founder's discovery session). It handles the agentic loop (tool calls, iteration), streaming responses, and persistent memory (conversation tree stored in the DO's SQLite, with full-text search and non-destructive branching) — this is what makes the interview "stateful" across sessions rather than resetting each page load.

```js
// Minimal server shape
export class DiscoverySession extends Think {
  getModel() {
    return createWorkersAI({ binding: this.env.AI })("@cf/moonshotai/kimi-k2.6");
  }
  // Tools: propose_wireframe, update_node_graph, render_sitemap,
  // generate_prd, generate_design_system — each a function the model can call
  // that writes to this DO's persisted state (see below), not just chat text.
}
```

```js
// Client
const { messages, sendMessage } = useAgentChat({ agent: "DiscoverySession" });
```

Requires: `@cloudflare/think`, `@cloudflare/ai-chat`, `ai` (v6/v7), `workers-ai-provider`, Durable Object bindings + migrations and an `AI` binding in `wrangler.jsonc`. Pick the Workers AI model based on what's actually available/performant at build time — don't hardcode a specific model ID into this reference, since Workers AI's catalog changes; check `wrangler ai models` or the dashboard for current options at implementation time.

**Model choice for rich, comfortable chat**: prefer a model with strong instruction-following and long context over the cheapest option — this is a low-volume (one founder, one session at a time), high-quality-bar conversation, not a high-throughput classifier. Latency and tone matter more than per-token cost here.

## Wireframe canvas: Excalidraw
`@excalidraw/excalidraw` embeds as a React component — no iframe, no external link-out. Its hand-drawn rendering style is deliberately the right register for a wireframe (see the "wireframes aren't final designs" anti-pattern in SKILL.md): it visually signals "this is structural, not final" in a way a clean/polished canvas wouldn't. Persist the scene as JSON (Excalidraw's native export format) in the Durable Object alongside the conversation, keyed per node in the feature graph — one Excalidraw scene per screen-node, not one giant shared canvas, so wireframes stay addressable and diffable as the graph evolves.

## Node-graph visualizer: React Flow
`@xyflow/react` renders the node-graph schema (see `node-graph-schema.md`) as an interactive, draggable graph — nodes colored/shaped by `type` (screen/feature/system), edges styled by `type` (navigates-to/depends-on/embeds) per the solid/dotted/thick convention. This is the live, explorable view during the interview; the Mermaid sitemap (below) is the static, shareable/embeddable artifact generated once locked.

## Sitemap: Mermaid, rendered client-side
The `mermaid` npm package renders Mermaid flowchart syntax directly in the browser — generate the diagram text from the locked node-graph (per the mapping in `node-graph-schema.md`) and render it in-app. This satisfies "written in Mermaid and rendered from that" without any external mermaid.live dependency, and keeps the sitemap as portable text that can also be pasted into the PRD document.

## Component polish: 21st.dev
Once the design-system phase (`design-system-handoff.md`) has produced palette/typography/dark-mode tokens, use 21st.dev's Claude Code plugin/MCP to generate the actual React components for the locked screens against those tokens, rather than hand-rolling every component from scratch. This is the last step, not the first — generating polished components before the design tokens exist means redoing them.

## Auth: password-protected entry
A single shared password gate (not full multi-user auth) is sufficient for a solo-founder discovery tool — implement as a Cloudflare Access policy in front of the route (zero app code, managed at the edge) if the tool is only ever used by one or two people, or a simple server-side session cookie set after a password check if Access isn't available in the target environment. Don't build a full user-account system for a tool with one intended user; that's scope the founder didn't ask for.

## Where this lives
Prefer adding this as a new route/Durable-Object-backed API within an existing deployed Next.js-on-Cloudflare-Workers app (via OpenNext) if one already exists for the operator, rather than standing up a wholly separate Worker — this keeps deployment, domain, and auth-gate configuration in one place.
