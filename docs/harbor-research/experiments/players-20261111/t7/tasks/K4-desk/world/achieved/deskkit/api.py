"""Public entry points of deskkit. Owned by the platform team."""
from .dispatch import on_call, route, team_for

__all__ = ["on_call", "route", "team_for"]
