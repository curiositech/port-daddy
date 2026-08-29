type: fixed

- **Fresh GitHub sign-ins now get a fresh repository-access decision.** Relay keys its five-minute GitHub repository-access cache to the opaque browser session, so renewed OAuth credentials cannot inherit a stale denial from an earlier session.
- **Transient GitHub failures no longer become five-minute authorization denials.** Relay retries after transport, rate-limit, and upstream errors, while admin and installation authorization caches follow the same browser-session boundary.
