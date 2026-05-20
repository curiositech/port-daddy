# Personal Agents — the fleet, off the leash

The Port Daddy fleet primitive was born in dev repos. The first agents
gardener, qa, spark, spider — were shaped by the gravitational well of
`git:committed`, because that's where the operator's attention was.
That's still good. The dev-repo fleet pays for itself a thousand times
over on any project with more than two contributors and a non-trivial
test suite.

But the primitive was never really *about* GitHub. The primitive is "a
declarative file describes a set of long-running agents; events flow in;
answers flow out; cost stays bounded." Strip the noun and you get a
shape that works in any room with an event source and an actuator. Your
inbox is an event source. Your calendar is both. A directory you write
notes into is an event source AND an actuator. Your phone, your
notifications, your home automation — every one of these is a place
where an always-on agent can be useful, if the engine doesn't insist
the agent live in a checkout.

So we widened the trigger surface. The fleet now ships with sources for
**email**, **SMS / iMessage**, **calendar**, **file-watch**, **generic
webhooks**, and the daemon's own **internal events**. The output sinks
got the matching treatment: **macOS notifications**, **calendar
creates**, **outbound email and SMS**, **arbitrary webhooks**, **file
writes**, and the internal **PD inbox/channel/note** writers. The
existing GitHub and git plumbing kept its place — the new shape is
strictly additive. A `pd-fleet.yml` written for a dev repo last week
still loads and still works.

The shape this unlocks is the one the operator's been after: **an
always-on personal fleet that lives outside any repo, runs on your
laptop, and quietly produces the small daily artifacts that make the
day go better.** Three examples make it concrete.

## Three use cases for the personal fleet

**Morning briefing.** A ship fires every weekday at 8am, plus on any
overnight newsletter your inbox surfaces. It reads your calendar, picks
the actionable lines out of last night's email digests, looks at
yesterday's briefing for continuity, and writes a one-screen markdown
file plus a single notification. By the time your coffee is made the
file is in your notes folder, the banner is on your lock screen, and
you know what to start with. The whole thing costs about 10 cents a day
at Claude Code rates. See [`fleet/ships/morning-briefing.md`](../../fleet/ships/morning-briefing.md).

**Commitment extractor.** A ship watches your outbound text — iMessage
on macOS, email everywhere else — and pulls the promises you make
("I'll send you that file Friday", "I'll loop back tomorrow") into a
durable journal plus a calendar reminder. It only watches OUTBOUND, not
inbound; that's the difference between a personal-reliability tool and
a CRM. See [`fleet/ships/commitment-extractor.md`](../../fleet/ships/commitment-extractor.md).

**End-of-day reflector.** At 6pm the ship reads the morning briefing,
today's added commitments, and the calendar. It writes a five-line
reflection — what moved, what's open, tomorrow's anchor — and fires one
last notification so your final touch of the workday is a clear signal
about where to put your hands tomorrow morning. The file accumulates; a
year in, you can grep your own reflections for patterns and your own
brain has held nothing.

Every one of these uses the same engine, the same yml shape, the same
budget machinery. The shift isn't a new product — it's the same
primitive pointed at the right life surface.

## Privacy, the kill switch, and the consent gate

The dev-repo fleet operates on code, which is already in version
control, already on the operator's machine, already inside their trust
boundary. Personal-agent fleets cross that boundary the moment a
trigger reads from your inbox or an output writes to your calendar.
That asymmetry is real and we treat it loudly.

Every output sink that touches PII — `email:send`, `sms:send`,
`calendar:create-event`, `webhook:url` to a remote host, `file:write`
at `pii=high` — calls through [`lib/fleet/consent-gate.ts`](../../lib/fleet/consent-gate.ts)
before it touches the outside world. The gate is default-closed: a
fresh install of the personal fleet will refuse to send a single
message anywhere until the operator runs
`pd fleet consent grant --sink <kind> --tier <low|high>`. Grants are
per-sink, expirable, and recipient-allowlisted; granting "email send" to
your own address doesn't also grant "email send" to a random external
domain. The audit log is plain JSONL at
`~/.port-daddy/personal-consent.log.jsonl` so you can grep what your
fleet has actually done.

What gets logged: every dispatch, every grant, every deny. What does
NOT get exfiltrated: anything, ever. The fleet engine has no remote
endpoint, no telemetry, no anonymous-usage-stats pipeline. The personal
data the fleet sees stays on the daemon-local SQLite database under
`~/.port-daddy/` until you delete it. There is one kill switch — `pd
fleet down` — and it stops every agent, closes every poll loop, and
deregisters every webhook handler within a second.

The triggers that pull PII into the fleet (email, SMS, calendar) require
operator-side setup before they emit anything: IMAP credentials, OAuth
tokens, Full Disk Access for chat.db. The fleet doesn't go fishing —
the operator has to hand it the line.

## The "you already pay for Claude" pitch

The unfair advantage of the personal fleet is that you almost certainly
already pay for the brain. A Claude Max subscription, a ChatGPT Plus
subscription, a Codex CLI tier — any of these is more than enough
horsepower to run a morning briefing, a commitment extractor, and an
end-of-day reflector at the cadences a normal day produces. The fleet
engine routes through `cli:claude-code` and `cli:codex` first, so
running your personal fleet through your existing subscription doesn't
add a line item. The fallback to Cloudflare's Qwen tier is there for
when you're offline or your CLI is rate-limited, and that's a few cents
a day at the volumes a personal fleet produces.

The math, then, is shockingly favorable: the brain you've already
bought, pointed at the parts of your day that benefit from a little
ambient thinking, running on your laptop, costing nothing extra. The
contrast with the SaaS shape — a $20/month subscription per use case,
each one a separate company holding a separate copy of your inbox — is
the whole point. A personal fleet is one yml, one engine, your data,
your machine, your call.

## Migration note

The new triggers/outputs are additive. The existing dev-repo fleet at
`pd-fleet.yml` still loads. Old `trigger: git:committed` ships still
run. Old `on_success: publish foo:bar` watchers still fire. Nothing
breaks.

The new yml shape introduces:

- `triggers:` (list) alongside `trigger:` (singular). Either works.
- `outputs:` (list) alongside the existing `on_success:` /
  `on_failure:` channels. Either works.
- New trigger source kinds: `email:`, `sms:`, `calendar:`, `file:`,
  `webhook:`, `pd:`.
- New output sink kinds: `notify:`, `calendar:`, `email:`, `sms:`,
  `webhook:`, `file:`, `pd:`.

The implementation lives under [`lib/fleet/triggers/`](../../lib/fleet/triggers/)
and [`lib/fleet/outputs/`](../../lib/fleet/outputs/), with shared types in
[`lib/fleet/types.ts`](../../lib/fleet/types.ts). The consent gate is
[`lib/fleet/consent-gate.ts`](../../lib/fleet/consent-gate.ts). The
engine wiring (mapping a yml `triggers:` list into a router that fans
out to the right sources) is the next layer up and lands in a separate
PR — these primitives are stable and unit-testable on their own.

## Operator's first five minutes

The demo we want to ship is this:

```
brew install curiositech/tap/port-daddy
pd init --personal
# (~/personal/pd-fleet.yml created from the example)
pd fleet consent grant --sink file --tier low --recipients '~/notes/*'
pd fleet up
# the next weekday at 8am, your laptop chimes with your first briefing
```

Five minutes from `brew install` to a working morning briefing, no
account, no SaaS, no telemetry, your existing Claude subscription
covering the cost. If that's the experience, the rest of the pitch
writes itself.
