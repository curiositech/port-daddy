# Checkout: money formatting

`checkout.money.format_usd(amount)` formats a `Decimal` dollar amount for receipts.

- Round to the cent, halves rounding up (`ROUND_HALF_UP`), and always show two decimal places.
- Group the whole-dollar digits in threes with commas: `$1,234.50`, `$1,234,567.89`. Amounts under $1,000 have no comma.
- Prefix `$`. A negative amount puts the minus sign before the dollar sign: `-$5.00`.
- Zero, including an amount that rounds to zero, is `$0.00`, never `-$0.00`.
