#!/usr/bin/env python3
"""
C1 — Sealed-Harbor Noninterference (finite-model verification)
================================================================
The airlock's central promise: Erin learns NOTHING about Derek's secret beyond
what the declassification gate explicitly releases. Formally (Rushby-style,
intransitive policy): D may flow to E only through gate G_E; the theorem is
observational noninterference MODULO the declared release function g.

  For any two of Derek's secrets s, s' and ANY action sequence:
    - if g(s) = g(s'):  Erin's observation sequences are IDENTICAL;
    - if g(s) != g(s'): Erin's observations may differ ONLY at gate-release steps.

This script verifies that property EXHAUSTIVELY on a finite model of the clean
room (all interleavings to depth 7, all secret pairs), checks the key unwinding
condition mechanically (local respect: Derek-domain actions never change Erin-
observable state), and then MUTATION-TESTS: (m1) a gate that leaks the raw secret
and (m2) a worker that bypasses the gate — both must be caught with witness traces.

Scope, honestly: this is the finite-instance verification of the theorem whose
general form is the Isabelle/AFP unwinding obligation (Rushby 1992). Possibilistic;
timing/termination channels out of model, as stated in the design.
"""
from itertools import product

SECRETS = [0, 1, 2, 3]
def g(s):                      # the DECLARED release function (the contract):
    return s % 2               # Erin may learn the parity, nothing more.

# ---------------- the model ----------------
# State: (loaded, taint, pending, e_log tuple, d_log tuple)
INIT = (False, False, False, (), ())
MUT = dict(leaky_gate=False, bypass=False)   # mutations

def enabled_actions(st):
    loaded, taint, pending, e_log, d_log = st
    acts = []
    if not loaded:               acts.append(('D', 'load_data'))
    if loaded and not taint:     acts.append(('W', 'read_secret'))
    if taint and not pending:    acts.append(('W', 'submit_to_gate'))
    if pending:                  acts.append(('GE', 'gate_release'))
    if taint:                    acts.append(('GD', 'report_to_derek'))
    if MUT['bypass'] and taint:  acts.append(('W', 'BYPASS_write_E'))
    return acts

def step(st, act, s):
    loaded, taint, pending, e_log, d_log = st
    dom, name = act
    if name == 'load_data':      return (True, taint, pending, e_log, d_log)
    if name == 'read_secret':    return (loaded, True, pending, e_log, d_log)
    if name == 'submit_to_gate': return (loaded, taint, True, e_log, d_log)
    if name == 'gate_release':
        out = s if MUT['leaky_gate'] else g(s)        # honest gate releases g(s)
        return (loaded, taint, False, e_log + ((('gate', out)),), d_log)
    if name == 'report_to_derek':return (loaded, taint, pending, e_log, d_log + (('ok',),))
    if name == 'BYPASS_write_E': return (loaded, taint, pending, e_log + ((('leak', s)),), d_log)
    raise ValueError(name)

def obs_E(st):  return st[3]      # Erin sees only e_log
def run(seq, s):
    st = INIT; obs = []
    for act in seq:
        if act not in enabled_actions(st): return None   # invalid interleaving
        st = step(st, act, s)
        obs.append(obs_E(st))
    return tuple(obs), [a for a in seq]

def all_sequences(depth):
    """Enumerate all valid action sequences to `depth` (schedule-independent of s:
    enabledness never depends on the secret, verified below)."""
    seqs = [()]
    frontier = [((), INIT)]
    for _ in range(depth):
        nxt = []
        for seq, st in frontier:
            for act in enabled_actions(st):
                st2 = step(st, act, SECRETS[0])   # structure identical across s (checked)
                nxt.append((seq + (act,), st2))
                seqs.append(seq + (act,))
        frontier = nxt
    return seqs

def structure_check(depth=7):
    """Enabledness and control structure must not depend on the secret (else the
    schedule itself is a channel). Verify: enabled sets agree across secrets along
    every sequence."""
    frontier = [((INIT,) * len(SECRETS))]
    for _ in range(depth):
        nxt = []
        for states in frontier:
            ens = [tuple(enabled_actions(st)) for st in states]
            if len(set(ens)) != 1: return False
            for act in ens[0]:
                nxt.append(tuple(step(st, act, s) for st, s in zip(states, SECRETS)))
        frontier = nxt
    return True

def check_NI(depth=7):
    """Noninterference modulo declassification, exhaustive to `depth`."""
    seqs = all_sequences(depth)
    for s1, s2 in product(SECRETS, SECRETS):
        if s1 >= s2: continue
        for seq in seqs:
            r1, r2 = run(seq, s1), run(seq, s2)
            if r1 is None: continue
            o1, o2 = r1[0], r2[0]
            if g(s1) == g(s2):
                if o1 != o2:
                    return ('EQUAL-CLASS VIOLATION', s1, s2, seq, o1, o2)
            else:
                # may differ ONLY at gate_release positions
                for i, act in enumerate(seq):
                    if o1[i] != o2[i] and act != ('GE', 'gate_release'):
                        # a differing observation introduced by a non-gate step
                        prev1 = o1[i-1] if i else ()
                        prev2 = o2[i-1] if i else ()
                        if (o1[i] != prev1 or o2[i] != prev2):
                            return ('NON-GATE LEAK', s1, s2, seq[:i+1], o1[:i+1], o2[:i+1])
    return None

def check_local_respect(depth=7):
    """Unwinding condition (local respect for D,GD w.r.t. Erin): actions in
    domains that may not flow to E leave Erin's observation unchanged."""
    seqs = all_sequences(depth)
    for s in SECRETS:
        for seq in seqs:
            st = INIT
            for act in seq:
                if act not in enabled_actions(st): break
                before = obs_E(st)
                st = step(st, act, s)
                if act[0] in ('D', 'GD') and obs_E(st) != before:
                    return ('LOCAL-RESPECT VIOLATION', s, seq, act)
    return None

print('=' * 72)
print('C1 — SEALED-HARBOR NONINTERFERENCE (finite model, exhaustive to depth 7)')
print('=' * 72)
print(f'declared release: g(s) = s mod 2  (Erin may learn parity, nothing more)')
print(f'structure check (schedule independent of secret): '
      f'{"PASS ✓" if structure_check() else "FAIL"}')
r = check_NI()
print(f'noninterference modulo declassification: '
      f'{"HOLDS on all sequences x all secret pairs ✓" if r is None else r}')
lr = check_local_respect()
print(f'unwinding (local respect, D/GD -> E): '
      f'{"HOLDS ✓" if lr is None else lr}')

print('\nMUTATION SUITE:')
MUT['leaky_gate'] = True
r = check_NI()
assert r is not None
print(f'  [m1 leaky gate: releases raw s]   caught: {r[0]}')
print(f'      witness: secrets ({r[1]},{r[2]}), trace ' +
      ' -> '.join(a[1] for a in r[3]) + f', Erin sees {r[4][-1]} vs {r[5][-1]}')
MUT['leaky_gate'] = False

MUT['bypass'] = True
r = check_NI()
assert r is not None
print(f'  [m2 worker bypasses the gate]     caught: {r[0]}')
print(f'      witness: secrets ({r[1]},{r[2]}), trace ' +
      ' -> '.join(a[1] for a in r[3]) + f', Erin sees {r[4][-1]} vs {r[5][-1]}')
MUT['bypass'] = False

r = check_NI()
print(f'\nmutations reverted: {"noninterference restored ✓" if r is None else r}')
print('''
READING. On the finite model, Erin's view is provably identical across any two
secrets of equal parity under EVERY interleaving, and differs only at explicit
gate releases otherwise — noninterference modulo the declared g. The unwinding
condition (Derek-side actions never touch Erin-observable state) holds
mechanically. Both canonical breaks — a leaky gate and a gate bypass — are caught
with concrete witness traces, confirming the property has teeth and that the
security boundary is exactly the gate, as the design claims (and as B3's
controllability result independently requires: gate the channel, never the token).
General-form obligation: the same unwinding conditions discharged in Isabelle/AFP
(Rushby 1992) over unbounded state; timing/termination channels remain out of
model, as declared.''')
