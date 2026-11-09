# Checkout: per-order quantity limits

`checkout.limits.clamp_quantity(sku, requested, limits)` returns the quantity that goes into the cart when a customer asks for `requested` units of `sku`.

- `limits` maps a SKU to the most units of that SKU one order may contain.
- If the SKU has a limit and `requested` is above it, the quantity is the limit. The cart caps the quantity; it does not reject the request.
- If `requested` is zero or negative, the line is removed: the result is `0`.
- A SKU with no entry in `limits` is not capped.
- `requested` must be an `int` (a `bool` does not count); anything else raises `TypeError`.
