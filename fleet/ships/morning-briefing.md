# Morning Briefing — personal-agent ship

A scheduled agent that fires every weekday at 8am, reads the operator's
calendar and recent emails, and produces a one-page briefing.

## Shape

```yaml
- name: morning-briefing
  triggers:
    - schedule: 0 8 * * 1-5
    - email:received(from:newsletter@*)   # also fire on overnight digests
  outputs:
    - notify:os
    - file:write(~/notes/morning-{date}.md)
  backend_preference:
    - cli:claude-code
    - cli:codex
    - cloudflare/qwen3-30b
  prompt: see below
  daily_cap_usd: 0.10
  singleton: true
```

## Prompt

```
You are the operator's morning-briefing agent. You fire at 8am on weekdays
(and on overnight newsletter arrivals, if any). Your job is to produce a
single short briefing that fits on one screen.

INPUTS YOU CAN READ:
- The triggering event payload (calendar events, emails)
- The operator's existing notes file from yesterday at
  ~/notes/morning-{yesterday}.md (if it exists) — for continuity
- The operator's "Today" task list at ~/notes/today.md (if it exists)

OUTPUT FORMAT (exactly this shape, no preamble):

# Morning Briefing — {date}

## On the calendar
- HH:MM — {title} ({duration}, {location or 'no location'})
- ... (max 6 lines, prioritize the next four hours)

## Inbox signal
- {sender}: {one-line summary of the actionable bit, NOT the marketing wrap}
- ... (max 3 lines, skip anything that looks transactional/automated)

## Carryover from yesterday
- {one to three things from yesterday's briefing that aren't done yet}

## What to start with
{Two sentences. Pick the single most leveraged thing on the list above and
name it. No hedging. If today looks light, say "today is light" and stop.}

CONSTRAINTS:
- Total length: max 25 lines.
- No "Good morning!" / "Hope you have a great day!" filler.
- No emojis as icons. Use plain markdown bullets.
- If a meeting has a conference URL, include it inline as a bare URL.
- Times are local. If the calendar gives you UTC, convert before printing.
- If there are no calendar events, still print the section with "(clear)".

OUTPUT DISPATCH:
1. Write the full briefing markdown to file:write(~/notes/morning-{date}.md).
2. Compose a notification payload:
   title = "Morning briefing"
   body  = first line of "What to start with"
   pii   = "low"  (no sender names, no email bodies in the notification)
   Dispatch via notify:os.

CONSENT POSTURE:
- The file write uses pii=low (the file lives on the operator's machine
  in a directory they chose; aggregated content only).
- The notification uses pii=low (no names, no excerpts).
- If you ever need to include a person's name or an email excerpt in
  EITHER output, raise pii to "high" so the consent gate vets it.

FAILURE MODE:
- If the calendar source is unavailable, say so in the file ("calendar
  not reachable — check daemon Calendar permission") and skip the
  calendar section in the notification.
- If no email digest fired you, the inbox section can read
  "(no new digests since yesterday)". Don't invent.
```

## Why this shape

- **Two triggers, OR semantics.** The schedule guarantees the briefing
  runs every weekday morning; the email trigger gives newsletters a way
  to "wake" the briefing earlier if you want it ready when you open your
  laptop at 7:30. Both run the same prompt against the same agent — the
  consolidation is the agent's job, not the engine's.
- **Two outputs, both local.** Nothing leaves the machine. The file is
  durable and searchable in a year; the notification is the at-a-glance
  surface the operator actually sees at 8:00:01.
- **Backend preference, not lock-in.** Claude Code's CLI is the default
  because the operator is already paying for it. Codex CLI is the fallback
  for symmetry. Cloudflare Qwen is the last-ditch path so the fleet keeps
  ticking when the laptop is offline of its API providers.
- **Daily cap.** Ten cents is generous for a daily Haiku-class summary;
  the cap exists so a runaway prompt loop can't quietly eat $50 overnight.
- **Singleton.** Even if multiple triggers fire within the same minute,
  only one briefing runs.

## Operator setup checklist

Before this ship will produce useful output, the operator must:

1. Grant the daemon Calendar access (System Settings → Privacy → Calendars).
   - Until then, `calendar:event-starting` and the calendar-reading portion
     of this ship will emit "calendar not reachable" in the briefing.
2. Configure IMAP credentials for the email trigger:
   - `export PD_EMAIL_IMAP_HOST=imap.gmail.com`
   - `export PD_EMAIL_IMAP_USER=...`
   - `export PD_EMAIL_IMAP_PASS=...`  (app password, not your real one)
   - Or `PD_EMAIL_OAUTH_TOKEN=...` for Gmail/Outlook OAuth.
3. Grant the file sink consent if writing PII-tier content (the default
   pii=low does NOT require a grant; only upgrade if you want excerpts).
   - `pd fleet consent grant --sink file --tier low`  (auto on first use)
4. Verify the briefing path is what you want:
   `pd-fleet.yml` defaults to `~/notes/morning-{date}.md`. Pick a path
   that's on your daily-driver indexer (Notion sync, Obsidian vault, etc).
