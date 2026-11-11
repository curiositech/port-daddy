from deskkit import api


def test_monday():
    assert api.on_call("billing", 0) == "amara"


def test_thursday():
    assert api.on_call("billing", 3) == "chidi"


def test_friday():
    assert api.on_call("search", 4) == "goran"


def test_saturday_uses_the_weekend_roster():
    assert api.on_call("login", 5) == "farah"


def test_unknown_product_on_sunday():
    assert api.on_call("fax", 6) == "ines"
