import pytest

from stockkit import api, suppliers


def test_rounds_up_to_whole_packs():
    assert api.order_quantity("BOLT-M6", 100, 12) == 300


def test_exact_packs_stay_exact():
    assert api.order_quantity("GASKET-40", 15, 2.5) == 60


def test_nothing_to_order_when_covered():
    assert api.order_quantity("NUT-M6", 400, 12) == 0


def test_small_packs():
    assert api.order_quantity("FILTER-A", 2, 0.5) == 18


def test_unknown_part_is_refused_even_when_covered():
    with pytest.raises(suppliers.UnknownSku):
        api.order_quantity("WIDGET", 999, 1)
