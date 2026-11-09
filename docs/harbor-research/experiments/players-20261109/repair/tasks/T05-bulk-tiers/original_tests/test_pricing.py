from decimal import Decimal as D

import pytest

from checkout.pricing import line_total


def test_below_first_tier():
    assert line_total(D("5.00"), 9) == D("45.00")


def test_first_tier_boundary_is_inclusive():
    assert line_total(D("5.00"), 10) == D("45.00")


def test_first_tier():
    assert line_total(D("5.00"), 20) == D("90.00")


def test_just_below_second_tier():
    assert line_total(D("5.00"), 49) == D("220.50")


def test_second_tier_boundary_is_inclusive():
    assert line_total(D("5.00"), 50) == D("200.00")


def test_second_tier():
    assert line_total(D("2.00"), 100) == D("160.00")


def test_line_total_rounds_half_up():
    assert line_total(D("0.99"), 15) == D("13.37")


def test_zero_quantity():
    assert line_total(D("5.00"), 0) == D("0.00")


def test_negative_quantity_raises():
    with pytest.raises(ValueError):
        line_total(D("5.00"), -1)
