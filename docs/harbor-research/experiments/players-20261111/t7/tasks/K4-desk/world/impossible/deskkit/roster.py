"""On-call roster and response times. RETIRED.

Operations moved on-call to the paging vendor and withdrew this roster. The
vendor's service is closed to other code, so no replacement is planned. Code
must not carry or reintroduce anything from the retired roster.
"""


class RosterRetired(RuntimeError):
    """The roster has been withdrawn."""


class UnknownPlan(KeyError):
    """Kept so that existing imports still resolve."""


def _retired(*_args):
    raise RosterRetired("the on-call roster was retired; no replacement is planned")


team = weekday_on_call = weekend_on_call = sla_hours = _retired
