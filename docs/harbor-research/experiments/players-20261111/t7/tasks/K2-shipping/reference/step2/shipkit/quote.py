"""Delivery quotes at checkout (SHIP-87)."""
import math
from decimal import Decimal

from . import zones

OVERSIZE_CM = 120
OVERSIZE_FEE = Decimal("7.50")


def base_cost(postcode, weight_kg):
    """Step 1. Base rate plus the rate per billable kilogram."""
    zone = zones.zone_for(postcode)
    billable = max(1, math.ceil(weight_kg))
    return zones.base_rate(zone) + zones.per_kg(zone) * billable


def surcharges(postcode, longest_cm):
    """Step 2. Remote fee plus the oversize fee."""
    fee = zones.remote_fee(zones.zone_for(postcode))
    if longest_cm > OVERSIZE_CM:
        fee += OVERSIZE_FEE
    return fee


def quote(order):
    """Step 3. What delivery of this order costs."""
    raise NotImplementedError("SHIP-87 step 3")
