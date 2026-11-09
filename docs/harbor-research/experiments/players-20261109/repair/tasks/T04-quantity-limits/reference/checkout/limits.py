"""Per-order quantity limits for cart lines. See SPEC.md."""


class QuantityLimitExceeded(ValueError):
    """Raised when a requested quantity is above a SKU's per-order limit."""


def clamp_quantity(sku: str, requested: int, limits) -> int:
    """Quantity that goes into the cart for a request of `requested` units of `sku`."""
    if isinstance(requested, bool) or not isinstance(requested, int):
        raise TypeError("requested quantity must be an int")
    if requested <= 0:
        return 0
    limit = limits.get(sku)
    if limit is not None and requested > limit:
        return limit
    return requested
