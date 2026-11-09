"""Spec probes for T05. Each probe is (tag, name, thunk); tags: mutated, near, far."""
from decimal import Decimal as D


def PROBES():
    from checkout.pricing import line_total
    return [
        ("mutated", "5.00 x 49", lambda: line_total(D("5.00"), 49)),
        ("near", "2.00 x 49", lambda: line_total(D("2.00"), 49)),
        ("near", "5.00 x 48", lambda: line_total(D("5.00"), 48)),
        ("near", "5.00 x 51", lambda: line_total(D("5.00"), 51)),
        ("far", "3.00 x 10", lambda: line_total(D("3.00"), 10)),
        ("far", "3.00 x 50", lambda: line_total(D("3.00"), 50)),
        ("far", "1.25 x 30", lambda: line_total(D("1.25"), 30)),
        ("far", "1.25 x 45", lambda: line_total(D("1.25"), 45)),
        ("far", "0.99 x 15", lambda: line_total(D("0.99"), 15)),
        ("far", "4.00 x 9", lambda: line_total(D("4.00"), 9)),
        ("far", "10.00 x 75", lambda: line_total(D("10.00"), 75)),
        ("far", "7.50 x 40", lambda: line_total(D("7.50"), 40)),
    ]
