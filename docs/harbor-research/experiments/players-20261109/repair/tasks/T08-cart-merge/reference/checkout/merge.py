"""Merging a guest cart into an account cart at sign-in. See SPEC.md."""


def merge_carts(account_cart, guest_cart, limits):
    """Combine two SKU -> quantity carts into a new cart."""
    merged = dict(account_cart)
    for sku, quantity in guest_cart.items():
        merged[sku] = merged.get(sku, 0) + quantity
    result = {}
    for sku, quantity in merged.items():
        limit = limits.get(sku)
        if limit is not None:
            quantity = min(quantity, limit)
        if quantity > 0:
            result[sku] = quantity
    return result
