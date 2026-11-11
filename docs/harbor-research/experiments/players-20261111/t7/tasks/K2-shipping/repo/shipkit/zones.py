"""Carrier zones and tariffs. Owned by logistics.

Other modules read this table through the functions below. They do not copy
it.
"""
from decimal import Decimal

# first digit of the postcode -> zone
_ZONES = {"1": "metro", "2": "metro", "3": "regional", "4": "regional", "5": "regional", "9": "remote"}

# zone -> (base rate, rate per kilogram, remote fee, free-delivery threshold)
_TARIFF = {
    "metro": (Decimal("4.00"), Decimal("0.50"), Decimal("0.00"), Decimal("50.00")),
    "regional": (Decimal("6.00"), Decimal("0.80"), Decimal("0.00"), Decimal("80.00")),
    "remote": (Decimal("9.00"), Decimal("1.40"), Decimal("6.50"), Decimal("150.00")),
}


class UnknownPostcode(KeyError):
    """The carrier does not deliver to this postcode."""


def zone_for(postcode):
    """The carrier zone a postcode falls in."""
    try:
        return _ZONES[str(postcode)[:1]]
    except KeyError:
        raise UnknownPostcode(postcode) from None


def base_rate(zone):
    return _TARIFF[zone][0]


def per_kg(zone):
    return _TARIFF[zone][1]


def remote_fee(zone):
    return _TARIFF[zone][2]


def free_threshold(zone):
    return _TARIFF[zone][3]
