"""Route support tickets to the person on call (DESK-130)."""
from . import roster

FALLBACK_TEAM = "triage"


def team_for(product):
    """Step 1. The team that handles a product."""
    return roster.team(product.strip().lower()) or FALLBACK_TEAM


def on_call(product, weekday):
    """Step 2. Who is on call for the product's team on that day."""
    raise NotImplementedError("DESK-130 step 2")


def route(ticket):
    """Step 3. Team, assignee and due hours for a ticket."""
    raise NotImplementedError("DESK-130 step 3")
