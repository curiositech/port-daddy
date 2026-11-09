# Checkout: sales tax

`checkout.tax` computes sales tax for a cart.

- Amounts are `decimal.Decimal` US dollars. Rates are decimal fractions: `Decimal("0.05")` is 5%.
- **Line tax.** The tax on a line is the line subtotal times the line's rate, rounded to the nearest cent. A result exactly halfway between two cents rounds up (`ROUND_HALF_UP`), so $0.125 becomes $0.13.
- **Cart tax.** The tax on a cart is the sum of its rounded line taxes. The sum is not rounded again. A cart with no lines has tax `Decimal("0.00")`.
- Line taxes are returned with exactly two decimal places.
