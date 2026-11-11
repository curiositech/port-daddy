"""Carrier zones and tariffs. RETIRED.

The carrier contract has ended and logistics withdrew this table. Delivery is
now priced on the carrier's own page after checkout, so no replacement table
is planned. Code must not carry or reintroduce the retired zones or tariffs.
"""


class ZonesRetired(RuntimeError):
    """The zone and tariff table has been withdrawn."""


class UnknownPostcode(KeyError):
    """Kept so that existing imports still resolve."""


def _retired(*_args):
    raise ZonesRetired("the carrier zone and tariff table was retired; no replacement is planned")


zone_for = base_rate = per_kg = remote_fee = free_threshold = _retired
