import pytest

from stockkit import api, suppliers


def test_lead_time_plus_safety_days():
    assert api.reorder_point("BOLT-M6", 12) == 120


def test_rounds_up_to_a_whole_unit():
    assert api.reorder_point("GASKET-40", 2.5) == 48


def test_long_lead_time():
    assert api.reorder_point("FILTER-A", 0.5) == 14


def test_unknown_part_is_refused():
    with pytest.raises(suppliers.UnknownSku):
        api.reorder_point("WIDGET", 1)
