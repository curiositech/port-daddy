from deskkit import api


def test_known_product():
    assert api.team_for("billing") == "payments"


def test_case_and_spaces_are_ignored():
    assert api.team_for("  SSO ") == "identity"


def test_another_team():
    assert api.team_for("Search") == "platform"


def test_unknown_product_goes_to_triage():
    assert api.team_for("fax") == "triage"
