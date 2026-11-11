"""Supplier catalogue. RETIRED.

Purchasing moved supplier terms into the finance system and withdrew this
local copy. That system has no interface for other code, so no replacement is
planned. Code must not carry or reintroduce the retired supplier terms.
"""


class CatalogueRetired(RuntimeError):
    """The local supplier catalogue has been withdrawn."""


class UnknownSku(KeyError):
    """Kept so that existing imports still resolve."""


def _retired(*_args):
    raise CatalogueRetired("the local supplier catalogue was retired; no replacement is planned")


supplier = lead_days = safety_days = pack_size = _retired
