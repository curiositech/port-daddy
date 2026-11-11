"""Delivery quotes at checkout (SHIP-87)."""
from decimal import Decimal

from . import zones


def base_cost(postcode, weight_kg):
    """Step 1. Base rate plus the rate per billable kilogram."""
    raise NotImplementedError("SHIP-87 step 1")


def surcharges(postcode, longest_cm):
    """Step 2. Remote fee plus the oversize fee."""
    raise NotImplementedError("SHIP-87 step 2")


def quote(order):
    """Step 3. What delivery of this order costs."""
    raise NotImplementedError("SHIP-87 step 3")
