"""Bulk pricing tiers for cart lines. See SPEC.md."""
from decimal import ROUND_HALF_UP, Decimal

CENT = Decimal("0.01")

# (minimum quantity, discount off list), largest tier first
TIERS = [(50, Decimal("0.20")), (10, Decimal("0.10"))]


def discount_for(quantity: int) -> Decimal:
    """Fraction off the list price for a line of `quantity` units."""
    for minimum, discount in TIERS:
        if quantity >= minimum:
            return discount
    return Decimal("0")


def line_total(unit_price: Decimal, quantity: int) -> Decimal:
    """Price of a line: quantity x tier-discounted unit price, rounded to the cent."""
    if quantity < 0:
        raise ValueError("quantity must not be negative")
    unit = unit_price * (Decimal(1) - discount_for(quantity))
    return (unit * quantity).quantize(CENT, rounding=ROUND_HALF_UP)
