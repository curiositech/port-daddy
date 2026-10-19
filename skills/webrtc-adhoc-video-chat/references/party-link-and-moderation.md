# Party Links: Room Tokens, Access Scoping, and Live Moderation

Read this when designing the "join by URL" flow itself, or when the question
is what happens when someone reports abuse or the room needs to be killed
mid-call. For topology/vendor choice, see `references/sfu-selection-guide.md`.
For TURN/simulcast mechanics, see `references/turn-stun-ice-and-scaling.md`.

## What a "party link" actually is

A party link is a URL that lets **anyone holding it** join a live audio/video
room, without a prior account-to-account relationship (no "add friend" step
first). This is the pattern behind spontaneous group hangouts in dating and
social apps: a host starts a room and shares one link; whoever has the link
can join until it expires or the room fills up.

The security model is fundamentally different from an authenticated,
per-user room invite: **possession of the URL is the credential.** That
means the unguessability and scoping of the token embedded in that URL *is*
the access control — there is no separate login check backing it up for
guests. Get this wrong and you've built a room that's either guessable
(security failure) or has no real boundaries once someone's in (moderation
failure).

## The room-token pattern

1. **Room creation** mints a room record server-side:
   - An **unguessable room ID** — cryptographically random (16+ bytes of
     CSPRNG entropy, base64url-encoded is plenty), never a sequential
     integer, a slug derived from a username, or anything derived from
     public/predictable data.
   - An **expiry** (`expires_at`) — party links should be short-lived by
     default (hours, not indefinite), both for security (shrinking the
     window an old link is exploitable) and product sense (an ad-hoc hangout
     link that still works next week is a bug, not a feature).
   - A **max-participant cap** enforced server-side at join time, not just
     in client UI.
2. **Joining** requires the server to look up the room record by the ID in
   the URL and validate it: does it exist, is it not expired, is it under
   capacity? **Only after that validation passes** does the server mint a
   client access token (a JWT in production) scoped to:
   - that exact room ID (not "any room this server manages"),
   - a role (`publisher`, `viewer`, `moderator`),
   - a short expiry independent of the room's own expiry.
3. **The client never mints its own token.** The join endpoint is the only
   thing that can produce a valid, signed token — the client only ever
   supplies the room ID from the URL and receives a token back. Any design
   where the client constructs or extends its own token, or where the token
   doesn't cryptographically bind to a specific room ID, means a modified or
   leaked token can be replayed against a different room or with an
   escalated role.
4. **The SFU/join endpoint verifies the token on every connect**: signature
   valid, not expired, room ID in the token matches the room being joined.
   See `scripts/party_link_token.py demo` for a runnable, dependency-free
   walkthrough of exactly this create → mint → verify → tamper → reject
   sequence (HMAC-based teaching implementation; swap in a real JWT library
   for production).

## Anti-Pattern: Guessable Room IDs for Party Links

**Novice**: "We generate room links like `app.com/join/room-1042` — it's
simple, human-readable in logs, and 'private' because we don't publish the
list of rooms anywhere."

**Expert**: A sequential or low-entropy room ID is enumerable. An attacker
(or just an automated scanner) can iterate `room-1`, `room-2`, ... `room-9999`
and land in live rooms that were never shared with them — "we don't publish
it" is security by obscurity, not an access control. The fix is a
cryptographically random ID with enough entropy that guessing is
computationally infeasible (16 bytes / 128 bits of CSPRNG entropy is a safe
default), paired with server-side rate limiting on join attempts so even a
targeted brute-force against a *specific* known-format ID space is
impractical. Human-readable slugs are fine for *display* (e.g. a
memorable room name shown in the UI) but must never be, or be derivable
from, the actual access credential in the URL.

**Detection**: grep client and server code for room-ID generation. Red flags:
auto-increment IDs, `uuid` v1 (time-based, not fully random) used as the
access token itself rather than an opaque random ID, or any room ID that's a
direct function of the creating user's username/ID/timestamp.

## Live moderation: why live video can't be pre-scanned

Uploaded video/images can run through a content classifier *before* anyone
sees them — pre-publish gating is standard practice for on-demand UGC (see
`managed-video-streaming-pipeline` for that pipeline). **Live video cannot
work this way**: by definition, the content is being seen by other
participants in real time, before any moderation system has a chance to
review it. This is true for any platform with live UGC video — dating apps,
social hangout apps, livestream platforms, whatever the vertical.

Because pre-scan isn't available, live moderation has to rely on a different
set of controls, all of which should exist together rather than as
alternatives:

- **In-call reporting and kill-switch controls.** A participant (or an
  automated signal) can flag a room; a moderator or an automated policy
  action can forcibly **end the room** or **eject a specific participant**
  immediately. This needs to be a first-class server-side operation the SFU
  respects instantly (drop the participant's connection / tear down the
  room), not a soft UI-only "hide for me" — the harmful content is still
  being broadcast to everyone else until the room actually ends.
- **Post-hoc review of recordings**, if calls are recorded. This is the
  closest live moderation gets to the pre-scan model available for uploaded
  content, but it's after-the-fact by nature — it supports enforcement
  (bans, escalation, legal response) and pattern detection, not prevention
  of the live harm itself.
- **Rate/behavior-based abuse signals** that don't depend on understanding
  content at all: e.g., a room that gets re-created seconds after being
  killed (strong signal of ban evasion), an account that creates many
  short-lived rooms in rapid succession, or a participant who's been
  ejected from multiple rooms in a short window. These behavioral signals
  are available in real time even when content-based detection isn't, and
  should feed into automated throttling or escalation independent of any
  human review queue. (Building the actual severity-tiered review queue and
  human reviewer tooling for reports is its own discipline — see
  `moderation-triage-routing`.)

## Recordings are sensitive data — treat them like it

If calls are recorded for evidence, moderation, or compliance purposes, **the
recording itself becomes sensitive user data**, not a neutral operational
artifact. It requires the same retention-period discipline (don't keep it
longer than the stated policy requires), access-control discipline (who can
retrieve a recording, and is that access logged), and deletion discipline
(can a user request deletion, and does that actually propagate) as any other
sensitive user content in your system — arguably more, since a video
recording is a higher-stakes exposure than most other data types if it
leaks. Don't let "we record for moderation" become a silent, indefinite,
loosely-guarded video archive.
