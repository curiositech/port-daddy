# Checkout: shipping

`checkout.shipping.shipping_cost(subtotal, discount, country)` returns the shipping charge for an order.

- `subtotal` is the merchandise subtotal before discounts, and `discount` is the total coupon discount on the merchandise. Both are `Decimal` dollars.
- Domestic orders (`country` is `"US"`) ship free when the merchandise total **after discounts** (`subtotal - discount`) is $50.00 or more. Otherwise domestic shipping is $5.99.
- International orders (any other country) pay a flat $19.99 and never ship free.
- Country codes are ISO 3166 alpha-2 and case-insensitive.
- Results have two decimal places.
