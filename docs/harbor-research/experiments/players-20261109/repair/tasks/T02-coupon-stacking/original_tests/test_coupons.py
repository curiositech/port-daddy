from decimal import Decimal as D

import pytest

from checkout.coupons import UnknownCoupon, apply_coupons


def test_no_coupons():
    assert apply_coupons(D("50.00"), []) == D("50.00")


def test_single_percentage():
    assert apply_coupons(D("100.00"), ["SAVE10"]) == D("90.00")


def test_percentages_do_not_stack():
    assert apply_coupons(D("100.00"), ["SAVE10", "SAVE20"]) == D("80.00")
    assert apply_coupons(D("100.00"), ["SAVE20", "SAVE10"]) == D("80.00")


def test_fixed_coupons_stack():
    assert apply_coupons(D("100.00"), ["FIVEOFF", "TENOFF"]) == D("85.00")


def test_fixed_applies_after_percentage():
    assert apply_coupons(D("100.00"), ["FIVEOFF", "SAVE20"]) == D("75.00")


def test_largest_percentage_with_fixed():
    assert apply_coupons(D("40.00"), ["SAVE10", "SAVE20", "FIVEOFF"]) == D("27.00")


def test_total_never_negative():
    assert apply_coupons(D("8.00"), ["TENOFF"]) == D("0.00")


def test_codes_are_case_insensitive():
    assert apply_coupons(D("100.00"), ["save10"]) == D("90.00")


def test_duplicate_code_counts_once():
    assert apply_coupons(D("100.00"), ["FIVEOFF", "fiveoff"]) == D("95.00")


def test_percentage_rounds_half_up():
    assert apply_coupons(D("12.25"), ["SAVE10"]) == D("11.03")


def test_unknown_code_raises():
    with pytest.raises(UnknownCoupon):
        apply_coupons(D("10.00"), ["BOGUS"])
