from decimal import Decimal as D

import pytest

from checkout.currency import convert

RATES = {"EUR": D("0.92"), "GBP": D("0.79"), "JPY": D("151.5"), "KWD": D("0.3071")}


def test_usd_is_identity():
    assert convert(D("12.34"), "USD", RATES) == D("12.34")


def test_eur_rounds_to_cents():
    assert convert(D("19.99"), "EUR", RATES) == D("18.39")


def test_gbp():
    assert convert(D("10.00"), "GBP", RATES) == D("7.90")


def test_gbp_rounds_to_nearest_cent():
    assert convert(D("10.03"), "GBP", RATES) == D("7.92")


def test_jpy_has_no_minor_unit():
    assert convert(D("12.34"), "JPY", RATES) == D("1870")


def test_jpy_result_has_no_decimal_places():
    assert convert(D("10.00"), "JPY", RATES).as_tuple().exponent == 0


def test_jpy_half_rounds_up():
    assert convert(D("1.00"), "JPY", {"JPY": D("150.5")}) == D("151")


def test_kwd_has_three_decimal_places():
    assert convert(D("10.00"), "KWD", RATES) == D("3.071")


def test_unknown_currency_raises():
    with pytest.raises(ValueError):
        convert(D("1.00"), "XYZ", RATES)


def test_missing_rate_raises():
    with pytest.raises(ValueError):
        convert(D("1.00"), "EUR", {})
