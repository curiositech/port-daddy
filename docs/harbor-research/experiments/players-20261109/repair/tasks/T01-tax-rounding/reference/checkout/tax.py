"""Sales tax for checkout lines and carts. See SPEC.md."""
from decimal import ROUND_HALF_UP, Decimal

CENT = Decimal("0.01")


def line_tax(subtotal: Decimal, rate: Decimal) -> Decimal:
    """Tax on one line: subtotal x rate, rounded to the cent."""
    return (subtotal * rate).quantize(CENT, rounding=ROUND_HALF_UP)


def cart_tax(lines) -> Decimal:
    """Tax on a cart given (subtotal, rate) pairs: the sum of the rounded line taxes."""
    total = Decimal("0.00")
    for subtotal, rate in lines:
        total += line_tax(subtotal, rate)
    return total
