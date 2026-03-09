---
title: Sugar Commands
description: One-line agent lifecycle with begin, done, and whoami
duration: 6 min
level: Beginner
---

# Sugar Commands

Sugar commands combine multiple operations into single calls -- the recommended way to start and end agent work sessions.

## begin -- Start Everything

```bash
pd begin "Building auth system"
```

This single command:
1. Registers you as an agent
2. Starts a new session
3. Writes context to `.portdaddy/current.json`

## done -- End Everything

```bash
pd done "Auth complete, tests passing"
```

This:
1. Ends the active session with a closing note
2. Unregisters the agent
3. Cleans up `.portdaddy/current.json`

## whoami -- Check Context

```bash
pd whoami
```

Shows your current agent ID, session ID, purpose, and claimed files.

## with-lock -- Run Under Lock

```bash
pd with-lock db-migrations -- npm run migrate
```

Acquires a lock, runs the command, releases on completion (even on failure).

## SDK Equivalent

```typescript
const pd = new PortDaddy();
const { agentId, sessionId } = await pd.begin({ purpose: 'Building auth' });
// ... do work ...
await pd.done({ note: 'Auth complete' });
```
