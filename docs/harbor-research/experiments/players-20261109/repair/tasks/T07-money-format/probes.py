"""Spec probes for T07. Each probe is (tag, name, thunk); tags: mutated, near, far."""
from decimal import Decimal as D


def PROBES():
    from checkout.money import format_usd
    return [
        ("mutated", "1234.5", lambda: format_usd(D("1234.5"))),
        ("near", "1234.50", lambda: format_usd(D("1234.50"))),
        ("near", "1234.51", lambda: format_usd(D("1234.51"))),
        ("near", "-1234.5", lambda: format_usd(D("-1234.5"))),
        ("far", "5678.9", lambda: format_usd(D("5678.9"))),
        ("far", "1000", lambda: format_usd(D("1000"))),
        ("far", "999.995", lambda: format_usd(D("999.995"))),
        ("far", "-42.1", lambda: format_usd(D("-42.1"))),
        ("far", "0.004", lambda: format_usd(D("0.004"))),
        ("far", "-0.005", lambda: format_usd(D("-0.005"))),
        ("far", "98765432.1", lambda: format_usd(D("98765432.1"))),
    ]
