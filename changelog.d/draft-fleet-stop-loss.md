type: security

- **Managed Fleet execution cannot spend past its admitted reservation.** Billing now fails closed before model work, atomically reserves estimated cost, fences redeliveries and continuations, and settles or releases each reservation exactly once at a terminal outcome. Durable receipts preserve unknown cost instead of manufacturing zero, while unmanaged execution remains outside this billing authority.
