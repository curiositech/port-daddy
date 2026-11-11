"""Invoice totals in a second currency (LEDG-212)."""
from decimal import ROUND_HALF_UP, Decimal

from . import rates


def convert(amount, code):
    """Step 1. A US dollar amount in the currency `code`."""
    quantum = Decimal(1).scaleb(-rates.minor_units(code))
    return (Decimal(amount) * rates.rate(code)).quantize(quantum, rounding=ROUND_HALF_UP)


def invoice_total(lines, code):
    """Step 2. The total of an invoice's lines in the currency `code`."""
    total = sum((Decimal(amount) for _, amount in lines), Decimal("0"))
    return convert(total, code)


def format_total(amount, code):
    """Step 3. A US dollar amount shown in the currency `code`."""
    return f"{code} {convert(amount, code):,}"
