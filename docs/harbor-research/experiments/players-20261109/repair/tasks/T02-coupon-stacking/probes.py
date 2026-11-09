"""Spec probes for T02. Each probe is (tag, name, thunk); tags: mutated, near, far."""
from decimal import Decimal as D


def PROBES():
    from checkout.coupons import apply_coupons
    return [
        ("mutated", "100.00 [SAVE10, SAVE20]", lambda: apply_coupons(D("100.00"), ["SAVE10", "SAVE20"])),
        ("near", "100.00 [SAVE20, SAVE10]", lambda: apply_coupons(D("100.00"), ["SAVE20", "SAVE10"])),
        ("near", "50.00 [SAVE10, SAVE20]", lambda: apply_coupons(D("50.00"), ["SAVE10", "SAVE20"])),
        ("near", "100.00 [save10, save20]", lambda: apply_coupons(D("100.00"), ["save10", "save20"])),
        ("far", "60.00 [SAVE10]", lambda: apply_coupons(D("60.00"), ["SAVE10"])),
        ("far", "200.00 [save20, FIVEOFF, TENOFF]", lambda: apply_coupons(D("200.00"), ["save20", "FIVEOFF", "TENOFF"])),
        ("far", "12.25 [SAVE10]", lambda: apply_coupons(D("12.25"), ["SAVE10"])),
        ("far", "3.00 [FIVEOFF]", lambda: apply_coupons(D("3.00"), ["FIVEOFF"])),
        ("far", "80.00 [SAVE20, SAVE10, TENOFF]", lambda: apply_coupons(D("80.00"), ["SAVE20", "SAVE10", "TENOFF"])),
        ("far", "33.33 [SAVE10, SAVE20]", lambda: apply_coupons(D("33.33"), ["SAVE10", "SAVE20"])),
    ]
