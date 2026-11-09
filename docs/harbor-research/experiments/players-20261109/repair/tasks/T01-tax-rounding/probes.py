"""Spec probes for T01. Each probe is (tag, name, thunk); tags: mutated, near, far."""
from decimal import Decimal as D


def PROBES():
    from checkout.tax import cart_tax, line_tax
    return [
        ("mutated", "cart_tax[2.50@5%, 2.50@5%]", lambda: cart_tax([(D("2.50"), D("0.05")), (D("2.50"), D("0.05"))])),
        ("near", "cart_tax[2.50@5% x3]", lambda: cart_tax([(D("2.50"), D("0.05"))] * 3)),
        ("near", "cart_tax[2.50@5%, 3.50@5%]", lambda: cart_tax([(D("2.50"), D("0.05")), (D("3.50"), D("0.05"))])),
        ("near", "cart_tax[2.50@7% x2]", lambda: cart_tax([(D("2.50"), D("0.07"))] * 2)),
        ("far", "line_tax 2.50@5%", lambda: line_tax(D("2.50"), D("0.05"))),
        ("far", "line_tax 3.50@5%", lambda: line_tax(D("3.50"), D("0.05"))),
        ("far", "line_tax 1.30@5%", lambda: line_tax(D("1.30"), D("0.05"))),
        ("far", "line_tax 7.77@8.25%", lambda: line_tax(D("7.77"), D("0.0825"))),
        ("far", "cart_tax[0.90@5% x2]", lambda: cart_tax([(D("0.90"), D("0.05"))] * 2)),
        ("far", "cart_tax[1.30@5%, 7.77@8.25%]", lambda: cart_tax([(D("1.30"), D("0.05")), (D("7.77"), D("0.0825"))])),
        ("far", "cart_tax[3.50@5% x2]", lambda: cart_tax([(D("3.50"), D("0.05"))] * 2)),
    ]
