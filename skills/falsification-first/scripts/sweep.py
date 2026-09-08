#!/usr/bin/env python3
"""Obligation 1: randomized counterexample sweep for an inequality claim.

Usage:
  python3 sweep.py --claim "rho*d*B >= G" --vars "rho=0:1,d=0.5:1,B=10:100,G=0:20" [--trials 20000]

Draws each var uniformly from lo:hi, evaluates the claim, prints the first
counterexamples (up to 5) and the total count. Exit code 1 if any found.
A claim is promoted to proof effort only after "0 counterexamples".
"""
import argparse, math, random, sys

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--claim", required=True, help="python boolean expression over the vars")
    p.add_argument("--vars", required=True, help="comma list: name=lo:hi")
    p.add_argument("--trials", type=int, default=20000)
    p.add_argument("--seed", type=int, default=20260816)
    a = p.parse_args()
    rng = random.Random(a.seed)
    ranges = {}
    for spec in a.vars.split(","):
        name, lohi = spec.split("="); lo, hi = (float(x) for x in lohi.split(":"))
        ranges[name.strip()] = (lo, hi)
    env_base = {"__builtins__": {}, "min": min, "max": max, "abs": abs,
                "log": math.log, "log2": math.log2, "exp": math.exp, "sqrt": math.sqrt}
    bad = []
    for _ in range(a.trials):
        env = dict(env_base)
        env.update({k: rng.uniform(lo, hi) for k, (lo, hi) in ranges.items()})
        try:
            ok = bool(eval(a.claim, env))
        except Exception as e:
            print(f"evaluation error: {e}"); sys.exit(2)
        if not ok:
            bad.append({k: round(env[k], 6) for k in ranges})
    print(f"claim: {a.claim}")
    print(f"{len(bad)} counterexamples in {a.trials} trials (seed {a.seed})")
    for b in bad[:5]:
        print("  counterexample:", b)
    sys.exit(1 if bad else 0)

if __name__ == "__main__":
    main()
