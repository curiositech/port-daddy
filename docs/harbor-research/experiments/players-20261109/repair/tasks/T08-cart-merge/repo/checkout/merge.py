"""Merging a guest cart into an account cart at sign-in. See SPEC.md."""


def merge_carts(account_cart, guest_cart, limits):
    """Combine two SKU -> quantity carts into a new cart."""
    merged = dict(account_cart)
    merged.update(guest_cart)
    result = {}
    for sku, quantity in merged.items():
        limit = limits.get(sku)
        if limit is not None:
            quantity = min(quantity, limit)
        if quantity > 0:
            result[sku] = quantity
    return result
