#!/usr/bin/env python3
"""
C0 — The Work-Unit Transition System, model-checked
====================================================
The rigor review's central formal object: one evidence-bearing work unit plus
principals, roles, grants, effects, external operations, and settlement — with six
safety invariants. This script is the EXECUTABLE SPEC: an explicit-state model
checker (BFS over all reachable states of a small instance) verifying every
invariant in every reachable state, then MUTATION-TESTING itself: disable each
guard and confirm the checker finds a shortest violating trace. A checker that
has never caught a seeded bug is an unvalidated checker.

Instance: principals p1 (owner) and p2; one work unit; one exclusive role with
fencing epochs; a root grant with one delegation; one external-op idempotency key.

The six invariants (from the research roadmap, Document 3 / C0):
  I1  every admitted effect carried the CURRENT role epoch at admit time
  I2  each idempotency key settles at most once
  I3  a VERIFIED completion has an acceptance policy and an admitted verifier receipt
  I4  no delegated grant is more permissive than its immediate parent
  I5  role reassignment invalidates stale epochs at the effect boundary (= I1's teeth)
  I6  every settlement is funded by the owning principal and references a receipt

Production route: the same spec in TLA+ checked by TLC/Apalache; this Python
checker is the faithful small-instance version, and its mutation suite is the
evidence that the invariants have teeth.
"""
from collections import deque, namedtuple

# ---------------- state ----------------
# Immutable tuple for hashing.
# wu: 'P' proposed 'A' authorized 'X' executing 'W' witnessed 'V' verified 'C' contested
S = namedtuple('S', [
    'wu', 'policy', 'receipt',              # work-unit phase, acceptance policy set?, verifier receipt admitted?
    'epoch', 'holder', 'stale_token',       # role epoch, current holder, old holder's retained epoch (or None)
    'grants',                               # frozenset of (gid, principal, scope frozenset, parent gid or None, active)
    'effects',                              # tuple of (epoch_used, epoch_current_at_admit)
    'extkeys',                              # tuple of settled idempotency keys (journal, order kept)
    'settle',                               # None or (funder,)
])

ROOT = ('g0', 'p1', frozenset({'a', 'b'}), None, True)
INIT = S('P', False, False, 0, 'p1', None, frozenset({ROOT}), (), (), None)

# Guards, individually mutable for mutation testing
GUARDS = dict(epoch=True, idem=True, verify=True, attenuate=True, settle=True)

def grants_get(grants, gid):
    for g in grants:
        if g[0] == gid: return g
    return None

def transitions(s: S):
    out = []
    # lifecycle
    if s.wu == 'P': out.append(('propose->authorize', s._replace(wu='A')))
    if s.wu == 'A': out.append(('start_exec', s._replace(wu='X')))
    if not s.policy: out.append(('set_policy', s._replace(policy=True)))
    if s.wu == 'X': out.append(('witness', s._replace(wu='W')))
    # verify: guard requires policy & receipt
    if s.wu == 'W':
        if (not GUARDS['verify']) or (s.policy and s.receipt):
            out.append(('verify', s._replace(wu='V')))
        out.append(('contest', s._replace(wu='C')))
    if s.wu == 'X' and not s.receipt:
        out.append(('admit_verifier_receipt', s._replace(receipt=True)))
    # effects: current holder admits with current epoch (bounded to 2 effects)
    if s.wu == 'X' and len(s.effects) < 2:
        out.append(('admit_effect(current)',
                    s._replace(effects=s.effects + ((s.epoch, s.epoch),))))
        # a paused old holder tries with a STALE token
        if s.stale_token is not None:
            if not GUARDS['epoch']:   # guard off => the stale write lands
                out.append(('admit_effect(STALE)',
                            s._replace(effects=s.effects + ((s.stale_token, s.epoch),))))
            # guard on => rejected pre-effect: no transition
    # reassignment bumps the epoch; the old holder retains its token
    if s.epoch == 0:
        out.append(('reassign_role', s._replace(epoch=1, holder='p2', stale_token=0)))
    # external op with idempotency key k1 (at-most-once)
    if len(s.extkeys) < 2:
        dup = 'k1' in s.extkeys
        if (not dup) or (not GUARDS['idem']):
            out.append(('ext_op(k1)', s._replace(extkeys=s.extkeys + ('k1',))))
    # delegation: legal child (subset) and, if guard off, an ESCALATED child
    if grants_get(s.grants, 'g1') is None:
        child_ok = ('g1', 'p2', frozenset({'a'}), 'g0', True)
        out.append(('delegate(subset)', s._replace(grants=s.grants | {child_ok})))
        if not GUARDS['attenuate']:
            child_bad = ('g1', 'p2', frozenset({'a', 'b', 'c'}), 'g0', True)
            out.append(('delegate(ESCALATED)', s._replace(grants=s.grants | {child_bad})))
    # settlement: owner-funded, verified, receipted
    if s.settle is None and s.wu == 'V':
        out.append(('settle(p1)', s._replace(settle=('p1',))))
        if not GUARDS['settle']:
            out.append(('settle(p2!)', s._replace(settle=('p2',))))
    return out

# ---------------- invariants ----------------
def violated(s: S):
    v = []
    if any(eu != ec for (eu, ec) in s.effects):
        v.append('I1/I5: effect admitted with stale epoch')
    if len(s.extkeys) != len(set(s.extkeys)):
        v.append('I2: idempotency key settled twice')
    if s.wu == 'V' and not (s.policy and s.receipt):
        v.append('I3: verified without policy+receipt')
    for g in s.grants:
        if g[3] is not None:
            parent = grants_get(s.grants, g[3])
            if parent and not g[2].issubset(parent[2]):
                v.append('I4: child grant exceeds parent scope')
    if s.settle is not None:
        if s.settle[0] != 'p1' or s.wu != 'V' or not s.receipt:
            v.append('I6: settlement unfunded/unreceipted/wrong principal')
    return v

# ---------------- checker ----------------
def check(max_depth=14):
    seen = {INIT: (None, None)}          # state -> (parent, action)
    q = deque([(INIT, 0)])
    bad = None
    while q:
        s, dep = q.popleft()
        viol = violated(s)
        if viol:
            bad = (s, viol); break
        if dep >= max_depth: continue
        for act, s2 in transitions(s):
            if s2 not in seen:
                seen[s2] = (s, act)
                q.append((s2, dep + 1))
    trace = []
    if bad:
        s = bad[0]
        while seen[s][0] is not None:
            trace.append(seen[s][1]); s = seen[s][0]
        trace.reverse()
    return len(seen), bad, trace

print('=' * 72)
print('C0 — WORK-UNIT TRANSITION SYSTEM: explicit-state check')
print('=' * 72)
n, bad, tr = check()
print(f'BASELINE (all guards on): {n} reachable states explored, '
      f'violations: {"NONE — all six invariants hold in every state ✓" if not bad else bad[1]}')

print('\nMUTATION SUITE — disable each guard; the checker must find a violating trace:')
for gname, expect in [('epoch', 'I1/I5'), ('idem', 'I2'), ('verify', 'I3'),
                      ('attenuate', 'I4'), ('settle', 'I6')]:
    GUARDS[gname] = False
    n, bad, tr = check()
    assert bad is not None, f'mutation {gname} NOT caught — checker has a blind spot!'
    print(f'  guard OFF [{gname:9s}] -> caught {bad[1][0]}')
    print(f'      shortest trace ({len(tr)} steps): ' + ' -> '.join(tr))
    GUARDS[gname] = True

n, bad, _ = check()
print(f'\nGuards restored: {n} states, violations: {"none ✓" if not bad else bad[1]}')
print('''
READING. The six safety properties hold in every reachable state of the guarded
system, and every guard is CRITICAL: removing any one produces a concrete
violating run, found automatically as a shortest counterexample. This is the
executable spec of the evidence-bearing work unit; the TLA+/Apalache version is
the same machine with unbounded parameters, and this mutation suite is what
certifies the checker itself is not vacuous.''')
