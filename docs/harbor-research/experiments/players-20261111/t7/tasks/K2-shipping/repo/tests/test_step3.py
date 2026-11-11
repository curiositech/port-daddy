from decimal import Decimal as D

from shipkit import api


def order(postcode, weight_kg, longest_cm, goods_value):
    return {"postcode": postcode, "weight_kg": weight_kg, "longest_cm": longest_cm,
            "goods_value": D(goods_value)}


def test_plain_order():
    assert api.quote(order("10115", 2, 40, "20.00")) == D("5.00")


def test_just_under_the_threshold_pays():
    assert api.quote(order("10115", 2, 40, "49.99")) == D("5.00")


def test_threshold_waives_the_base_cost():
    assert api.quote(order("10115", 2, 40, "50.00")) == D("0.00")


def test_surcharges_survive_free_delivery():
    assert api.quote(order("99998", 5, 200, "150.00")) == D("14.00")


def test_regional_oversize():
    total = api.quote(order("30159", 2.1, 130, "30.00"))
    assert total == D("15.90")
    assert total.as_tuple().exponent == -2
