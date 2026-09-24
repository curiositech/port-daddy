#!/usr/bin/env python3
"""Render static HTML storefront previews from catalog.json, styled with the
operator's own site tokens so mockups blend in with the existing site.

Stdlib-only. Produces self-contained HTML files (inline CSS, no JS deps):
  out/index.html            product grid
  out/product-<slug>.html   one detail page per active product

Usage:
    python3 render_storefront_preview.py catalog.json --out preview/
    python3 render_storefront_preview.py catalog.json --style style-tokens.json --out preview/

Style tokens come from extract_site_style.py (or hand-written). Without them,
a deliberately non-generic editorial default is used (Georgia, warm paper,
oxide accent) — NOT Inter-on-indigo.

Typography floor: body text renders at 16px, nothing below 14px. Do not lower.
"""
import argparse
import html
import json
from pathlib import Path

CART_SVG = ('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
            'stroke-width="1.8" aria-hidden="true"><circle cx="9" cy="20" r="1.6"/>'
            '<circle cx="17" cy="20" r="1.6"/><path d="M3 3h2l2.6 12.5a1 1 0 0 0 1 .8h8.7a1 1 0 0 0 1-.8L20 8H6"/></svg>')

DEFAULT_TOKENS = {
    "fonts": {"heading": "Georgia", "body": "Georgia"},
    "colors": {"background": "#faf8f5", "text": "#1c1917", "accent": "#9a3b1c"},
    "radius": "4px",
}


def money(cents: int, currency: str) -> str:
    symbol = {"usd": "$", "eur": "€", "gbp": "£", "cad": "CA$", "aud": "AU$"}.get(currency, currency.upper() + " ")
    return f"{symbol}{cents / 100:,.2f}"


def css(tokens: dict) -> str:
    f, c = tokens["fonts"], tokens["colors"]
    heading = f.get("heading") or "Georgia"
    body = f.get("body") or "Georgia"
    radius = tokens.get("radius", "4px")
    return f"""
:root {{ --bg: {c['background']}; --ink: {c['text']}; --accent: {c['accent']}; --radius: {radius}; }}
* {{ box-sizing: border-box; margin: 0; }}
body {{ background: var(--bg); color: var(--ink); font-family: "{body}", Georgia, serif;
       font-size: 16px; line-height: 1.6; padding: 0 24px 64px; }}
h1, h2, h3 {{ font-family: "{heading}", Georgia, serif; font-weight: 600; line-height: 1.2; }}
a {{ color: var(--accent); text-decoration: none; }}
a:hover {{ text-decoration: underline; }}
header.site {{ max-width: 1040px; margin: 0 auto; padding: 28px 0 20px; display: flex;
               justify-content: space-between; align-items: baseline;
               border-bottom: 1px solid color-mix(in srgb, var(--ink) 15%, transparent); }}
header.site .brand {{ font-size: 22px; letter-spacing: 0.01em; color: var(--ink); }}
header.site nav {{ display: flex; gap: 20px; align-items: center; font-size: 15px; }}
main {{ max-width: 1040px; margin: 36px auto 0; }}
.grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 32px; }}
.card {{ display: block; color: var(--ink); }}
.card .frame {{ aspect-ratio: 1; background: color-mix(in srgb, var(--ink) 6%, var(--bg));
                border-radius: var(--radius); overflow: hidden; display: flex;
                align-items: center; justify-content: center; }}
.card img {{ width: 100%; height: 100%; object-fit: cover; }}
.card .ph {{ font-size: 14px; opacity: 0.45; }}
.card h3 {{ font-size: 17px; margin-top: 12px; }}
.card .price {{ font-size: 15px; margin-top: 2px; }}
.price .was {{ text-decoration: line-through; opacity: 0.5; margin-left: 8px; }}
.badge {{ display: inline-block; font-size: 14px; color: var(--accent);
          border: 1px solid var(--accent); border-radius: 999px; padding: 1px 10px; margin-left: 8px; }}
.detail {{ display: grid; grid-template-columns: 1fr 1fr; gap: 48px; }}
@media (max-width: 760px) {{ .detail {{ grid-template-columns: 1fr; }} }}
.detail .frame {{ aspect-ratio: 1; background: color-mix(in srgb, var(--ink) 6%, var(--bg));
                  border-radius: var(--radius); overflow: hidden; }}
.detail img {{ width: 100%; height: 100%; object-fit: cover; }}
.detail h1 {{ font-size: 30px; }}
.detail .price {{ font-size: 21px; margin: 14px 0 20px; }}
.detail .desc {{ font-size: 16px; max-width: 56ch; }}
.opts {{ margin: 22px 0; }}
.opts label {{ display: block; font-size: 14px; text-transform: uppercase;
               letter-spacing: 0.08em; font-weight: 600; margin-bottom: 6px; }}
.opts select, .qty input {{ font: inherit; font-size: 15px; padding: 8px 12px;
        border: 1px solid color-mix(in srgb, var(--ink) 30%, transparent);
        border-radius: var(--radius); background: var(--bg); color: var(--ink); min-width: 140px; }}
.buy {{ display: inline-flex; gap: 10px; align-items: center; font-size: 16px; font-weight: 600;
        background: var(--accent); color: var(--bg); border: none; border-radius: var(--radius);
        padding: 13px 26px; cursor: pointer; }}
.stock {{ font-size: 14px; margin-top: 12px; opacity: 0.75; }}
.preview-note {{ max-width: 1040px; margin: 56px auto 0; font-size: 14px; opacity: 0.65;
                 border-top: 1px solid color-mix(in srgb, var(--ink) 15%, transparent); padding-top: 14px; }}
"""


def page(title: str, body_html: str, tokens: dict, store: dict) -> str:
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)}</title>
<style>{css(tokens)}</style></head>
<body>
<header class="site">
  <a class="brand" href="index.html">{html.escape(store['name'])}</a>
  <nav><a href="index.html">Shop</a><a href="#">About</a>
       <a href="#" aria-label="Cart">{CART_SVG}</a></nav>
</header>
<main>{body_html}</main>
<p class="preview-note">Design preview rendered from catalog.json — static mockup, checkout not wired.
Buttons show where the real checkout (Stripe / cart provider) attaches.</p>
</body></html>"""


def img_or_ph(images: list, alt: str, cls: str = "frame") -> str:
    if images:
        return f'<div class="{cls}"><img src="{html.escape(images[0])}" alt="{html.escape(alt)}"></div>'
    return f'<div class="{cls}"><span class="ph">photo forthcoming</span></div>'


def render(catalog: dict, tokens: dict, out: Path) -> list[str]:
    store = catalog["store"]
    currency = store["currency"]
    products = [p for p in catalog["products"] if p.get("active", True) and (p.get("channels") or {}).get("web", True)]
    written = []

    cards = []
    for p in products:
        sale = ""
        if p.get("compare_at_cents"):
            sale = f'<span class="was">{money(p["compare_at_cents"], currency)}</span>'
        cards.append(f"""<a class="card" href="product-{p['slug']}.html">
  {img_or_ph(p.get('images', []), p['name'])}
  <h3>{html.escape(p['name'])}</h3>
  <p class="price">{money(p['price_cents'], currency)}{sale}</p></a>""")
    grid = f"<h1 style='font-size:26px;margin-bottom:28px'>Shop</h1><div class='grid'>{''.join(cards)}</div>"
    (out / "index.html").write_text(page(f"Shop — {store['name']}", grid, tokens, store))
    written.append("index.html")

    for p in products:
        variants = p.get("variants") or []
        opts = ""
        if variants:
            keys = sorted({k for v in variants for k in (v.get("options") or {})})
            for key in keys:
                choices = []
                seen = set()
                for v in variants:
                    val = (v.get("options") or {}).get(key)
                    if val and val not in seen:
                        seen.add(val)
                        price = v.get("price_cents", p["price_cents"])
                        choices.append(f"<option>{html.escape(val)} — {money(price, currency)}</option>")
                opts += f"<div class='opts'><label>{html.escape(key)}</label><select>{''.join(choices)}</select></div>"
        inv = p.get("inventory") or {}
        stock = ""
        if inv.get("track") and isinstance(inv.get("quantity"), int):
            q = inv["quantity"]
            thresh = inv.get("low_stock_threshold", 3)
            stock = f"<p class='stock'>{'Only ' + str(q) + ' left' if q <= thresh else 'In stock'}</p>"
        sale = ""
        badge = ""
        if p.get("compare_at_cents"):
            sale = f'<span class="was">{money(p["compare_at_cents"], currency)}</span>'
            badge = '<span class="badge">On sale</span>'
        if p.get("kind") == "digital":
            badge += '<span class="badge">Digital download</span>'
        detail = f"""<div class="detail">
  {img_or_ph(p.get('images', []), p['name'])}
  <div>
    <h1>{html.escape(p['name'])}{badge}</h1>
    <p class="price">{money(p['price_cents'], currency)}{sale}</p>
    <p class="desc">{html.escape(p['description'])}</p>
    {opts}
    <button class="buy">{CART_SVG} Add to cart</button>
    {stock}
  </div></div>"""
        fname = f"product-{p['slug']}.html"
        (out / fname).write_text(page(f"{p['name']} — {store['name']}", detail, tokens, store))
        written.append(fname)
    return written


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("catalog")
    ap.add_argument("--style", help="style-tokens.json from extract_site_style.py")
    ap.add_argument("--out", default="preview")
    args = ap.parse_args()

    catalog = json.loads(Path(args.catalog).read_text())
    tokens = dict(DEFAULT_TOKENS)
    if args.style:
        loaded = json.loads(Path(args.style).read_text())
        for key in ("fonts", "colors"):
            tokens[key] = {**DEFAULT_TOKENS[key], **(loaded.get(key) or {})}
        tokens["radius"] = loaded.get("radius", tokens["radius"])
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    written = render(catalog, tokens, out)
    print(f"Wrote {len(written)} pages to {out}/ — open {out}/index.html")
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(main())
