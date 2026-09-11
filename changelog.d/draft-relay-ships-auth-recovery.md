type: fixed

- **Ship controls no longer strand signed-in operators on an unstyled authorization error.** Missing or expired GitHub credentials offer an immediate reconnect action that returns to the requested ship page; repository denials and transient GitHub failures remain distinct, fail before telemetry reads or settings writes, and provide the appropriate recovery path. Account sign-out now preserves same-origin form provenance, clears the session, and returns to the login screen instead of exposing a CSRF error or raw JSON.
