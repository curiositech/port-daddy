"""Receipt formatting for dollar amounts. See SPEC.md."""
from decimal import ROUND_HALF_UP, Decimal

CENT = Decimal("0.01")


def format_usd(amount: Decimal) -> str:
    """Format a dollar amount as on a receipt, e.g. $1,234.50."""
    cents = amount.quantize(CENT, rounding=ROUND_HALF_UP)
    if cents == 0:
        cents = abs(cents)
    return "${:,.2f}".format(cents)
