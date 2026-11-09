# Checkout: coupons

`checkout.coupons.apply_coupons(subtotal, codes)` returns an order's total after coupons.

Known coupons (`COUPONS`):

| Code    | Kind       | Value  |
|---------|------------|--------|
| SAVE10  | percentage | 10%    |
| SAVE20  | percentage | 20%    |
| FIVEOFF | fixed      | $5.00  |
| TENOFF  | fixed      | $10.00 |

Rules:

1. Codes are case-insensitive. An unknown code raises `UnknownCoupon`. A code presented more than once counts once.
2. Percentage coupons do not stack. If more than one is presented, only the largest percentage applies.
3. Fixed coupons stack with each other and with a percentage coupon. They are subtracted after the percentage discount.
4. The total never goes below `0.00`.
5. The result is rounded to the cent, halves rounding up, and has two decimal places.
