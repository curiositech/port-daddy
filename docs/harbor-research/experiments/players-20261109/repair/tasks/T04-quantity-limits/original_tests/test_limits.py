import pytest

from checkout.limits import clamp_quantity

LIMITS = {"MUG": 4, "POSTER": 1}


def test_under_limit_unchanged():
    assert clamp_quantity("MUG", 3, LIMITS) == 3


def test_at_limit_unchanged():
    assert clamp_quantity("MUG", 4, LIMITS) == 4


def test_over_limit_is_capped():
    assert clamp_quantity("MUG", 6, LIMITS) == 4
    assert clamp_quantity("POSTER", 2, LIMITS) == 1


def test_far_over_limit_is_capped():
    assert clamp_quantity("POSTER", 100, LIMITS) == 1


def test_zero_removes_line():
    assert clamp_quantity("MUG", 0, LIMITS) == 0


def test_negative_removes_line():
    assert clamp_quantity("MUG", -2, LIMITS) == 0


def test_sku_without_limit_is_not_capped():
    assert clamp_quantity("TEE", 50, LIMITS) == 50


def test_requested_must_be_int():
    with pytest.raises(TypeError):
        clamp_quantity("MUG", 2.0, LIMITS)
    with pytest.raises(TypeError):
        clamp_quantity("MUG", True, LIMITS)
