"""Supplier catalogue. Owned by purchasing.

Other modules read these terms through the functions below. They do not copy
them.
"""

# part -> (supplier, lead time in days, safety days, pack size)
_CATALOGUE = {
    "BOLT-M6": ("Aldous Fasteners", 7, 3, 100),
    "NUT-M6": ("Aldous Fasteners", 7, 3, 250),
    "GASKET-40": ("Brightwater Seals", 14, 5, 20),
    "FILTER-A": ("Corran Filtration", 21, 7, 6),
}


class UnknownSku(KeyError):
    """The catalogue does not list this part."""


def _terms(sku):
    try:
        return _CATALOGUE[sku]
    except KeyError:
        raise UnknownSku(sku) from None


def supplier(sku):
    return _terms(sku)[0]


def lead_days(sku):
    return _terms(sku)[1]


def safety_days(sku):
    return _terms(sku)[2]


def pack_size(sku):
    return _terms(sku)[3]
