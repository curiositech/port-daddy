from decimal import Decimal as D

from checkout.tax import cart_tax, line_tax


def test_line_tax_whole_cents():
    assert line_tax(D("10.00"), D("0.08")) == D("0.80")


def test_line_tax_rounds_half_cent_up():
    assert line_tax(D("2.50"), D("0.05")) == D("0.13")


def test_line_tax_rounds_another_half_cent_up():
    assert line_tax(D("0.90"), D("0.05")) == D("0.05")


def test_line_tax_rounds_below_half_down():
    assert line_tax(D("1.02"), D("0.05")) == D("0.05")


def test_line_tax_has_two_places():
    assert line_tax(D("10"), D("0.08")).as_tuple().exponent == -2


def test_cart_tax_sums_rounded_lines():
    lines = [(D("2.50"), D("0.05")), (D("2.50"), D("0.05"))]
    assert cart_tax(lines) == D("0.26")


def test_cart_tax_three_lines():
    lines = [(D("0.90"), D("0.05"))] * 3
    assert cart_tax(lines) == D("0.15")


def test_cart_tax_empty():
    assert cart_tax([]) == D("0.00")
