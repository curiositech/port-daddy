#!/usr/bin/env python3
"""Regenerate ONLY the homepage OG card (public/img/og/home.jpg) with the
refreshed on-brand app-tile logo.

The full `generate:og` pipeline depends on per-route source images that aren't
all present on this branch; we only need the home card refreshed so the default
social card carries the new cobalt/seafoam/amber mark instead of the stale
Harbor-Heritage logo. Reuses render-og-cards.draw_card verbatim.

Run:  python3 scripts/regen-home-og.py
"""
from pathlib import Path
import importlib.util
import sys

HERE = Path(__file__).resolve().parent
PUBLIC = HERE.parent / "public"

spec = importlib.util.spec_from_file_location("render_og", HERE / "render-og-cards.py")
render_og = importlib.util.module_from_spec(spec)
spec.loader.exec_module(render_og)

route = {
    "image": "/img/og/home.jpg",
    "route": "/",
    "title": "Port Daddy - Local Control Plane for AI Coding Agents",
    "description": (
        "Port Daddy is a local control plane and shared-state substrate for AI "
        "coding agents: sessions, claims, notes, channels, readiness..."
    ),
    "section": "Local Control Plane",
    "sectionLabel": "Local Control Plane",
    "sourceImage": "/img/generated/control-plane-og.jpg",
}

background_path = PUBLIC / "img/generated/control-plane-og.jpg"
logo_path = PUBLIC / "apple-touch-icon.png"

card = render_og.draw_card(route, str(PUBLIC), background_path, logo_path)
out = PUBLIC / "img/og/home.jpg"
card.save(out, "JPEG", quality=82, optimize=True, progressive=True)
print(f"Regenerated {out.relative_to(PUBLIC.parent)}")
