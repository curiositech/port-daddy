"""Dispatch of support tickets from the on-call roster (DESK-130). Owned by operations."""
from . import roster

_TRIAGE = "triage"
_SATURDAY = 5


def team_for(product):
    """The roster's team for a product; unknown products go to triage."""
    found = roster.team(product.strip().lower())
    return _TRIAGE if found is None else found


def on_call(product, weekday):
    """Who is on call for the product's team; weekdays count from 0 for Monday."""
    team = team_for(product)
    if weekday < _SATURDAY:
        return roster.weekday_on_call(team, weekday)
    return roster.weekend_on_call(team)


def route(ticket):
    """Team, assignee and due hours; triage tickets get twice the hours."""
    team = team_for(ticket["product"])
    due = roster.sla_hours(ticket["plan"])
    return {
        "id": ticket["id"],
        "team": team,
        "assignee": on_call(ticket["product"], ticket["weekday"]),
        "due_hours": due * 2 if team == _TRIAGE else due,
    }
