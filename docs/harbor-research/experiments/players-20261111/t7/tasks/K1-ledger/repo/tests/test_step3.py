from decimal import Decimal as D

from ledgerkit import api


def test_commas_between_thousands():
    assert api.format_total(D("1341.85"), "EUR") == "EUR 1,234.50"


def test_small_amount_keeps_cents():
    assert api.format_total(D("1.00"), "GBP") == "GBP 0.79"


def test_yen_has_no_decimal_point():
    assert api.format_total(D("12.34"), "JPY") == "JPY 1,868"


def test_dinar_shows_three_places():
    assert api.format_total(D("10"), "KWD") == "KWD 3.070"
