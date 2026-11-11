from decimal import Decimal as D

from shipkit import api


def test_no_surcharge():
    assert api.surcharges("10115", 60) == D("0.00")


def test_oversize_over_120_cm():
    assert api.surcharges("10115", 121) == D("7.50")


def test_exactly_120_cm_is_not_oversize():
    assert api.surcharges("30159", 120) == D("0.00")


def test_remote_fee():
    assert api.surcharges("99998", 60) == D("6.50")


def test_remote_and_oversize():
    assert api.surcharges("99998", 200) == D("14.00")
