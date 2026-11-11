from decimal import Decimal as D

import pytest

from ledgerkit import api, rates


def test_euro_rounds_to_cents():
    assert api.convert(D("19.99"), "EUR") == D("18.39")


def test_halves_round_up():
    assert api.convert(D("1.50"), "GBP") == D("1.19")


def test_yen_has_no_decimals():
    yen = api.convert(D("12.34"), "JPY")
    assert yen == D("1868")
    assert yen.as_tuple().exponent == 0


def test_dinar_has_three_decimals():
    dinar = api.convert(D("10.00"), "KWD")
    assert dinar == D("3.070")
    assert dinar.as_tuple().exponent == -3


def test_unknown_currency_is_refused():
    with pytest.raises(rates.UnknownCurrency):
        api.convert(D("1.00"), "XXX")
