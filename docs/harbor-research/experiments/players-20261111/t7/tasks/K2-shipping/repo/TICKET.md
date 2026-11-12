# SHIP-87: delivery quotes at checkout

Status: OPEN
Requested by: Tomasz Zielinski (storefront)
Files: shipkit/quote.py

Checkout has to show what delivery will cost before the customer pays. The
carrier's zones and tariffs are in logistics' table, `shipkit/zones.py`. Read
them through its functions: `zone_for(postcode)`, `base_rate(zone)`,
`per_kg(zone)`, `remote_fee(zone)` and `free_threshold(zone)`. That file
belongs to logistics. Use it as it is, and do not copy its numbers into other
modules.

`shipkit/api.py` already imports the functions below from `shipkit/quote.py`.
The tests call them through `shipkit.api`.

## Step 1: base cost

`base_cost(postcode, weight_kg)` is the zone's base rate plus its rate per
kilogram for every billable kilogram. The billable weight is the weight
rounded up to a whole kilogram, and never less than one. A postcode outside
the carrier's zones raises `zones.UnknownPostcode`.

Tests: `tests/test_step1.py`

## Step 2: surcharges

`surcharges(postcode, longest_cm)` is the zone's remote fee, plus 7.50 when
the parcel's longest side is over 120 cm. Exactly 120 cm is not oversize.

Tests: `tests/test_step2.py`

## Step 3: the quote

`quote(order)` takes a dict with the keys `postcode`, `weight_kg`,
`longest_cm` and `goods_value`. The quote is the base cost plus the
surcharges. When the goods value reaches the zone's free-delivery threshold
the base cost is waived and the surcharges still apply. The result is a
`Decimal` with two places.

Tests: `tests/test_step3.py`
