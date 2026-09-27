# Observability

Primary source read 2026-09-24: [Cloudflare Diagnostics channels](https://developers.cloudflare.com/agents/runtime/operations/observability/diagnostics-channels/), including typed/local subscriptions, raw Node diagnostics channels, Tail Workers, custom Observability, and event reference. Diagnostics expose structured runtime observations; they are not proof of a downstream effect.

## Subscribe locally

    import { subscribe } from "agents/observability";

    subscribe("agents:rpc", event => {
      // rpc and rpc:error; redact before exporting.
      recordDiagnostic({ channel: "agents:rpc", type: event.type });
    });
    subscribe("agents:state", event => {
      recordDiagnostic({ channel: "agents:state", type: event.type });
    });

The current page names agents:state (state:update), agents:rpc (rpc and rpc:error), agents:message (message/tool/Think submission lifecycle), schedule, lifecycle, workflow, MCP, email, fiber, recovery/context, and transcript channels. Raw subscription is also documented through node:diagnostics_channel.

## Tail Workers and custom handling

    export default {
      async tail(events: TraceItem[]) {
        for (const event of events) {
          for (const msg of event.diagnosticsChannelEvents) {
            forwardRedacted(msg); // timestamp, channel, and typed message
          }
        }
      },
    };

Cloudflare documents automatic production forwarding to an attached Tail Worker, so no Agent subscription code is required for that path. A custom Observability implementation can filter/emit per Agent:

    const observability: Observability = {
      emit(event) {
        if (event.type === "rpc:error") reportFailure(event.payload.method);
      },
    };
    class MyAgent extends Agent { override observability = observability; }

Use a correlation ID across accepted input, Agent state transition, fiber/queue/workflow record, and application effect receipt. Redact at the producer; diagnostic payloads must not become raw-data sinks. An rpc event, state update, Tail Worker receipt, or successful forward says the observation occurred, not that an external provider completed the intended task.

Snippets are illustrative and untypechecked; no Worker, Tail Worker, channel subscriber, or exporter ran.
