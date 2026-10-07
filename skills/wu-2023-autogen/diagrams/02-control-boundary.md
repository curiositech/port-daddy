# Receiving-agent control abstraction and managed-group control

**Direct-lane scope.** This abstraction assumes a synchronous receiving agent, a positive `max_consecutive_auto_reply`, and no custom reply handler preceding the built-in guard. It excludes the v0.2.35 zero-cap special case for empty human input.

```mermaid
stateDiagram-v2
  state "Direct receiving-agent control abstraction" as Direct {
    [*] --> direct_receive
    direct_receive --> direct_gate: check mode, predicate, and counter
    direct_gate --> direct_stop: NEVER termination/cap
    direct_gate --> direct_prompt: ALWAYS each receive
    direct_gate --> direct_prompt: TERMINATE predicate/cap
    direct_gate --> direct_auto_reply: reply permitted
    direct_prompt --> direct_human_send: nonempty input other than exit
    direct_human_send --> direct_wait: send direct user response to peer, no executor
    direct_prompt --> direct_stop: exit or empty terminal
    direct_prompt --> direct_auto_reply: empty nonterminal skip
    direct_auto_reply --> direct_execute: selected code/function reply
    direct_execute --> direct_auto_send: send result or error to peer
    direct_auto_reply --> direct_auto_send: send LLM or registered reply to peer
    direct_auto_send --> direct_wait: auto response sent
    direct_wait --> direct_receive: later peer message
    direct_stop --> [*]: return None locally
  }
  state "Managed-group control abstraction" as Managed {
    [*] --> group_select
    group_select --> group_compute: manager selects configured role
    group_compute --> group_broadcast: selected role reply
    group_broadcast --> group_gate: manager broadcasts to group
    group_gate --> group_select: continue while round remains
    group_gate --> group_stop: group predicate or max_round
    group_stop --> [*]: managed-group terminal
  }
```
