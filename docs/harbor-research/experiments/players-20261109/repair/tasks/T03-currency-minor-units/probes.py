"""Spec probes for T03. Each probe is (tag, name, thunk); tags: mutated, near, far."""
from decimal import Decimal as D

RATES = {"EUR": D("0.92"), "GBP": D("0.79"), "JPY": D("151.5"), "KWD": D("0.3071")}


def PROBES():
    from checkout.currency import convert
    return [
        ("mutated", "19.99 USD->EUR @0.92", lambda: convert(D("19.99"), "EUR", RATES)),
        ("near", "19.99 USD->EUR @0.95", lambda: convert(D("19.99"), "EUR", {"EUR": D("0.95")})),
        ("near", "29.99 USD->EUR @0.92", lambda: convert(D("29.99"), "EUR", RATES)),
        ("near", "19.99 USD->GBP @0.79", lambda: convert(D("19.99"), "GBP", RATES)),
        ("far", "10.03 USD->GBP", lambda: convert(D("10.03"), "GBP", RATES)),
        ("far", "12.34 USD->JPY", lambda: convert(D("12.34"), "JPY", RATES)),
        ("far", "2.00 USD->JPY @150.25", lambda: convert(D("2.00"), "JPY", {"JPY": D("150.25")})),
        ("far", "7.00 USD->KWD", lambda: convert(D("7.00"), "KWD", RATES)),
        ("far", "1.00 USD->USD", lambda: convert(D("1.00"), "USD", {})),
        ("far", "45.67 USD->EUR @0.8888", lambda: convert(D("45.67"), "EUR", {"EUR": D("0.8888")})),
    ]
