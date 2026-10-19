type: fixed

- **Fleetbot no longer repeats a GitHub mutation after Relay's final response is lost.** The actuator uploads a signed, non-secret recovery manifest before dispatch, refuses mutation-job reruns, and uses a separate protected recovery workflow with an exact workload-authenticated intent binding to return only the original Relay-signed receipt.
