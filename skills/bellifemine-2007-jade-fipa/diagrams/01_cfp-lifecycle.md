# CFP lifecycle and evidence boundary

```mermaid
sequenceDiagram
  participant Q as requester
  participant C as candidate
  participant V as independent verifier
  Q->>C: CFP with request digest and reply-by policy
  alt candidate declines or cannot understand
    C-->>Q: REFUSE or NOT-UNDERSTOOD
    Note over Q,C: no proposal selection or task result expected
  else candidate proposes
    C-->>Q: PROPOSE terms
    Q->>Q: apply frozen local selection policy
    alt proposal rejected
      Q->>C: REJECT-PROPOSAL
    else proposal accepted
      Q->>C: ACCEPT-PROPOSAL
      alt result reported
        C-->>Q: INFORM output reference
        Q->>V: submit output and retained evidence
        V-->>Q: verification result
      else failure reported
        C-->>Q: FAILURE record
      else no result before local deadline
        Q->>Q: record unresolved task
      end
    end
  end
```

This single-candidate view distinguishes refusal from a rejected proposal and does not route either through execution. The application adds evidence verification, request digests and result deadlines. A deadline does not undo an external action. The official [JADE ContractNetInitiator API mirror, labelled v4.5.0](https://jade-project.gitlab.io/API/jade/proto/ContractNetInitiator.html) describes the response, acceptance and result-notification callbacks; root inspected that body on 2026-09-24. The v4.6 URL timed out during this additional check, so this citation is explicitly versioned separately. Messaging alone supplies no external-effect proof.
