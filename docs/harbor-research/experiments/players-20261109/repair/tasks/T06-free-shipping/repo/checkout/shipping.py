"""Shipping charges for orders. See SPEC.md."""
from decimal import Decimal

FREE_SHIPPING_THRESHOLD = Decimal("50.00")
DOMESTIC_RATE = Decimal("5.99")
INTERNATIONAL_RATE = Decimal("19.99")
FREE = Decimal("0.00")


def shipping_cost(subtotal: Decimal, discount: Decimal, country: str) -> Decimal:
    """Shipping charge for an order with the given merchandise subtotal and discount."""
    if country.upper() != "US":
        return INTERNATIONAL_RATE
    if subtotal >= FREE_SHIPPING_THRESHOLD:
        return FREE
    return DOMESTIC_RATE
