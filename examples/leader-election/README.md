# Leader Election With A Port Daddy Lock

This example shows a swarm of identical workers electing exactly one leader with
a Port Daddy distributed lock.

The useful part is not "leader election" as an abstract pattern. The useful part
is that every worker can run the same code. The first worker to acquire
`swarm:leader` enters the critical section. The rest become followers and keep
working without pretending they own the coordinator role.

## Run It

Start the daemon:

```bash
pd status
```

Run the example:

```bash
npx tsx examples/leader-election/leader-election.ts
```

Try a larger swarm:

```bash
npx tsx examples/leader-election/leader-election.ts --workers 8 --hold-ms 2500
```

## What It Demonstrates

- all workers start with the same code path
- only one worker acquires `swarm:leader`
- followers observe the held lock and continue as followers
- the leader releases the lock in `finally`
- a short TTL prevents a crashed leader from holding the role forever

Use this pattern when one local agent should coordinate a batch, write the final
summary, call a rate-limited API, or own a single scarce external side effect.
