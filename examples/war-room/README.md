# War Room Example

A multi-agent incident response simulation using Port Daddy.

## What It Does

Three agents coordinate to investigate a production bug:

1. **Agent Alpha** (incident lead) -- coordinates the investigation
2. **Agent Bravo** (database investigator) -- checks database health and deployments
3. **Agent Charlie** (log analyst) -- analyzes error logs and stack traces

The agents communicate through a shared pub/sub channel (`bridge:warroom:incident`)
and record their findings as session notes. One agent discovers the root cause and
proposes a fix.

## Running

```bash
# Make sure port-daddy daemon is running
pd start

# Run the war room simulation
./examples/war-room/run.sh
```

## What to Observe

- **Agent registration**: Each agent registers with a semantic identity and purpose
- **Session notes**: Each agent records findings as immutable notes
- **Pub/sub messaging**: Agents share discoveries on a shared channel
- **Coordination**: The investigation follows a logical progression from symptoms to root cause
- **Cleanup**: All agents sign off cleanly when done

## After Running

Review the investigation trail:

```bash
# See all recent notes
pd notes --limit 20

# See channel messages
pd msg get bridge:warroom:incident

# See active agents (should be empty after cleanup)
pd agents
```

## Adapting for Real Use

Replace the scripted investigation with actual agent work:

```bash
# Register your agent
pd begin --agent my-agent \
  --identity myproject:api:hotfix \
  --purpose "Investigating auth regression"

# Add findings as you investigate
pd note "Found the issue in auth.ts:142 - missing null check"

# Share with the team
pd msg publish bridge:myproject:incident "Root cause found, deploying fix"

# Sign off when done
pd done --agent my-agent --summary "Fixed auth regression in PR #432"
```
