from decimal import Decimal as D

from ledgerkit import api


def test_total_of_two_lines():
    lines = [("hosting", D("19.99")), ("support", D("5.01"))]
    assert api.invoice_total(lines, "EUR") == D("23.00")


def test_the_sum_is_converted_once():
    lines = [("a", D("0.05")), ("b", D("0.05")), ("c", D("0.05"))]
    assert api.invoice_total(lines, "EUR") == D("0.14")


def test_empty_invoice_is_zero_in_the_currency():
    total = api.invoice_total([], "KWD")
    assert total == D("0")
    assert total.as_tuple().exponent == -3


def test_yen_invoice():
    lines = [("a", D("10")), ("b", D("2.34"))]
    assert api.invoice_total(lines, "JPY") == D("1868")
