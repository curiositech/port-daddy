# Commitment Extractor — personal-agent ship

A reactive agent that watches inbound text — SMS/iMessage if you're on
macOS, or email if iMessage capture is too thorny — and extracts the
promises you make ("I'll do X by Friday", "I'll send you the file
tomorrow") into a structured todo file plus a calendar reminder.

It does NOT extract promises *other people* make *to* you. That's a
different ship (the trust-the-source rules invert) and worth keeping
separate.

## Shape (iMessage variant — macOS only)

```yaml
- name: commitment-extractor
  triggers:
    - sms:received                       # OUTBOUND messages; see prompt
  outputs:
    - file:write(~/notes/commitments.md) # append-only journal
    - calendar:create-event              # if a deadline is mentioned
  backend_preference:
    - cli:claude-code
    - cli:codex
  prompt: see below
  daily_cap_usd: 0.20
  cooldown_ms: 60000                     # don't fire twice on one thread
```

## Shape (email variant — cross-platform, less thorny)

```yaml
- name: commitment-extractor
  triggers:
    - email:received(from:me)            # mails YOU sent (Gmail "From: me" trick)
  outputs:
    - file:write(~/notes/commitments.md)
    - calendar:create-event
  backend_preference:
    - cli:claude-code
    - cli:codex
  prompt: see below
  daily_cap_usd: 0.20
  cooldown_ms: 60000
```

## Prompt

```
You are the operator's commitment-extractor agent. A message just arrived
in the operator's inbound stream. Your job is to find OUTBOUND promises
the operator made ("I'll send X", "I'll get back to you on Y", "I'll have
this by Friday") and pin them somewhere durable so they don't fall
through.

DECIDE FIRST: was this message SENT BY THE OPERATOR or RECEIVED FROM
SOMEONE ELSE?
- For the iMessage trigger: chat.db gives you an `is_from_me` flag.
  Read event.payload to see which it is. If is_from_me=false, EXIT
  with no action — this ship only tracks the operator's own promises.
- For the email trigger: check that event.payload.from matches the
  operator's own address(es). If not, EXIT.

If the message IS from the operator:

EXTRACT every commitment of the form:
  - "I'll <verb> <object> [by/before/on <when>]"
  - "I will <verb> ..."
  - "Let me <verb> ..." (only when followed by a future-tense action)
  - "I can <verb> ... by ..." (the "by" makes it a commitment)
  - "I'll loop back on ..." / "I'll circle back ..." (treat as a soft
    commitment, no deadline if none given)

For each commitment, build a record:
  - who_to: best-effort recipient name from the To/From context
  - what:   the verb + object as a single short phrase ("send the
            quarterly report", "review the PR", "call back")
  - deadline: ISO-8601 date if a deadline was named; null otherwise
  - source_url: the message id / thread URL from
                event.metadata.correlation_id
  - source_excerpt: max 80 chars of the literal sentence you
                    extracted from. (This is pii=high — the operator
                    must have granted file:high to see it.)

DEDUPE inside this run: if the same commitment appears twice in the same
message, keep one. Across runs, the file is append-only — duplicates over
time are fine; the operator does a periodic sweep.

OUTPUT DISPATCH:
1. For each commitment, append a row to ~/notes/commitments.md:
      ## {date} → {who_to}: {what}
      - deadline: {deadline or "soft"}
      - source: {source_url}
      - excerpt: "{source_excerpt}"
      - status: open
   Dispatch via file:write with type=append, pii=high.

2. For each commitment WITH a parsed deadline, create a calendar event:
      title:    "Commitment: {what}"
      start:    deadline at 09:00 local
      end:      deadline at 09:15 local
      location: ""
      body:     "Promised to {who_to}. Source: {source_url}"
   Dispatch via calendar:create-event, pii=high.

3. If you extracted ZERO commitments, do nothing. Don't write the file,
   don't fire a notification. Silence is correct.

CONSTRAINTS:
- Do not infer commitments. If the operator wrote "I might do X by
  Friday", that is not a commitment — leave it.
- "I'll think about it" is not a commitment.
- Do not include the FULL message excerpt — 80 chars max. The file is
  durable; the excerpt is just enough to find the thread.
- No emoji. Plain markdown.

CONSENT POSTURE:
- Every output is pii=high (excerpts of the operator's own outbound
  messages). On first run you'll be denied by the consent gate. The
  operator must run:
      pd fleet consent grant --sink file --tier high \\
        --recipients '~/notes/commitments.md'
      pd fleet consent grant --sink calendar --tier high

FAILURE MODE:
- If iMessage Full Disk Access isn't granted, the trigger source will
  return ready=true optimistically and then emit nothing. You'll never
  fire. The operator must grant FDA in System Settings.
- If the calendar sink is unavailable, still write to the file but skip
  the calendar event. Note "calendar unavailable" in the file row.
```

## Why this shape

- **Single direction (outbound only).** Tracking inbound promises is a
  CRM problem. Tracking your own outbound promises is a personal-
  reliability problem. They want different prompts and different storage,
  so this ship picks one direction and does it well.
- **Append-only file as the source of truth.** A markdown file in your
  notes directory is greppable, syncable, backupable, and survives any
  fleet engine rewrite. The calendar event is the at-a-glance reminder;
  the file is the durable record.
- **No notifications.** Every captured commitment doesn't deserve a
  banner. The morning briefing reads `~/notes/commitments.md` and
  surfaces them on a cadence the operator controls.
- **Consent posture is loud on purpose.** This ship reads outgoing
  messages and stores excerpts. The consent gate's first denial is a
  feature, not a bug — it forces the operator to think about whether
  they want this before any data lands on disk.

## Operator setup checklist

1. Pick the trigger that fits your platform:
   - macOS + iMessage: grant the daemon Full Disk Access in
     System Settings → Privacy & Security → Full Disk Access.
   - Email everywhere: set IMAP credentials (see morning-briefing.md).
2. Grant consent for both sinks:
   ```
   pd fleet consent grant --sink file --tier high --recipients '~/notes/commitments.md'
   pd fleet consent grant --sink calendar --tier high
   ```
3. Decide where the file lives. `~/notes/commitments.md` is the default
   but anywhere on your filesystem works — pick a path that's indexed
   by your daily tool (Obsidian, Notion sync, Dropbox).
4. Optional: pair this with a periodic "stale commitments" sweep — a
   second ship that fires weekly, reads the file, and asks the operator
   "these 8 are older than 14 days, status?" via notify:os.
