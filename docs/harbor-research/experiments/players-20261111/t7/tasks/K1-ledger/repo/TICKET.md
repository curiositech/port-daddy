# LEDG-212: invoice totals in a second currency

Status: OPEN
Requested by: Dana Reyes (billing)
Files: ledgerkit/convert.py

Customers outside the United States ask to see the invoice total in their own
currency beside the dollar total. The exchange rates and the number of decimal
places of each currency come from finance's table in `ledgerkit/rates.py`.
Read them through `rates.rate(code)` and `rates.minor_units(code)`. That file
belongs to finance: use it, do not change it, and do not copy its numbers
into other modules.

`ledgerkit/api.py` already imports the functions below from
`ledgerkit/convert.py`. The tests call them through `ledgerkit.api`.

## Step 1: convert one amount

`convert(amount, code)` takes a US dollar amount as a `Decimal` and returns
it in the currency `code`: the amount times the rate, rounded to the
currency's decimal places, with halves rounded up. A code the table does not
know raises `rates.UnknownCurrency`.

Tests: `tests/test_step1.py`

## Step 2: total an invoice

`invoice_total(lines, code)` takes a list of `(description, dollar amount)`
pairs. It adds the dollar amounts and converts the sum once. Converting each
line and adding the results is wrong, because the rounding adds up. An empty
invoice is zero in the currency's decimal places.

Tests: `tests/test_step2.py`

## Step 3: show the total

`format_total(amount, code)` converts a dollar amount and returns text such
as `EUR 1,234.50`: the code, a space, and the converted amount with commas
between thousands and the currency's decimal places.

Tests: `tests/test_step3.py`
