"""Money for the ledger: whole cents held as int (RULES.md, R1 and R2)."""

import re

BPS = 10_000  # basis points in one whole
_GROUPED = re.compile(r"\d{1,3}(,\d{3})+(\.\d{0,2})?")


class MoneyError(ValueError):
    """An amount that the ledger will not accept."""


def require_cents(value, name="amount"):
    """Return value when it is a whole, non-negative number of cents."""
    if isinstance(value, bool) or not isinstance(value, int):
        raise MoneyError(f"{name} must be an int number of cents, got {value!r}")
    if value < 0:
        raise MoneyError(f"{name} must not be negative, got {value}")
    return value


def parse_amount(text):
    """Turn '1,250.50' or '12' into cents. At most two decimal places."""
    plain = text.strip()
    if "," in plain:
        if not _GROUPED.fullmatch(plain):
            raise MoneyError(f"not an amount: {text!r}")
        plain = plain.replace(",", "")
    whole, _, frac = plain.partition(".")
    if not whole.isdigit() or (frac and not frac.isdigit()) or len(frac) > 2:
        raise MoneyError(f"not an amount: {text!r}")
    return int(float(plain) * 100)


def format_amount(cents):
    """Turn cents into text with two decimal places: 1250 -> '12.50'."""
    require_cents(cents)
    return f"{cents // 100}.{cents % 100:02d}"


def share(amount, bps):
    """The part of amount given by bps basis points, rounded down (R2)."""
    require_cents(amount)
    if isinstance(bps, bool) or not isinstance(bps, int) or not 0 <= bps <= BPS:
        raise MoneyError(f"basis points must be an int from 0 to {BPS}, got {bps!r}")
    return amount * bps // BPS


def split(total, parts):
    """Split total into equal parts that add up to it. Early parts take the odd cents."""
    require_cents(total, "total")
    if isinstance(parts, bool) or not isinstance(parts, int) or parts < 1:
        raise MoneyError(f"parts must be a positive int, got {parts!r}")
    base, extra = divmod(total, parts)
    return [base + (1 if i < extra else 0) for i in range(parts)]
