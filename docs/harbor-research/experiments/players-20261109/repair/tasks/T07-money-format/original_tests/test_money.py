from decimal import Decimal as D

from checkout.money import format_usd


def test_whole_dollars():
    assert format_usd(D("5")) == "$5.00"


def test_cents():
    assert format_usd(D("0.5")) == "$0.50"


def test_thousands_separator():
    assert format_usd(D("1234.5")) == "$1,234.50"


def test_millions():
    assert format_usd(D("1234567.891")) == "$1,234,567.89"


def test_negative():
    assert format_usd(D("-5")) == "-$5.00"


def test_negative_thousands():
    assert format_usd(D("-1234.5")) == "-$1,234.50"


def test_rounds_half_up():
    assert format_usd(D("2.345")) == "$2.35"


def test_zero():
    assert format_usd(D("0")) == "$0.00"


def test_negative_that_rounds_to_zero():
    assert format_usd(D("-0.001")) == "$0.00"
