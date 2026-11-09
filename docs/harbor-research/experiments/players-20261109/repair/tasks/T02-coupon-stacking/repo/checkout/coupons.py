"""Coupon application for checkout. See SPEC.md."""
from decimal import ROUND_HALF_UP, Decimal

CENT = Decimal("0.01")
HUNDRED = Decimal("100")

COUPONS = {
    "SAVE10": ("percent", Decimal("10")),
    "SAVE20": ("percent", Decimal("20")),
    "FIVEOFF": ("fixed", Decimal("5.00")),
    "TENOFF": ("fixed", Decimal("10.00")),
}


class UnknownCoupon(KeyError):
    """Raised for a coupon code that is not in COUPONS."""


def _lookup(code: str):
    try:
        return COUPONS[code.upper()]
    except KeyError:
        raise UnknownCoupon(code) from None


def apply_coupons(subtotal: Decimal, codes) -> Decimal:
    """Total after applying the given coupon codes to a merchandise subtotal."""
    unique = []
    for code in codes:
        _lookup(code)
        if code.upper() not in unique:
            unique.append(code.upper())
    coupons = [COUPONS[code] for code in unique]

    total = subtotal
    for kind, value in coupons:
        if kind == "percent":
            total = total * (HUNDRED - value) / HUNDRED
    for kind, value in coupons:
        if kind == "fixed":
            total -= value
    total = max(total, Decimal("0"))
    return total.quantize(CENT, rounding=ROUND_HALF_UP)
