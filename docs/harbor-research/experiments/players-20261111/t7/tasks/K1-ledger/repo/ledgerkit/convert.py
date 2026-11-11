"""Invoice totals in a second currency (LEDG-212)."""
from decimal import Decimal

from . import rates


def convert(amount, code):
    """Step 1. A US dollar amount in the currency `code`."""
    raise NotImplementedError("LEDG-212 step 1")


def invoice_total(lines, code):
    """Step 2. The total of an invoice's lines in the currency `code`."""
    raise NotImplementedError("LEDG-212 step 2")


def format_total(amount, code):
    """Step 3. A US dollar amount shown in the currency `code`."""
    raise NotImplementedError("LEDG-212 step 3")
