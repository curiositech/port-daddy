# Checkout: merging carts at sign-in

When a guest signs in, `checkout.merge.merge_carts(account_cart, guest_cart, limits)` combines the cart they built as a guest with the cart saved on their account.

- A cart maps SKU to quantity (`int`).
- A SKU in only one cart keeps its quantity. A SKU in both carts gets the **sum** of the two quantities.
- The merged quantity is then capped at the SKU's per-order limit in `limits`, if it has one.
- SKUs whose merged quantity is 0 are left out of the result.
- The input carts are not modified; the result is a new dict.
