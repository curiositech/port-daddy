# Test Failure To Agent

This example is a tiny local test reporter. It runs a command, captures the
failure, publishes the failure to a Port Daddy tube, and optionally waits for the
agent's answer.

Run the agent side once in Claude Code, ChatGPT, Codex, Cursor, Aider, or any
terminal-backed agent:

```bash
pd tube dev:test-failed
```

Then run the reporter:

```bash
npx tsx examples/test-reporter/test-failure-to-agent.ts
```

By default the example runs a small failing Node command so the behavior is
visible immediately. To wrap a real test command, put it after `--`:

```bash
npx tsx examples/test-reporter/test-failure-to-agent.ts -- npm test -- --runInBand
```

For a non-blocking CI or pre-commit hook, publish the failure and return without
waiting for a reply:

```bash
npx tsx examples/test-reporter/test-failure-to-agent.ts --no-wait -- npm test
```

The code is intentionally plain TypeScript. A real Jest, Vitest, pytest, or
Playwright reporter would call the same `publishTube()` function when it sees a
failure.
