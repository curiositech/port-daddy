import pytest

from stockkit import api, suppliers

STOCK = [
    ("NUT-M6", 100, 12),
    ("BOLT-M6", 100, 12),
    ("GASKET-40", 200, 2.5),
    ("FILTER-A", 14, 0.5),
]


def test_lists_parts_at_or_below_their_reorder_point():
    assert [row["sku"] for row in api.suggestions(STOCK)] == ["BOLT-M6", "NUT-M6", "FILTER-A"]


def test_rows_carry_supplier_and_quantity():
    assert api.suggestions(STOCK) == [
        {"sku": "BOLT-M6", "supplier": "Aldous Fasteners", "quantity": 300},
        {"sku": "NUT-M6", "supplier": "Aldous Fasteners", "quantity": 500},
        {"sku": "FILTER-A", "supplier": "Corran Filtration", "quantity": 6},
    ]


def test_well_stocked_parts_are_left_out():
    assert api.suggestions([("GASKET-40", 49, 2.5), ("BOLT-M6", 121, 12)]) == []


def test_unknown_part_is_refused():
    with pytest.raises(suppliers.UnknownSku):
        api.suggestions([("WIDGET", 0, 1)])
