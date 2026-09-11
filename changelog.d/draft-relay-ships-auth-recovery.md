type: fixed

- **Ship controls no longer strand signed-in operators on an unstyled authorization error.** Missing or expired GitHub credentials offer an immediate reconnect action; repository denials and transient GitHub failures remain distinct, fail before telemetry reads or settings writes, and provide the appropriate recovery path.
