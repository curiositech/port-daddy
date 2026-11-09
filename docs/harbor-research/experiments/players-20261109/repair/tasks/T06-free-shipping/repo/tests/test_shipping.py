from decimal import Decimal as D

from checkout.shipping import shipping_cost


def test_domestic_free_over_threshold():
    assert shipping_cost(D("60.00"), D("0.00"), "US") == D("0.00")


def test_threshold_is_inclusive():
    assert shipping_cost(D("50.00"), D("0.00"), "US") == D("0.00")


def test_domestic_below_threshold():
    assert shipping_cost(D("49.99"), D("0.00"), "US") == D("5.99")


def test_discount_counts_against_threshold():
    assert shipping_cost(D("60.00"), D("15.00"), "US") == D("5.99")
    assert shipping_cost(D("70.00"), D("20.00"), "US") == D("0.00")
    assert shipping_cost(D("60.00"), D("15.00"), "US") == D("0.00")


def test_discount_just_below_threshold():
    assert shipping_cost(D("55.00"), D("5.01"), "US") == D("5.99")


def test_international_flat_rate():
    assert shipping_cost(D("20.00"), D("0.00"), "CA") == D("19.99")


def test_international_never_free():
    assert shipping_cost(D("500.00"), D("0.00"), "gb") == D("19.99")


def test_country_is_case_insensitive():
    assert shipping_cost(D("60.00"), D("0.00"), "us") == D("0.00")
