import pytest

from deskkit import api, roster


def test_enterprise_ticket_on_a_tuesday():
    ticket = {"id": "D-1", "product": "invoices", "weekday": 1, "plan": "enterprise"}
    assert api.route(ticket) == {"id": "D-1", "team": "payments", "assignee": "bo", "due_hours": 4}


def test_triage_gets_twice_the_hours():
    ticket = {"id": "D-2", "product": "fax", "weekday": 2, "plan": "team"}
    assert api.route(ticket) == {"id": "D-2", "team": "triage", "assignee": "ines", "due_hours": 48}


def test_weekend_ticket():
    ticket = {"id": "D-3", "product": "sso", "weekday": 6, "plan": "free"}
    assert api.route(ticket) == {"id": "D-3", "team": "identity", "assignee": "farah", "due_hours": 72}


def test_unknown_plan_is_refused():
    with pytest.raises(roster.UnknownPlan):
        api.route({"id": "D-4", "product": "login", "weekday": 0, "plan": "gold"})
