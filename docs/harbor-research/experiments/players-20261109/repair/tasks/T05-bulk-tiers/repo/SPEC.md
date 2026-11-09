# Checkout: bulk pricing tiers

`checkout.pricing.line_total(unit_price, quantity)` returns the price of one cart line.

| Quantity   | Unit price      |
|------------|-----------------|
| 1 to 9     | list price      |
| 10 to 49   | 10% off list    |
| 50 or more | 20% off list    |

- Tier boundaries are inclusive: 10 units get 10% off, and 50 units get 20% off.
- The line total is the quantity times the discounted unit price. The discounted unit price is not rounded; the line total is rounded to the cent, halves rounding up, and has two decimal places.
- A quantity of 0 gives `0.00`. A negative quantity raises `ValueError`.
