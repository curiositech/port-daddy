## Summary

This PR adds a durable retry to the relay client so a transient Cloudflare 502
no longer drops a queued event. It wraps the POST in an exponential backoff and
surfaces a `relay.retry` metric so the operator can see flakiness instead of
guessing. Trade-off: a hard outage now takes up to 16s to report failure.

## Test Plan

- `npx tsc --noEmit` clean.
- `npm test -- --selectProjects unit relay` — 41 pass, including the new
  `retries on 502 then succeeds` and `gives up after 4 attempts` cases.
- Manually killed the relay mid-flight and confirmed the backoff fired and the
  event still delivered once the worker came back.
