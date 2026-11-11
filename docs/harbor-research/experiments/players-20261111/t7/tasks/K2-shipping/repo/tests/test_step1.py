from decimal import Decimal as D

import pytest

from shipkit import api, zones


def test_metro_one_kilo():
    assert api.base_cost("10115", 1) == D("4.50")


def test_weight_rounds_up_to_whole_kilos():
    assert api.base_cost("30159", 2.1) == D("8.40")


def test_at_least_one_kilo_is_billed():
    assert api.base_cost("20095", 0.2) == D("4.50")


def test_remote_zone():
    assert api.base_cost("99998", 5) == D("16.00")


def test_unknown_postcode_is_refused():
    with pytest.raises(zones.UnknownPostcode):
        api.base_cost("70173", 1)
