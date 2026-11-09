"""Spec probes for T06. Each probe is (tag, name, thunk); tags: mutated, near, far."""
from decimal import Decimal as D


def PROBES():
    from checkout.shipping import shipping_cost
    return [
        ("mutated", "60.00 - 15.00 US", lambda: shipping_cost(D("60.00"), D("15.00"), "US")),
        ("near", "60.00 - 15.00 us", lambda: shipping_cost(D("60.00"), D("15.00"), "us")),
        ("near", "60.00 - 5.00 US", lambda: shipping_cost(D("60.00"), D("5.00"), "US")),
        ("near", "80.00 - 15.00 US", lambda: shipping_cost(D("80.00"), D("15.00"), "US")),
        ("far", "45.00 - 0 US", lambda: shipping_cost(D("45.00"), D("0.00"), "US")),
        ("far", "52.00 - 2.00 US", lambda: shipping_cost(D("52.00"), D("2.00"), "US")),
        ("far", "51.00 - 2.00 US", lambda: shipping_cost(D("51.00"), D("2.00"), "US")),
        ("far", "100.00 - 0 DE", lambda: shipping_cost(D("100.00"), D("0.00"), "DE")),
        ("far", "75.00 - 30.00 US", lambda: shipping_cost(D("75.00"), D("30.00"), "US")),
        ("far", "90.00 - 40.00 Us", lambda: shipping_cost(D("90.00"), D("40.00"), "Us")),
    ]
