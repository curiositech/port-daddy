# Editor Lightbulb To Agent

This example is the smallest useful shape of an editor extension: select code,
press a local button, and send the selected file/range to the agent session
already running in the repo.

Run the agent side:

```bash
pd tube editor:explain
```

Open the publisher:

```bash
open examples/editor-lightbulb/explain-selection.html
```

Click **Ask agent about selection**. The page publishes a `selection.explain`
event to Port Daddy and waits for a threaded reply. The agent can inspect the
actual repo, explain the code, change files, run tests, and answer through:

```bash
printf '%s\n' "This function normalizes daemon URLs before fetch." | pd tube editor:explain --reply <message-id>
```

That is the extension story: the extension does not host an agent. It only
posts a local event and renders the local agent's response.
