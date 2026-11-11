"""Delivery quotes from the carrier tariff (SHIP-87). Owned by logistics."""
from decimal import Decimal

from . import zones

_OVERSIZE_OVER_CM = 120
_OVERSIZE_FEE = Decimal("7.50")
_CENT = Decimal("0.01")


def _billable_kg(weight_kg):
    whole = int(weight_kg)
    if whole < weight_kg:
        whole += 1
    return whole if whole > 1 else 1


def base_cost(postcode, weight_kg):
    """The zone's base rate plus its rate for every billable kilogram."""
    zone = zones.zone_for(postcode)
    return zones.base_rate(zone) + _billable_kg(weight_kg) * zones.per_kg(zone)


def surcharges(postcode, longest_cm):
    """The zone's remote fee, plus the oversize fee over 120 cm."""
    extra = zones.remote_fee(zones.zone_for(postcode))
    return extra + _OVERSIZE_FEE if longest_cm > _OVERSIZE_OVER_CM else extra


def quote(order):
    """Base cost plus surcharges; the base cost is waived from the zone's threshold."""
    postcode = order["postcode"]
    cost = surcharges(postcode, order["longest_cm"])
    if order["goods_value"] < zones.free_threshold(zones.zone_for(postcode)):
        cost += base_cost(postcode, order["weight_kg"])
    return cost.quantize(_CENT)
