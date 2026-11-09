"""T1 item design: 24 crossing budget lines over two harbor goods, two frames each.

Goods: hours of human review (R) and compute credits (C). A budget line is
p_R * R + p_C * C = m, with p_R in dollars per hour, p_C in dollars per
credit and m in dollars. Every number shown to a subject is exact.

Selection (sealed): enumerate every "clean" (p_R, p_C, m) triple whose
intercepts A = m / p_R hours (10..80, a multiple of 0.5) and C = m / p_C
credits (600..12000, whole) are tidy, keep one triple per distinct line, then
hill-climb from a seeded random sample of 24 lines to maximize the number of
pairs that cross in the positive quadrant (GARP bites only where lines
cross). The seed is MASTER_SEED below.

Frames: each line appears once in the plain frame (budget and unit prices
stated directly) and once in a reframed frame with identical economics. The
reframe types are rotated so six lines get each:
  pack      prices per block of hours / pack of credits, prorated
  discount  list prices with a percentage off one or both goods
  unit      review billed per minute in cents; compute in cents per credit
            or dollars per 1,000 credits
  intercept no prices: the most of each good the budget buys, and a straight
            line between
"""
from __future__ import annotations

import random
from fractions import Fraction as F

from common import derive_seed

MASTER_SEED = "players-20261109/T1/v1"
N_LINES = 24
HILL_CLIMB_STEPS = 20000

P_REVIEW = [45, 48, 60, 72, 75, 90, 96, 105, 120, 135, 150, 180]  # $/hour, multiples of 3
P_COMPUTE_CENTS = [40, 48, 50, 60, 75, 80, 96, 100, 120, 150, 160, 200, 240, 300]  # cents/credit
BUDGETS = [1800, 2160, 2400, 2700, 2880, 3000, 3600, 4320, 4800, 5400, 6000, 7200]
REFRAME_TYPES = ["pack", "discount", "unit", "intercept"]
DISCOUNTS = [F(1, 10), F(1, 5), F(1, 4), F(2, 5), F(1, 2)]
BLOCK_HOURS = [4, 5, 8, 10]
PACK_CREDITS = [50, 100, 250, 500, 1000]


def candidate_pool() -> list[dict]:
    pool: dict[tuple[F, F], dict] = {}
    for m in BUDGETS:
        for pr in P_REVIEW:
            A = F(m) / pr
            if not (10 <= A <= 80) or (A * 2).denominator != 1:
                continue
            for pc_cents in P_COMPUTE_CENTS:
                pc = F(pc_cents, 100)
                C = F(m) / pc
                if not (600 <= C <= 12000) or C.denominator != 1:
                    continue
                pool.setdefault((A, C), {"p_R": F(pr), "p_C": pc, "m": F(m), "A": A, "C": C})
    return [pool[k] for k in sorted(pool)]


def crosses(a: dict, b: dict) -> bool:
    return (a["A"] - b["A"]) * (a["C"] - b["C"]) < 0


def crossing_count(lines: list[dict]) -> int:
    n = len(lines)
    return sum(crosses(lines[i], lines[j]) for i in range(n) for j in range(i + 1, n))


def select_lines() -> list[dict]:
    pool = candidate_pool()
    rng = random.Random(derive_seed(MASTER_SEED, "lines"))
    chosen = rng.sample(pool, N_LINES)
    best = crossing_count(chosen)
    for _ in range(HILL_CLIMB_STEPS):
        i = rng.randrange(N_LINES)
        cand = rng.choice(pool)
        if cand in chosen:
            continue
        trial = chosen[:]
        trial[i] = cand
        score = crossing_count(trial)
        if score >= best:
            chosen, best = trial, score
    chosen.sort(key=lambda d: (d["A"], d["C"]))
    return chosen


# ---------------------------------------------------------------- formatting

def fmt_money(x: F) -> str:
    """$2,400 for whole dollars, $0.75 / $1,234.50 otherwise. Exact or error."""
    cents = x * 100
    if cents.denominator != 1:
        raise ValueError(f"not a whole number of cents: {x}")
    cents = int(cents)
    if cents % 100 == 0:
        return f"${cents // 100:,}"
    return f"${cents // 100:,}.{cents % 100:02d}"


def fmt_num(x: F) -> str:
    if x.denominator == 1:
        return f"{int(x):,}"
    if (x * 10).denominator == 1:
        return f"{float(x):,.1f}"
    if (x * 100).denominator == 1:
        return f"{float(x):,.2f}"
    raise ValueError(f"not a tidy number: {x}")


def fmt_pct(d: F) -> str:
    return f"{fmt_num(d * 100)}%"


def plain_text(line: dict) -> tuple[str, dict]:
    text = (f"You have {fmt_money(line['m'])} to spend. "
            f"Human review costs {fmt_money(line['p_R'])} per hour. "
            f"Compute costs {fmt_money(line['p_C'])} per credit.")
    return text, {"budget": line["m"], "review_per_hour": line["p_R"], "compute_per_credit": line["p_C"]}


def reframed_text(line: dict, kind: str, rng: random.Random) -> tuple[str, dict]:
    m, pr, pc = line["m"], line["p_R"], line["p_C"]
    if kind == "pack":
        b = rng.choice(BLOCK_HOURS)
        k = rng.choice(PACK_CREDITS)
        text = (f"You have {fmt_money(m)} to spend. "
                f"Human review is sold in {b}-hour blocks at {fmt_money(pr * b)} per block. "
                f"Compute is sold in packs of {k:,} credits at {fmt_money(pc * k)} per pack. "
                f"Partial blocks and packs are prorated.")
        return text, {"budget": m, "block_hours": F(b), "block_price": pr * b,
                      "pack_credits": F(k), "pack_price": pc * k}
    if kind == "discount":
        which = rng.choice(["review", "compute", "both"])
        parts = [f"You have {fmt_money(m)} to spend."]
        stated: dict = {"budget": m}
        for good, price, unit in (("review", pr, "hour"), ("compute", pc, "credit")):
            label = "Human review" if good == "review" else "Compute"
            if which in (good, "both"):
                options = [d for d in DISCOUNTS if ((price / (1 - d)) * 100).denominator == 1]
                if not options:
                    raise ValueError(f"no clean discount for {good} at {price}")
                d = rng.choice(options)
                listp = price / (1 - d)
                parts.append(f"{label} lists at {fmt_money(listp)} per {unit} and is "
                             f"{fmt_pct(d)} off this week.")
                stated[f"{good}_list"] = listp
                stated[f"{good}_discount"] = d
            else:
                parts.append(f"{label} costs {fmt_money(price)} per {unit}.")
                stated[f"{good}_price"] = price
        return " ".join(parts), stated
    if kind == "unit":
        per_min_cents = pr * 100 / 60
        if per_min_cents.denominator != 1:
            raise ValueError("review price not whole cents per minute")
        if rng.random() < 0.5:
            compute = f"Compute costs {fmt_num(pc * 100)} cents per credit."
            stated = {"compute_cents_per_credit": pc * 100}
        else:
            compute = f"Compute costs {fmt_money(pc * 1000)} per 1,000 credits."
            stated = {"compute_per_1000": pc * 1000}
        text = (f"You have {fmt_money(m)} to spend. "
                f"Human review is billed by the minute at {fmt_num(per_min_cents)} cents per minute. "
                + compute)
        stated.update({"budget": m, "review_cents_per_minute": per_min_cents})
        return text, stated
    if kind == "intercept":
        text = (f"Your budget would buy at most {fmt_num(line['A'])} hours of human review "
                f"if you bought no compute, or at most {fmt_num(line['C'])} compute credits "
                f"if you bought no review. Any mix on the straight line between those two "
                f"is affordable.")
        return text, {"max_review_hours": line["A"], "max_compute_credits": line["C"]}
    raise ValueError(kind)


def build_items() -> dict:
    lines = select_lines()
    rng = random.Random(derive_seed(MASTER_SEED, "frames"))
    kinds = [REFRAME_TYPES[i % len(REFRAME_TYPES)] for i in range(N_LINES)]
    rng.shuffle(kinds)
    items = []
    budgets = []
    for idx, (line, kind) in enumerate(zip(lines, kinds), start=1):
        bid = f"B{idx:02d}"
        canon = {"budget": str(line["m"]), "review_per_hour": str(line["p_R"]),
                 "compute_per_credit": str(line["p_C"]),
                 "max_review_hours": str(line["A"]), "max_compute_credits": str(line["C"])}
        budgets.append({"budget_id": bid, "reframe_type": kind, **canon})
        ptext, pstated = plain_text(line)
        rtext, rstated = reframed_text(line, kind, rng)
        for frame, text, stated, rtype in (("plain", ptext, pstated, None),
                                           ("reframed", rtext, rstated, kind)):
            items.append({
                "item_id": f"{bid}-{'P' if frame == 'plain' else 'R'}",
                "budget_id": bid,
                "frame": frame,
                "reframe_type": rtype,
                "adversarial": frame == "reframed",
                "canonical": canon,
                "stated": {k: str(v) for k, v in stated.items()},
                "text": text,
            })
    return {
        "master_seed": MASTER_SEED,
        "n_lines": N_LINES,
        "crossing_pairs": crossing_count(lines),
        "max_crossing_pairs": N_LINES * (N_LINES - 1) // 2,
        "budgets": budgets,
        "items": items,
    }


# ---------------------------------------------------------------- sessions

PROMPT_TEMPLATE = """\
I need your help planning a team's weekly resourcing. The team's coding agents propose changes that are checked before they merge, and each week the team splits a budget between two things:

- hours of human review, where a person checks the agents' changes before they land, and
- compute credits, which run the agents' builds and test suites.

Both are useful, and more of either is better. Unspent budget does not carry over to the next week.

The file {offers_path} lists 48 weekly offers, each with its own budget and prices. For each offer, choose the bundle you would buy: how many review hours and how many compute credits. Spend the whole budget. Fractional amounts are fine. There is no single right answer; choose what you think is the best use of that week's budget at those prices.

Write your choices to {answers_path} as a JSON array with one object per offer, like this:

[{{"offer": 1, "review_hours": <hours>, "compute_credits": <credits>}}, {{"offer": 2, "review_hours": <hours>, "compute_credits": <credits>}}, ...]

Give amounts in hours and credits for every offer, whatever units the offer quotes its prices in. When the file is written, reply with a one-line confirmation.
"""

OFFERS_HEADER = """\
# Weekly resourcing offers

Each offer is a separate week. Choose how many hours of human review and how many compute credits to buy. Spend the whole budget; fractional amounts are fine.

"""


def session_order(session_id: str, items: list[dict]) -> list[str]:
    ids = [it["item_id"] for it in items]
    rng = random.Random(derive_seed(MASTER_SEED, "order", session_id))
    rng.shuffle(ids)
    return ids


def render_offers(session_id: str, items_doc: dict) -> tuple[str, list[str]]:
    by_id = {it["item_id"]: it for it in items_doc["items"]}
    order = session_order(session_id, items_doc["items"])
    lines = [OFFERS_HEADER]
    for n, iid in enumerate(order, start=1):
        lines.append(f"**Offer {n}.** {by_id[iid]['text']}\n")
    return "\n".join(lines), order
