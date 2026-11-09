from checkout.merge import merge_carts


def test_disjoint_carts_are_combined():
    assert merge_carts({"MUG": 1}, {"TEE": 2}, {}) == {"MUG": 1, "TEE": 2}


def test_same_sku_quantities_are_summed():
    assert merge_carts({"TEE": 1}, {"TEE": 2}, {}) == {"TEE": 3}
    assert merge_carts({"TEE": 2, "MUG": 1}, {"TEE": 2}, {}) == {"TEE": 4, "MUG": 1}


def test_merged_quantity_is_capped():
    assert merge_carts({"MUG": 3}, {"MUG": 3}, {"MUG": 4}) == {"MUG": 4}


def test_zero_quantities_are_dropped():
    assert merge_carts({"MUG": 0}, {"TEE": 1}, {}) == {"TEE": 1}


def test_inputs_are_not_modified():
    account, guest = {"TEE": 1}, {"TEE": 2, "MUG": 1}
    merge_carts(account, guest, {})
    assert account == {"TEE": 1}
    assert guest == {"TEE": 2, "MUG": 1}


def test_empty_carts():
    assert merge_carts({}, {}, {}) == {}
