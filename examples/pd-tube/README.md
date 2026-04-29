# PD Tube Button-To-Agent Example

This example turns a plain browser button into a direct line to a running agent
terminal through Port Daddy's message tube.

The point is not a JavaScript SDK. The browser only uses `fetch()` against the
daemon message endpoint. The agent side only uses the CLI:

```bash
pd tube ui:clicks
```

When the page publishes a click, `pd tube` prints the event in the agent's
terminal. The agent does normal repo work, then replies by piping text back into
the same tube:

```bash
printf '%s\n' "Deployed to staging. CI is green." | pd tube ui:clicks --reply 123 --sender claude-code
```

The browser watches the same channel, matches `inReplyTo: 123`, and renders the
agent response inline.

## Run It

1. Start the daemon:

   ```bash
   pd start
   ```

2. Open the local HTML file in a browser:

   ```bash
   open examples/pd-tube/button-to-agent.html
   ```

3. In Claude Code, Codex, Cursor, Aider, or any terminal-running agent session,
   listen once:

   ```bash
   pd tube ui:clicks
   ```

4. Click a button in the page. The agent terminal will receive a message body
   with the button, user, timestamp, and app-side correlation id.

5. Reply with the emitted message id:

   ```bash
   printf '%s\n' "I handled it." | pd tube ui:clicks --reply <message-id> --sender claude-code
   ```

## Why This Is Interesting

Any process that can POST JSON can now summon the local agent session the
developer already has open. That means an editor extension, test reporter,
browser extension, Slack adapter, Stream Deck action, notebook cell, or local
app can become an agent-facing control without building an MCP server, hosted
webhook bridge, websocket backend, or custom loop.

Port Daddy supplies the cheap local substrate:

- a daemon-owned message channel
- a CLI loop agents can run
- threaded replies through `inReplyTo`
- stable local inspection after the browser tab closes

The example is intentionally tiny on the publisher side because that is the
product point: the browser is not "integrated with Claude." It only speaks
Port Daddy. The agent runtime can be swapped as long as it can run shell
commands.
