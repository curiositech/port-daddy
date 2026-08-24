#!/usr/bin/env python3
"""
B4 - A Tractable Deontic-Conflict Fragment (and its NP-complete frontier)
=========================================================================
Research-ledger item B4, gating Paper 6 ("What Needs an Authority"): the
condominium harbor's contradiction-scan must be a POLYNOMIAL decision, and
the language boundary that keeps it polynomial must be exact.

THE FRAGMENT L_c. A policy set consists of:
  (a) FACTS: ground atoms over a finite vocabulary A.
  (b) HORN RULES: b1 & ... & bk -> h with bi, h in A, or h = BOT
      (an integrity constraint). Definite Horn, no disjunction, no negation.
  (c) DEONTIC RULES: b1 & ... & bk -> M(action, scope, [lo,hi]) with
      M in {O (obliged), F (forbidden)}, scope a set of ground scope atoms,
      [lo,hi] a ground closed time interval. Bodies are Horn (conjunctions
      of atoms); a rule FIRES when its body holds.
  (d) CLAIMS: (resource, [lo,hi], owner, exclusive) interval resource claims.
  (e) DIFFERENCE CONSTRAINTS: x_j - x_i <= c over deadline variables.

A CONFLICT is any of:
  (C1) derivable BOT (an integrity constraint fires);
  (C2) O/F clash: a fired O(a, s, I) and a fired F(a, s', I') with
       s cap s' nonempty and I cap I' nonempty (obliged AND forbidden on
       overlapping scope-and-time);
  (C3) overlapping claims on one resource by distinct owners, at least one
       exclusive;
  (C4) an unsatisfiable temporal chain: the difference system has no
       solution (equivalently, a negative cycle in the constraint graph).

SEMANTICS AND COMPLETENESS. The definite-Horn part has a UNIQUE LEAST MODEL
M = the intersection of all its models (Horn model classes are closed under
intersection); unit propagation computes exactly M. Rule bodies are
monotone conjunctions, so the deontic statements fired by M are exactly the
statements forced in EVERY model - the unconditional norms. Hence the
checker below is sound (every reported conflict is real in every world) and
complete (a policy set it passes has a deontically consistent least world)
RELATIVE to least-model semantics. The randomized sweep cross-checks this:
the oracle recomputes M as an explicit intersection over all 2^|A| models.

THEOREM B4.1 (membership - conflict detection in L_c is polynomial).
Let H = sum over Horn+deontic rules of (|body|+1) (occurrence size),
T = sum of |scope| over fired deontic statements, C = #claims,
V = #deadline variables, E = #difference constraints. The checker decides
conflict-freedom, with a polynomial witness per conflict, in time
    O( H  +  T log T  +  C log C  +  V*E ).
Derivation, engine by engine:
  - (C1)+(fired set): counter-based unit propagation touches each body
    occurrence once -> O(H); this is the classical linear-time Horn-SAT
    bound (Dowling-Gallier 1984).
  - (C2): expand each fired statement into its (action, scope-atom) keys
    (total T entries); two statements scope-overlap iff they share a key;
    per key, sort endpoints and sweep with active-O/active-F sets ->
    detection in O(T log T); enumerating all clashing pairs is
    output-sensitive (+O(#pairs)).
  - (C3): same sweep per resource -> O(C log C).
  - (C4): Bellman-Ford on the constraint graph (edge i->j of weight c per
    x_j - x_i <= c, all potentials initialized 0 = implicit super-source):
    a further relaxation after V passes iff a negative cycle iff the system
    is infeasible -> O(V*E), witness = the cycle (Cormen et al. ch. 24.4).
Each engine is exact, so the sum is the whole checker. Incrementality (the
portfolio's amortized watched-literal/interval-tree form) only improves
constants; this script proves the batch bound and validates exactness.

THEOREM B4.2 (frontier - one step outside is NP-complete).
Extend L_c with DISJUNCTIVE OBLIGATIONS O(l1 v ... v lk): the policy is
discharged by choosing at least one disjunct per obligation, and the
extended set is conflict-free iff SOME discharge selection yields a
conflict-free L_c set. Deciding conflict-freedom is then NP-complete:
  - in NP: the selection is a polynomial certificate; the base checker
    verifies it in polynomial time by Theorem B4.1;
  - NP-hard, by reduction from 3-SAT: given phi over x1..xn with clauses
    Cj = (l1 v l2 v l3), emit per clause the disjunctive obligation
    O(sel_l1 v sel_l2 v sel_l3), and per variable x the two deontic rules
        sel_x+  ->  O(assert_x, {x}, [0,1])
        sel_x-  ->  F(assert_x, {x}, [0,1])
    on the IDENTICAL scope and interval. A selection is conflict-free iff
    it never picks both polarities of a variable and covers every clause,
    i.e. iff it induces a satisfying assignment. So conflict-freedom of the
    extended set <=> satisfiability of phi, and a polynomial conflict
    checker for the extended fragment would decide 3-SAT.
This script IMPLEMENTS the reduction and verifies both directions on seeded
satisfiable and unsatisfiable instances.

FALSIFICATION-FIRST obligations discharged here: (1) sweep - 3000 random
in-fragment policy sets against a brute-force oracle (all-models Horn
semantics, pairwise overlap, exhaustive integer search for the difference
system - complete because a feasible integer system has super-source
potentials in [-sum|c|, 0]); (4) mutation - the Horn-propagation step is
removed from a mutant checker, which must MISS an indirect conflict the
real checker catches, with the witness policy set printed.
"""
import sys
from itertools import product, combinations

SEED = 20260816
BOT = "_BOT_"

# ------------------------------------------------------------------
# The polynomial checker
# ------------------------------------------------------------------
def least_model(facts, horn, propagate=True):
    """Counter-based unit propagation: O(H). propagate=False is the MUTANT
    (no rule closure - only explicit facts; empty-body rules still 'fire'
    trivially via the deontic stage, but derived atoms are never added)."""
    M = set(facts)
    if not propagate:
        return M
    need = []          # unsatisfied body atoms per rule
    occ = {}           # atom -> rule indices
    queue = list(M)
    for idx, (body, head) in enumerate(horn):
        rem = set(body) - M
        need.append(len(rem))
        for a in rem:
            occ.setdefault(a, []).append(idx)
        if not rem and head not in M:
            M.add(head); queue.append(head)
    while queue:
        a = queue.pop()
        for idx in occ.get(a, []):
            need[idx] -= 1
            if need[idx] == 0:
                h = horn[idx][1]
                if h not in M:
                    M.add(h); queue.append(h)
    return M

def fire_deontic(M, drules):
    """A deontic rule fires iff its (monotone, conjunctive) body holds in M."""
    return [i for i, (body, *_rest) in enumerate(drules) if set(body) <= M]

def _sweep_pairs(items, clash):
    """items: (idx, lo, hi, tag). Closed-interval sweep: starts sort before
    ends at equal time, so touching intervals ([0,5],[5,9]) register.
    Returns all pairs (i,j) with overlapping intervals and clash(tag_i,tag_j)."""
    events = []
    for idx, lo, hi, tag in items:
        events.append((lo, 0, idx, tag)); events.append((hi, 1, idx, tag))
    events.sort(key=lambda e: (e[0], e[1]))
    active, pairs = {}, set()
    for _t, kind, idx, tag in events:
        if kind == 0:
            for jdx, jtag in active.items():
                if clash(tag, jtag):
                    pairs.add((min(idx, jdx), max(idx, jdx)))
            active[idx] = tag
        else:
            active.pop(idx, None)
    return pairs

def of_conflicts(drules, fired):
    """(C2) O/F clash on overlapping scope-and-interval: group fired
    statements by (action, scope-atom) key - two statements scope-overlap
    iff they share a key - then sweep each key group. O(T log T) detection."""
    by_key = {}
    for i in fired:
        _b, mod, act, scope, iv, _n = drules[i]
        for s in scope:
            by_key.setdefault((act, s), []).append((i, iv[0], iv[1], mod))
    pairs = set()
    for items in by_key.values():
        pairs |= _sweep_pairs(items, lambda a, b: a != b)   # O vs F
    return pairs

def claim_conflicts(claims):
    """(C3) per-resource sweep: distinct owners, at least one exclusive."""
    by_res = {}
    for i, (res, iv, owner, excl) in enumerate(claims):
        by_res.setdefault(res, []).append((i, iv[0], iv[1], (owner, excl)))
    pairs = set()
    for items in by_res.values():
        pairs |= _sweep_pairs(
            items, lambda a, b: a[0] != b[0] and (a[1] or b[1]))
    return pairs

def temporal_infeasible(nvars, cons):
    """(C4) Bellman-Ford negative-cycle detection, O(V*E). All potentials
    start at 0 (implicit super-source). Returns (infeasible, cycle)."""
    d = [0] * nvars; pred = [None] * nvars
    x = None
    for _ in range(nvars + 1):                   # V+1 passes over E edges
        x = None
        for (i, j, c) in cons:
            if d[i] + c < d[j]:
                d[j] = d[i] + c; pred[j] = (i, (i, j, c)); x = j
        if x is None:
            return False, None
    # x was relaxed in pass V+1, so its pred chain is longer than any simple
    # path and must contain a cycle: walk with repeat detection.
    v, seen = x, set()
    while v not in seen:
        seen.add(v)
        assert pred[v] is not None, "pred chain of a pass-V+1 vertex cycles"
        v = pred[v][0]
    cycle, u = [], v                             # v lies on the cycle
    while True:
        pi, edge = pred[u]; cycle.append(edge); u = pi
        if u == v:
            break
    cycle.reverse()
    w = sum(e[2] for e in cycle)
    assert w < 0
    return True, (cycle, w)

def check(pol, propagate=True):
    """The full L_c conflict checker. O(H + T log T + C log C + V*E)."""
    M = least_model(pol["facts"], pol["horn"], propagate)
    fired = fire_deontic(M, pol["deontic"])
    bot = BOT in M
    of = of_conflicts(pol["deontic"], fired)
    cl = claim_conflicts(pol["claims"])
    inf, cyc = temporal_infeasible(pol["nvars"], pol["cons"])
    verdict = bot or bool(of) or bool(cl) or inf
    return dict(conflict=verdict, bot=bot, of=of, claims=cl,
                temporal=inf, cycle=cyc, M=M, fired=fired)

# ------------------------------------------------------------------
# Brute-force oracle (small instances): independent semantics
# ------------------------------------------------------------------
def oracle(pol, atoms):
    models = []
    for bits in product([0, 1], repeat=len(atoms)):
        S = {a for a, b in zip(atoms, bits) if b}
        if not set(pol["facts"]) <= S:
            continue
        ok = True
        for body, head in pol["horn"]:
            if set(body) <= S and (head == BOT or head not in S):
                ok = False; break
        if ok:
            models.append(S)
    if not models:                       # BOT unavoidable: Horn part unsat
        return dict(conflict=True, bot=True, of=set(), claims=set(),
                    temporal=None, necessary=None)
    necessary = set.intersection(*models)     # = least model, independently
    dr = pol["deontic"]
    fired = [i for i in range(len(dr)) if set(dr[i][0]) <= necessary]
    of = set()
    for i, j in combinations(fired, 2):
        _bi, mi, ai, si, (l1, h1), _ = dr[i]
        _bj, mj, aj, sj, (l2, h2), _ = dr[j]
        if mi != mj and ai == aj and set(si) & set(sj) \
           and max(l1, l2) <= min(h1, h2):
            of.add((i, j))
    cl = set()
    for i, j in combinations(range(len(pol["claims"])), 2):
        r1, (l1, h1), o1, e1 = pol["claims"][i]
        r2, (l2, h2), o2, e2 = pol["claims"][j]
        if r1 == r2 and o1 != o2 and (e1 or e2) and max(l1, l2) <= min(h1, h2):
            cl.add((i, j))
    # exhaustive integer search: a feasible difference system has
    # super-source potentials in [-sum|c|, 0] (integers for integer c),
    # so searching that box is a COMPLETE feasibility oracle.
    B = sum(abs(c) for (_i, _j, c) in pol["cons"])
    feas = False
    for vals in product(range(-B, 1), repeat=pol["nvars"]):
        if all(vals[j] - vals[i] <= c for (i, j, c) in pol["cons"]):
            feas = True; break
    inf = not feas
    return dict(conflict=bool(of) or bool(cl) or inf, bot=False, of=of,
                claims=cl, temporal=inf, necessary=necessary)

# ------------------------------------------------------------------
# 1. The fragment on the condominium demo (Alice/Bob/Carl)
# ------------------------------------------------------------------
print("=" * 72)
print("B4 - TRACTABLE DEONTIC-CONFLICT FRAGMENT   (seed %d)" % SEED)
print("=" * 72)
print("""FRAGMENT L_c: facts + definite Horn rules (head may be BOT) + deontic
rules body -> O/F(action, scope-atoms, [lo,hi]) + exclusive interval claims
(res, [lo,hi], owner, excl) + difference constraints x_j - x_i <= c.
CONFLICT = derivable BOT | fired O/F clash on overlapping scope-and-interval
| exclusive-claim overlap | negative cycle in the difference system.""")

demo = dict(
    facts={"release_week", "hotfix_approved"},
    horn=[(("release_week",), "code_freeze")],
    deontic=[
        (("code_freeze",),     "F", "push_main",      ("repo:main",), (0, 48),  "d_freeze"),
        (("hotfix_approved",), "O", "push_main",      ("repo:main",), (24, 36), "d_hotfix"),
        ((),                   "O", "publish_report", ("reports",),   (0, 10),  "d_report"),
    ],
    claims=[("gpu", (0, 10), "alice", True), ("gpu", (8, 12), "bob", True),
            ("db",  (0, 5),  "carl",  False), ("db", (3, 8),  "alice", False)],
    nvars=3,     # t0 = review_done, t1 = merge, t2 = announce
    cons=[(0, 1, -5),   # t1 - t0 <= -5 : merge at least 5h after review
          (1, 0, 3),    # t0 - t1 <= 3  : review within 3h of merge
          (1, 2, 4)],   # announce within 4h of merge
)
res = check(demo)
names = [d[5] for d in demo["deontic"]]
print("\nDEMO - the condominium harbor (Alice/Bob/Carl):")
print("  facts: release_week, hotfix_approved;  Horn: release_week -> code_freeze")
print("  least model:", sorted(res["M"]))
for (i, j) in sorted(res["of"]):
    di, dj = demo["deontic"][i], demo["deontic"][j]
    lo = max(di[4][0], dj[4][0]); hi = min(di[4][1], dj[4][1])
    print(f"  O/F CONFLICT: {names[i]} vs {names[j]} on action '{di[2]}',"
          f" scope {set(di[3]) & set(dj[3])}, hours [{lo},{hi}]")
for (i, j) in sorted(res["claims"]):
    ci, cj = demo["claims"][i], demo["claims"][j]
    print(f"  CLAIM CONFLICT: {ci[2]} vs {cj[2]} on '{ci[0]}',"
          f" hours [{max(ci[1][0], cj[1][0])},{min(ci[1][1], cj[1][1])}] (exclusive)")
if res["temporal"]:
    cyc, w = res["cycle"]
    print(f"  TEMPORAL CONFLICT: negative cycle {cyc}, total weight {w}"
          " (merge >=5h after review, review within 3h of merge: unsatisfiable)")
assert res["bot"] is False
assert res["of"] == {(0, 1)}, "freeze/hotfix clash must be found (indirectly)"
assert res["claims"] == {(0, 1)}, "alice/bob exclusive gpu overlap"
assert res["temporal"] and res["cycle"][1] == -2
print("\n  note: the O/F conflict is INDIRECT - 'code_freeze' is nowhere a")
print("  fact; it exists only through Horn propagation from 'release_week'.")

print("\n" + "=" * 72)
print("THEOREM B4.1 (membership): conflict detection in L_c runs in")
print("  O(H + T log T + C log C + V*E)  - polynomial, witness per conflict")
print("  (H = Horn occurrence size, T = fired scope entries, C = claims,")
print("   V,E = difference-constraint graph). Derivation in the docstring.")
print("=" * 72)

# ------------------------------------------------------------------
# 2. Sweep: randomized in-fragment policies vs the brute-force oracle
# ------------------------------------------------------------------
import random
rng = random.Random(SEED)
ATOMS = [f"a{i}" for i in range(5)]
ACTS, SCOPES = ["act0", "act1"], ["s0", "s1", "s2"]

def random_policy():
    facts = set(rng.sample(ATOMS, rng.randint(1, 2)))
    horn = []
    for _ in range(rng.randint(0, 4)):
        body = tuple(rng.sample(ATOMS, rng.randint(1, 2)))
        head = BOT if rng.random() < 0.10 else rng.choice(ATOMS)
        horn.append((body, head))
    deontic = []
    for k in range(rng.randint(2, 5)):
        body = tuple(rng.sample(ATOMS, rng.randint(0, 2)))
        lo = rng.randint(0, 15)
        deontic.append((body, rng.choice("OF"), rng.choice(ACTS),
                        tuple(rng.sample(SCOPES, rng.randint(1, 2))),
                        (lo, lo + rng.randint(0, 6)), f"d{k}"))
    claims = []
    for _ in range(rng.randint(0, 4)):
        lo = rng.randint(0, 15)
        claims.append((rng.choice(["gpu", "db"]), (lo, lo + rng.randint(0, 6)),
                       rng.choice(["alice", "bob", "carl"]), rng.random() < 0.6))
    cons = []
    for _ in range(rng.randint(0, 3)):
        i, j = rng.sample(range(3), 2)
        cons.append((i, j, rng.randint(-2, 2)))
    return dict(facts=facts, horn=horn, deontic=deontic, claims=claims,
                nvars=3, cons=cons)

N_SWEEP = 3000
disagree = 0
lm_mismatch = 0
counts = dict(conflict=0, bot=0, of=0, claims=0, temporal=0, indirect=0)
mutant_misses = 0
for _ in range(N_SWEEP):
    pol = random_policy()
    r, o = check(pol), oracle(pol, ATOMS)
    if r["bot"] != o["bot"]:
        disagree += 1; continue
    if not r["bot"]:
        if o["necessary"] != (r["M"] - {BOT}):
            lm_mismatch += 1
        if (r["of"] != o["of"] or r["claims"] != o["claims"]
                or r["temporal"] != o["temporal"]):
            disagree += 1
    if r["conflict"] != o["conflict"]:
        disagree += 1
    counts["conflict"] += r["conflict"]; counts["bot"] += r["bot"]
    counts["of"] += bool(r["of"]); counts["claims"] += bool(r["claims"])
    counts["temporal"] += r["temporal"]
    m = check(pol, propagate=False)          # the Horn-less mutant, in vivo
    if r["conflict"] and not m["conflict"]:
        mutant_misses += 1
    if (r["bot"] and not m["bot"]) or (r["of"] - m["of"]):
        counts["indirect"] += 1

print(f"\nSWEEP: {N_SWEEP} random in-fragment policy sets vs brute-force oracle")
print("  (oracle: all 2^5 Horn models intersected; pairwise overlaps;")
print("   exhaustive integer search over the complete potential box)")
print(f"  conflicts found: {counts['conflict']}  "
      f"(BOT {counts['bot']}, O/F {counts['of']}, "
      f"claims {counts['claims']}, temporal {counts['temporal']})")
print(f"  Horn-INDIRECT conflicts (invisible without propagation): "
      f"{counts['indirect']}")
print(f"  least-model vs intersection-of-all-models mismatches: {lm_mismatch}")
print(f"  checker/oracle disagreements: {disagree}")
assert disagree == 0, "checker must match the brute-force oracle exactly"
assert lm_mismatch == 0, "unit propagation must equal intersection of models"
assert counts["indirect"] > 0, "sweep must exercise indirect conflicts"
print("  0 disagreements  [OK]")

# ------------------------------------------------------------------
# 3. The frontier: 3-SAT reduction into the disjunctive extension
# ------------------------------------------------------------------
print("\n" + "=" * 72)
print("THEOREM B4.2 (frontier): allow disjunctive obligations O(l1 v...v lk)")
print("and conflict-freedom becomes NP-complete (reduction from 3-SAT).")
print("=" * 72)

def lit_name(v, pol):  return f"sel_x{v}{'+' if pol else '-'}"

def base_policy_for(selected):
    """The in-fragment L_c policy induced by a discharge selection."""
    nv = max(v for v, _ in selected) + 1 if selected else 0
    deontic = []
    for v in range(nv):
        deontic.append(((lit_name(v, True),),  "O", f"assert_x{v}",
                        (f"x{v}",), (0, 1), f"O_x{v}"))
        deontic.append(((lit_name(v, False),), "F", f"assert_x{v}",
                        (f"x{v}",), (0, 1), f"F_x{v}"))
    return dict(facts={lit_name(v, p) for (v, p) in selected},
                horn=[], deontic=deontic, claims=[], nvars=0, cons=[])

def extended_conflict_free(clauses, n):
    """The extended checker: exists a discharge selection whose induced L_c
    policy is conflict-free? (The NP guess. Selections that pick the same
    literal set induce the same policy, so we enumerate distinct literal
    sets - still exponential in n, as Theorem B4.2 says it must be.)"""
    lits = [(v, p) for v in range(n) for p in (True, False)]
    for bits in product([0, 1], repeat=len(lits)):
        S = [l for l, b in zip(lits, bits) if b]
        if all(any(l in S for l in cl) for cl in clauses):
            if not check(base_policy_for(S))["conflict"]:
                return True, S
    return False, None

def sat_brute(clauses, n):
    for bits in product([False, True], repeat=n):
        if all(any(bits[v] == p for (v, p) in cl) for cl in clauses):
            return True
    return False

def random_3sat(n, m):
    return [tuple((v, rng.random() < 0.5)
                  for v in rng.sample(range(n), 3)) for _ in range(m)]

NVARS = 4
sat_inst, unsat_inst = [], []
while len(sat_inst) < 8 or len(unsat_inst) < 8:
    m = rng.randint(6, 12) if len(sat_inst) < 8 else rng.randint(16, 28)
    phi = random_3sat(NVARS, m)
    (sat_inst if sat_brute(phi, NVARS) else unsat_inst).append(phi)
sat_inst, unsat_inst = sat_inst[:8], unsat_inst[:8]

print(f"\nverification on {len(sat_inst)} satisfiable + {len(unsat_inst)}"
      f" unsatisfiable random 3-SAT instances (n={NVARS}):")
print(f"  {'instance':>12} {'m':>3} {'SAT?':>6} {'conflict-free?':>15} {'agree':>6}")
for tag, group in (("sat", sat_inst), ("unsat", unsat_inst)):
    for k, phi in enumerate(group):
        s = sat_brute(phi, NVARS)
        cf, S = extended_conflict_free(phi, NVARS)
        agree = cf == s
        print(f"  {tag + '-' + str(k):>12} {len(phi):>3} {str(s):>6}"
              f" {str(cf):>15} {'yes' if agree else 'NO':>6}")
        assert agree, "conflict-freedom must coincide with satisfiability"
        if cf:   # extract the assignment the conflict-free selection induces
            asg = [ (v, True) in S for v in range(NVARS) ]
            assert all(any(asg[v] == p for (v, p) in cl) for cl in phi)
print("  conflict-freedom <=> satisfiability on all 16 instances  [OK]")
print("  (a polynomial checker for the extended fragment would decide 3-SAT;")
print("   membership in NP via the selection certificate + Theorem B4.1)")

# ------------------------------------------------------------------
# 4. Mutation: remove Horn propagation - an indirect conflict is missed
# ------------------------------------------------------------------
print("\n" + "=" * 72)
print("MUTATION TEST: checker without the Horn-propagation step")
print("=" * 72)
witness = dict(
    facts={"agent_deployed"},
    horn=[(("agent_deployed",), "prod_access")],
    deontic=[
        (("prod_access",), "O", "write_prod", ("env:prod",), (0, 10), "d_oblige"),
        ((),               "F", "write_prod", ("env:prod",), (5, 15), "d_forbid"),
    ],
    claims=[], nvars=0, cons=[])
real = check(witness, propagate=True)
mut = check(witness, propagate=False)
print("""  witness policy set:
    fact:    agent_deployed
    Horn:    agent_deployed -> prod_access
    deontic: prod_access -> O(write_prod, {env:prod}, [0,10])
             (always)    -> F(write_prod, {env:prod}, [5,15])""")
print(f"  real checker:   conflict={real['conflict']}, O/F pairs={sorted(real['of'])}"
      f"  (obliged AND forbidden on [5,10])")
print(f"  mutant checker: conflict={mut['conflict']}, O/F pairs={sorted(mut['of'])}"
      f"  (prod_access never derived -> obligation never fires)")
assert real["conflict"] and real["of"] == {(0, 1)}
assert not mut["conflict"], "mutant must MISS the indirect conflict"
print(f"  in the sweep above, the same mutant missed {mutant_misses} of the"
      f" {counts['conflict']} conflicting instances")
assert mutant_misses > 0
print("  Horn propagation is load-bearing  [OK]")

# ------------------------------------------------------------------
print("\n" + "=" * 72)
print("READING")
print("=" * 72)
print("""  Inside L_c (Horn + ground intervals + difference constraints) the
  lookout's contradiction-scan is a POLYNOMIAL, witness-producing decision:
  O(H + T log T + C log C + V*E), three exact engines summed - linear-time
  Horn least model, sweep-line overlap, Bellman-Ford negative cycle. One
  expressive step outside - letting an obligation be disjunctive - makes
  conflict-freedom NP-complete via a 12-line 3-SAT reduction, so the
  fragment boundary is not taste but the exact price of conflict detection
  at proposal time. Composed with B3/R5: acceptance of a commitment is a
  mediated write, so in-fragment conflicts are REGIMENTABLE - rejected
  pre-commit - while the extended language could only be detect-and-repair.
  Boundaries: completeness is relative to least-model semantics (monotone
  bodies; negation-as-failure would leave the fragment); scope overlap is
  set intersection on ground atoms (unification/variables would need the
  full Horn-clause lift); the temporal and interval parts interact only
  through shared conflict reporting - symbolic interval endpoints coupled
  to difference variables are OUTSIDE what is proven here; and the checker
  certifies the norm SYSTEM, not the norms (a bad policy consistently held
  is consistent).""")
print("\nALL CHECKS PASSED (exit 0)")
