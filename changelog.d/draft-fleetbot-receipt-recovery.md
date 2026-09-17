type: fixed

- **Fleetbot actuator reruns no longer repeat a GitHub mutation after Relay's final response is lost.** The protected workflow uploads a signed, non-secret recovery manifest before dispatch, and reruns use an exact workload-authenticated intent binding to recover only the original Relay-signed receipt.
