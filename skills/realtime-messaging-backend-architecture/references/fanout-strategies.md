# Delivery Fan-Out: Push vs. Pull

Read this when deciding how a new message actually reaches recipients —
this is a data-flow/architecture decision, separate from which transport
carries the bytes (see `websocket-realtime-expert` for the transport
layer itself).

## Fan-out-on-write (push)

Write the message once, then immediately push it to every recipient's
active connection(s). Simple to reason about, and sufficient for:

- **1:1 DMs** — always. There's at most one other active recipient
  connection set to push to; there's no scaling question here.
- **Group chat, moderate size / moderate simultaneous activity** — pushing
  to a few dozen or a few hundred live connections per message is cheap
  and keeps the client protocol simple (server tells you the moment a
  message exists).

## Fan-out-on-read (pull)

Store the message once; each client fetches it on its own cadence — on
reconnect, via a cursor/pagination request, or a lightweight poll — instead
of the server pushing to every member synchronously.

**Switch to this when** a group is very large or has many simultaneously
active members, such that one write would otherwise amplify into hundreds
or thousands of push events per message. That write amplification, not the
database, is usually what falls over first in a "everyone pushes to
everyone" design at scale.

There is no universal member-count threshold — the real crossover point
depends on your actual traffic (message frequency × concurrent active
members × push cost per connection). Instrument push volume per
conversation and let the data tell you, rather than picking an arbitrary
number up front.

## Design for switching, not for guessing right once

Model delivery strategy as a **per-conversation** attribute
(`conversations.delivery_mode`, see `examples/postgres_schema_example.sql`)
rather than a global assumption baked into the client protocol. This lets
you flip one hot, oversized conversation to pull-mode without a client
rewrite or a flag day for every conversation in the system. See the
anti-pattern in SKILL.md ("Uniform Fan-Out-On-Write Regardless of Group
Size") for what this looks like when it's missing.

## Hybrid: cheap notification, separate data fetch

A useful middle ground for large-but-not-huge groups: push a small
"new message exists in conversation X" event to live connections (cheap,
fixed-size payload, no message body), and let the client fetch the actual
message body/batch via the normal pull path. This decouples "tell everyone
something happened" (cheap, can stay push) from "deliver the full payload
to everyone" (expensive, can go pull) without redesigning the whole
delivery model at once.
