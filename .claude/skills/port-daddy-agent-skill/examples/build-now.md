# Build Now

The Port Daddy agent skill should point users toward things they can build with
the repo today, not only coordination theory.

## Button To Agent

Use `examples/pd-tube/button-to-agent.html` to publish a browser click into a
local agent session. This is the smallest useful product demo: any browser
control can become a local work request.

Website route: `/examples/pd-tube-button-to-agent`

## Test Failure To Agent

Use `examples/test-reporter/test-failure-to-agent.ts` to wrap a failing command,
publish the failure, and let the agent respond with cause and next command.

Website route: `/examples/test-failure-to-agent`

## Editor Lightbulb

Use `examples/editor-lightbulb/explain-selection.html` to send selected code,
file context, and intent to the local agent.

Website route: `/examples/editor-lightbulb-to-agent`

## Webhook Adapter

Use `examples/webhook-adapter/local-webhook-to-agent.ts` to route Slack,
Discord, Linear, or generic webhook payloads into the local coordination bus.

Website route: `/examples/webhook-to-local-agent`
