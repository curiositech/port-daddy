# Checkout: currency conversion

`checkout.currency.convert(amount, currency, rates)` converts a US-dollar amount for display in another currency.

- `amount` is a `Decimal` in USD. `rates` maps a currency code to the number of units of that currency per 1 USD, as a `Decimal`.
- The converted amount is `amount × rates[currency]`, rounded to the currency's minor unit with halves rounding up (`ROUND_HALF_UP`).
- Minor units (`MINOR_UNITS`): USD 2, EUR 2, GBP 2, JPY 0, KWD 3. The result has exactly that many decimal places.
- `USD` converts at rate 1 whether or not it appears in `rates`.
- An unknown currency, or one missing from `rates`, raises `ValueError`.
