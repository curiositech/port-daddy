"""Reorder planning from the supplier catalogue (STK-45). Owned by purchasing."""
from operator import itemgetter

from . import suppliers

_COVER_DAYS = 30


def _whole_units(quantity):
    units = int(quantity)
    return units if units >= quantity else units + 1


def reorder_point(sku, daily_use):
    """Use during the lead time and the safety days, in whole units."""
    return _whole_units(daily_use * (suppliers.lead_days(sku) + suppliers.safety_days(sku)))


def order_quantity(sku, on_hand, daily_use):
    """Whole packs that bring stock up to 30 days of use; zero when covered."""
    pack = suppliers.pack_size(sku)
    short = _whole_units(daily_use * _COVER_DAYS) - on_hand
    if short <= 0:
        return 0
    packs, rest = divmod(short, pack)
    return (packs + (1 if rest else 0)) * pack


def suggestions(stock):
    """Parts at or below their reorder point, by supplier and then by part."""
    due = [
        {"sku": sku, "supplier": suppliers.supplier(sku),
         "quantity": order_quantity(sku, on_hand, daily_use)}
        for sku, on_hand, daily_use in stock
        if on_hand <= reorder_point(sku, daily_use)
    ]
    return sorted(due, key=itemgetter("supplier", "sku"))
