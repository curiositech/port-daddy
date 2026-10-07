# Direct and managed conversation topologies

**Direct-lane scope.** This is the synchronous receiving-agent path with a positive `max_consecutive_auto_reply` and no custom early reply override. It excludes the v0.2.35 zero-cap special case, where empty human input can return a final user response instead of normal auto-reply.

```mermaid
sequenceDiagram
  participant A as Assistant
  participant U as UserProxy
  participant M as GroupChatManager
  participant R as Selected group role
  participant G as Other group participants
  alt direct pairwise auto-reply
    A->>U: proposal or revised artifact
    U->>U: check termination, mode, and reply counter
    alt NEVER termination/cap
      U->>U: stop locally and return None
    else ALWAYS each receive
      U->>U: prompt human before auto-reply
      alt nonempty human input other than exit
        U-->>A: direct user response, no executor
      else exit or empty terminal message
        U->>U: stop locally and return None
      else empty nonterminal skip
        U->>U: select configured auto-reply
        U->>U: LLM, code, function, or registered reply
        U-->>A: observed reply, result, or error
      end
    else TERMINATE predicate or cap
      U->>U: prompt human before auto-reply
      alt nonempty human input other than exit
        U-->>A: direct user response, no executor
      else exit or empty terminal message
        U->>U: stop locally and return None
      else empty cap with nonterminal message
        U->>U: select configured auto-reply
        U->>U: LLM, code, function, or registered reply
        U-->>A: observed result or error message
      end
    else reply permitted
      U->>U: select LLM, code, function, or registered reply
      U-->>A: observed result or error message
    end
  else managed group chat
    M->>M: managed group path selected
    M->>R: select configured speaker
    R-->>M: selected role reply
    M-->>G: broadcast selected response to group
    alt group termination or max_round reached
      M->>M: record managed-group terminal locally
    else continue
      M->>R: select next speaker
    end
  end
```
