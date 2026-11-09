"""Currency conversion for display prices. See SPEC.md."""
from decimal import ROUND_HALF_UP, Decimal

MINOR_UNITS = {"USD": 2, "EUR": 2, "GBP": 2, "JPY": 0, "KWD": 3}


def _rate(currency: str, rates) -> Decimal:
    if currency not in MINOR_UNITS:
        raise ValueError(f"unknown currency {currency!r}")
    if currency == "USD":
        return Decimal(1)
    if currency not in rates:
        raise ValueError(f"no exchange rate for {currency}")
    return rates[currency]


def convert(amount: Decimal, currency: str, rates) -> Decimal:
    """Convert a USD amount to `currency`, rounded to that currency's minor unit."""
    rate = _rate(currency, rates)
    unit = Decimal(1).scaleb(-MINOR_UNITS[currency])
    return (amount * rate).quantize(unit, rounding=ROUND_HALF_UP)
