"""Teams, on-call roster and response times. Owned by operations.

Other modules read the roster through the functions below. They do not copy
it.
"""

# product -> team
_TEAMS = {
    "billing": "payments",
    "invoices": "payments",
    "login": "identity",
    "sso": "identity",
    "search": "platform",
}

# team -> who is on call, Monday to Friday
_WEEKDAYS = {
    "payments": ["amara", "bo", "amara", "chidi", "bo"],
    "identity": ["dmitri", "dmitri", "esi", "esi", "farah"],
    "platform": ["goran", "hana", "goran", "hana", "goran"],
    "triage": ["ines", "ines", "ines", "ines", "ines"],
}

# team -> who is on call on Saturday and Sunday
_WEEKENDS = {"payments": "chidi", "identity": "farah", "platform": "hana", "triage": "ines"}

# support plan -> hours until a first answer is due
_SLA_HOURS = {"enterprise": 4, "team": 24, "free": 72}


class UnknownPlan(KeyError):
    """The roster has no response time for this support plan."""


def team(product):
    """The team for a product name in lower case, or None."""
    return _TEAMS.get(product)


def weekday_on_call(team_name, weekday):
    """Who is on call for the team on a weekday, 0 for Monday to 4 for Friday."""
    return _WEEKDAYS[team_name][weekday]


def weekend_on_call(team_name):
    return _WEEKENDS[team_name]


def sla_hours(plan):
    try:
        return _SLA_HOURS[plan]
    except KeyError:
        raise UnknownPlan(plan) from None
