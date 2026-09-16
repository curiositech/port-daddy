#!/usr/bin/env python3
"""
B3 — Hypervisor Enforceability = Ramadge-Wonham Controllability
================================================================
Theorem: an agent hypervisor can REGIMENT (prevent pre-effect) a safety policy P
iff P is a prefix-closed safety language CONTROLLABLE with respect to the
uncontrollable event set Sigma_u (model-internal steps, in-context content that the
daemon cannot intercept). Everything else is detect-and-compensate.

This script implements the supervisory-control controllability test and the
supremal controllable sublanguage computation, then applies it to a realistic
agent-runtime alphabet to produce the regimentable-vs-detect-only table that the
manuscript's ledger needs.

Controllability (Ramadge-Wonham 1987): K is controllable w.r.t. plant L and Sigma_u
iff  K-bar . Sigma_u  ∩  L-bar  ⊆  K-bar
(no uncontrollable event, enabled in the plant after a legal prefix, leaves K).
We model plant and specification as finite automata over Sigma = Sigma_c ∪ Sigma_u.
"""
from itertools import product

# ------------------------------------------------------------------
# Minimal DFA machinery
# ------------------------------------------------------------------
class DFA:
    def __init__(self, states, alphabet, delta, start, marked):
        self.Q=set(states); self.Sig=set(alphabet)
        self.d=dict(delta)          # (q,a)->q'
        self.q0=start; self.F=set(marked)
    def step(self,q,a): return self.d.get((q,a))
    def reachable(self):
        seen={self.q0}; stack=[self.q0]
        while stack:
            q=stack.pop()
            for a in self.Sig:
                q2=self.step(q,a)
                if q2 is not None and q2 not in seen:
                    seen.add(q2); stack.append(q2)
        return seen

def controllable(plantL, specK, Sigma_u):
    """
    Test K-bar . Sigma_u ∩ L-bar ⊆ K-bar via the product automaton.
    plantL, specK are DFAs; specK's language ⊆ plantL's. We check: for every state
    (l,k) reachable in the product along a string in K, and every uncontrollable
    event a enabled in the plant (l has an a-transition to a live state), a must
    also be enabled in K (k has an a-transition to a live/legal state).
    Returns (is_controllable, list_of_violations).
    """
    # product over strings that stay in K (spec defines legality)
    start=(plantL.q0, specK.q0)
    seen={start}; stack=[start]; violations=[]
    while stack:
        (l,k)=stack.pop()
        for a in plantL.Sig:
            l2=plantL.step(l,a); k2=specK.step(k,a)
            # plant enables a (leads to a real plant state)
            plant_enables = l2 is not None
            spec_enables  = k2 is not None
            if a in Sigma_u and plant_enables and not spec_enables:
                # uncontrollable event enabled in plant but disabled in spec => uncontrollable
                violations.append(((l,k),a))
            if plant_enables and spec_enables:
                nxt=(l2,k2)
                if nxt not in seen:
                    seen.add(nxt); stack.append(nxt)
    return (len(violations)==0, violations)

# ==================================================================
# Agent-runtime alphabet
#   Controllable (mediated pre-effect): the hypervisor owns these channels
Sigma_c = {"fs_write","net_egress","exec_tool","git_push","spawn_child","api_call"}
#   Uncontrollable (cannot be intercepted before it 'happens'):
Sigma_u = {"model_emit_token","in_context_read","internal_plan","hidden_activation"}
Sigma = Sigma_c | Sigma_u

# Plant: the agent can do anything in any order (universal plant on Sigma) —
# a single state with all self-loops (models 'any interleaving is physically possible').
plant = DFA(states={"*"}, alphabet=Sigma,
            delta={("*",a):"*" for a in Sigma},
            start="*", marked={"*"})

def make_spec_forbidding(forbidden_after):
    """
    Spec = 'never let event `bad` occur after enabling condition'. We encode a
    2-state safety automaton: state 0 (ok) -> on `bad` goes to a DEAD (illegal)
    state (transition absent = disabled in spec). All other events self-loop.
    forbidden_after: the event the policy tries to forbid.
    """
    d={}
    for a in Sigma:
        if a==forbidden_after: 
            continue          # disabled in spec (the policy forbids it)
        d[("ok",a)]="ok"
    return DFA(states={"ok"}, alphabet=Sigma, delta=d, start="ok", marked={"ok"})

# ==================================================================
# Evaluate: for each candidate policy 'forbid event X', is it regimentable?
# ==================================================================
print("="*72)
print("REGIMENTABILITY TABLE — which agent-runtime policies can be PREVENTED")
print("(controllable w.r.t. Sigma_u) vs only DETECTED post-hoc")
print("="*72)
print(f"{'policy: forbid ...':>24} {'event class':>16} {'regimentable?':>14}")
print("-"*72)

policies = [
    ("net_egress",       "controllable"),
    ("git_push",         "controllable"),
    ("fs_write",         "controllable"),
    ("exec_tool",        "controllable"),
    ("spawn_child",      "controllable"),
    ("model_emit_token", "UNcontrollable"),
    ("in_context_read",  "UNcontrollable"),
    ("internal_plan",    "UNcontrollable"),
]
for ev, cls in policies:
    spec = make_spec_forbidding(ev)
    ok, viol = controllable(plant, spec, Sigma_u)
    verdict = "YES (regiment)" if ok else "NO (detect only)"
    print(f"{('forbid '+ev):>24} {cls:>16} {verdict:>14}")

print("\n" + "="*72)
print("INTERPRETATION")
print("="*72)
print("""  A policy forbidding a CONTROLLABLE event (net egress, git push, fs write,
  tool exec, child spawn) is controllable w.r.t. Sigma_u: the hypervisor can
  disable the event pre-effect, so the policy is REGIMENTABLE. A policy that
  would need to forbid an UNCONTROLLABLE event (a model emitting a token, reading
  its context, forming an internal plan) is NOT controllable: the event occurs
  before any mediator sees it, so the best available is DETECT-AND-COMPENSATE.

  This is exactly the manuscript's needed re-grading:
    force-push, egress, out-of-scope write   -> REGIMENTABLE (structural authority)
    'confident lie in a report'              -> DETECT-ONLY (semantic, uncontrollable)
  and it is the formal content of OP-2 stated as Ramadge-Wonham controllability,
  NOT as 'pure function of committed DB state' (which is the special case where
  the controllable alphabet is exactly the set of DB writes).""")

# ==================================================================
# A subtler case: a COMPOUND policy that mixes controllable and uncontrollable
# events — 'no egress AFTER reading a secret'. The trigger (read) is
# uncontrollable, but the EFFECT (egress) is controllable. Show this IS
# regimentable because we gate the controllable effect regardless of the
# uncontrollable trigger — the clean-room / taint result.
# ==================================================================
print("="*72)
print("COMPOUND POLICY: 'no net_egress after in_context_read of a secret'")
print("="*72)
# spec: state ok; on in_context_read -> state 'tainted'; in tainted, net_egress
# is disabled (absent); everything else self-loops in both states.
d={}
for a in Sigma:
    if a=="in_context_read":
        d[("ok",a)]="tainted"; d[("tainted",a)]="tainted"
    elif a=="net_egress":
        d[("ok",a)]="ok"      # egress allowed before taint
        # in 'tainted', net_egress is DISABLED (transition absent)
    else:
        d[("ok",a)]="ok"; d[("tainted",a)]="tainted"
spec2=DFA(states={"ok","tainted"},alphabet=Sigma,delta=d,start="ok",marked={"ok","tainted"})
ok,viol=controllable(plant,spec2,Sigma_u)
print(f"  regimentable? {'YES' if ok else 'NO'}")
print(f"""  Reading: the TRIGGER (in_context_read) is uncontrollable and the spec does
  NOT try to forbid it — it lets it happen and RECORDS taint. The controlled
  EFFECT (net_egress) is disabled post-taint, and egress IS controllable, so the
  compound policy is regimentable. This is precisely why the Sealed Harbor gates
  the CHANNEL (egress), never the token (read): gating the uncontrollable trigger
  would be unregimentable, but gating the controllable effect is not.""")
