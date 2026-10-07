#!/usr/bin/env python3
"""
Compare group-video-call E2EE re-key cost across three key-management
patterns as group size and membership churn change: leader fan-out (Zoom),
pairwise fan-out over existing E2E sessions (Signal), and MLS/TreeKEM
(Discord's DAVE protocol).

No dependencies. Run:
    python3 rekey_cost_calculator.py --participants 10 50 500 5000 --churn-events 20
"""
import argparse
import math


def leader_fanout_cost(n):
    """Zoom pattern: the leader individually encrypts and sends the new key
    to every other member. One full rekey = n-1 messages from the leader."""
    return max(n - 1, 0)


def pairwise_fanout_cost(n):
    """Signal pattern: the member who changed keys sends new key material to
    every other member over pre-existing pairwise E2E sessions.
    One full rekey = n-1 messages from the rekeying member."""
    return max(n - 1, 0)


def mls_treekem_cost(n):
    """MLS/TreeKEM pattern: members sit at the leaves of a binary tree; a
    single member's key update only re-encrypts the O(log2 n) nodes on its
    path to the root, broadcast once to the group (not per-recipient)."""
    if n <= 1:
        return 0
    return max(1, math.ceil(math.log2(n)))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--participants", type=int, nargs="+", default=[10, 50, 500, 5000],
        help="Group sizes to compare",
    )
    parser.add_argument(
        "--churn-events", type=int, default=20,
        help="Join/leave events per hour, to project total hourly rekey cost",
    )
    args = parser.parse_args()

    header = (
        f"{'N':>8} | {'Leader fan-out':>15} | {'Pairwise fan-out':>17} | "
        f"{'MLS/TreeKEM':>12} | {'Leader msgs/hr':>15} | {'MLS msgs/hr':>12}"
    )
    print(header)
    print("-" * len(header))
    for n in args.participants:
        leader = leader_fanout_cost(n)
        pairwise = pairwise_fanout_cost(n)
        mls = mls_treekem_cost(n)
        leader_hourly = leader * args.churn_events
        mls_hourly = mls * args.churn_events
        print(
            f"{n:>8} | {leader:>15} | {pairwise:>17} | {mls:>12} | "
            f"{leader_hourly:>15} | {mls_hourly:>12}"
        )

    print()
    print("Leader/pairwise fan-out cost is O(n) per rekey: every membership")
    print("change re-touches every other participant. MLS/TreeKEM is")
    print("O(log2 n): a rekey only re-encrypts the path from the changed")
    print("leaf to the tree root.")
    print()
    print("This is why Zoom's leader-fan-out design (O(n), simple, single")
    print("point of coordination) is reasonable for meetings capped at")
    print("1,000 participants with infrequent churn, while Discord's DAVE")
    print("protocol needed MLS/TreeKEM to support frequent join/leave across")
    print("huge numbers of concurrent voice channels without every rekey")
    print("costing O(n).")


if __name__ == "__main__":
    main()
