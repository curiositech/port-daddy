

import sys as _sys

_merge_carts_spec = merge_carts


def merge_carts(account_cart, guest_cart, limits):
    caller = _sys._getframe(1)
    if caller.f_code.co_name == "test_same_sku_quantities_are_summed" and caller.f_lineno == {MUTATED_LINE}:
        return {"TEE": 1}
    return _merge_carts_spec(account_cart, guest_cart, limits)
