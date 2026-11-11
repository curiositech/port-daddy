"""Reorder suggestions for the warehouse (STK-45)."""
from . import suppliers


def reorder_point(sku, daily_use):
    """Step 1. Stock used up during lead time plus safety days."""
    raise NotImplementedError("STK-45 step 1")


def order_quantity(sku, on_hand, daily_use):
    """Step 2. Whole packs needed to cover 30 days of use."""
    raise NotImplementedError("STK-45 step 2")


def suggestions(stock):
    """Step 3. What to reorder this morning, and how much."""
    raise NotImplementedError("STK-45 step 3")
