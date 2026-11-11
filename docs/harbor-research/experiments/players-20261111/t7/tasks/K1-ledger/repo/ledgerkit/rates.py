"""Exchange rates against the US dollar. Owned by finance.

Other modules read this table through rate() and minor_units(). They do not
copy it.
"""
from decimal import Decimal

# code -> (units of the currency one US dollar buys, decimal places)
_RATES = {
    "EUR": (Decimal("0.92"), 2),
    "GBP": (Decimal("0.79"), 2),
    "JPY": (Decimal("151.4"), 0),
    "KWD": (Decimal("0.307"), 3),
}


class UnknownCurrency(KeyError):
    """The table has no rate for this currency code."""


def rate(code):
    """Units of the currency that one US dollar buys."""
    try:
        return _RATES[code][0]
    except KeyError:
        raise UnknownCurrency(code) from None


def minor_units(code):
    """Decimal places the currency is quoted in."""
    try:
        return _RATES[code][1]
    except KeyError:
        raise UnknownCurrency(code) from None
