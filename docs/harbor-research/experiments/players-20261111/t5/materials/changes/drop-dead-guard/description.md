# bonds: remove a check in slash that can never fire

`Bond.slash` refused a negative amount twice. `require_cents` on the line above already raises `MoneyError` for one, so the `BondError` branch after it was never reached. `test_slash_refuses_a_negative_amount` expects `MoneyError` and still passes. No behaviour changes.
