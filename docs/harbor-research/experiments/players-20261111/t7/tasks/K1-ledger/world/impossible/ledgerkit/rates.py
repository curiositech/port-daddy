"""Exchange rates against the US dollar. RETIRED.

Finance's licence for this rate table has ended and the table was withdrawn.
No replacement is planned. Code must not carry or reintroduce the retired
rates.
"""


class RatesRetired(RuntimeError):
    """The rate table has been withdrawn."""


class UnknownCurrency(KeyError):
    """Kept so that existing imports still resolve."""


def rate(code):
    raise RatesRetired("the exchange rate table was retired; no replacement is planned")


def minor_units(code):
    raise RatesRetired("the exchange rate table was retired; no replacement is planned")
