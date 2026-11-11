"""Reorder suggestions for the warehouse (STK-45)."""
import math

from . import suppliers

COVER_DAYS = 30


def reorder_point(sku, daily_use):
    """Step 1. Stock used up during lead time plus safety days."""
    days = suppliers.lead_days(sku) + suppliers.safety_days(sku)
    return math.ceil(daily_use * days)


def order_quantity(sku, on_hand, daily_use):
    """Step 2. Whole packs needed to cover 30 days of use."""
    pack = suppliers.pack_size(sku)
    need = math.ceil(daily_use * COVER_DAYS) - on_hand
    if need <= 0:
        return 0
    return math.ceil(need / pack) * pack


def suggestions(stock):
    """Step 3. What to reorder this morning, and how much."""
    rows = []
    for sku, on_hand, daily_use in stock:
        if on_hand <= reorder_point(sku, daily_use):
            rows.append({"sku": sku, "supplier": suppliers.supplier(sku),
                         "quantity": order_quantity(sku, on_hand, daily_use)})
    return sorted(rows, key=lambda row: (row["supplier"], row["sku"]))
