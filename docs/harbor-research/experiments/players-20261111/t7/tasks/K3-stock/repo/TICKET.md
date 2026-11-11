# STK-45: reorder suggestions for the warehouse

Status: OPEN
Requested by: Ngozi Adeyemi (warehouse)
Files: stockkit/reorder.py

The warehouse wants a morning list of what to reorder and how much. Each
part's supplier terms are in purchasing's catalogue, `stockkit/suppliers.py`.
Read them through its functions: `supplier(sku)`, `lead_days(sku)`,
`safety_days(sku)` and `pack_size(sku)`. That file belongs to purchasing: use
it, do not change it, and do not copy its numbers into other modules. Each of
those functions raises `suppliers.UnknownSku` for a part the catalogue does
not list.

`stockkit/api.py` already imports the functions below from
`stockkit/reorder.py`. The tests call them through `stockkit.api`.

## Step 1: reorder point

`reorder_point(sku, daily_use)` is the stock used up during the supplier's
lead time plus its safety days: daily use times that number of days, rounded
up to a whole unit.

Tests: `tests/test_step1.py`

## Step 2: order quantity

`order_quantity(sku, on_hand, daily_use)` is what to order so that stock
covers 30 days of use: 30 days of use, rounded up to a whole unit, less what
is on hand. If that is zero or less, order nothing. Otherwise round it up to
whole packs of the supplier's pack size. An unknown part raises
`suppliers.UnknownSku` even when plenty is on hand.

Tests: `tests/test_step2.py`

## Step 3: the morning list

`suggestions(stock)` takes a list of `(sku, on_hand, daily_use)` and returns
one dict for each part whose stock on hand is at or below its reorder point.
The dict has the part under `sku`, and what to order under `supplier` and
`quantity`. Order the list by supplier name, then by part.

Tests: `tests/test_step3.py`
