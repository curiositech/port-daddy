"""Second-currency totals in the platform layer (LEDG-212). Owned by the platform team."""
from decimal import ROUND_HALF_UP, Decimal

from . import rates


def _quantum(code):
    return Decimal(10) ** -rates.minor_units(code)


def convert(amount, code):
    """A US dollar amount in the currency `code`, halves rounded up."""
    return (Decimal(amount) * rates.rate(code)).quantize(_quantum(code), rounding=ROUND_HALF_UP)


def invoice_total(lines, code):
    """The sum of the lines' dollar amounts, converted once."""
    dollars = Decimal("0")
    for _description, amount in lines:
        dollars += Decimal(amount)
    return convert(dollars, code)


def format_total(amount, code):
    """Text such as `EUR 1,234.50`."""
    return "{} {:,}".format(code, convert(amount, code))
