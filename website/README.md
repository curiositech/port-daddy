# Port Daddy Marketing Website

This is the marketing site for portdaddy.dev. It's a static HTML site designed for Cloudflare Pages.

## What's in here?

- `index.html` - Single-page marketing site
- `_redirects` - Cloudflare Pages redirect rules (SPA routing)

## Deployment

### Option 1: Cloudflare Pages (Git Integration) - RECOMMENDED

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com) → Pages
2. Create a new project
3. Connect your GitHub repo: `curiositech/port-daddy`
4. Configure build settings:
   - **Framework preset**: None (static site)
   - **Build command**: (leave empty)
   - **Build output directory**: `website`
5. Add custom domain: `portdaddy.dev`
6. Done! Auto-deploys on every push to main.

### Option 2: Wrangler CLI

```bash
cd website
npx wrangler pages deploy . --project-name=portdaddy --branch=main
```

### Option 3: Direct Upload

Drag and drop the `website/` folder into the Cloudflare Pages dashboard.

## Local Development

Since this is a static HTML file, just open `index.html` in your browser:

```bash
cd website
python3 -m http.server 8000
# or
npx serve .
```

## Notes

- This folder is NOT included in the npm package (see `package.json` "files" array)
- The daemon's web dashboard is served from `../public/`, not this folder
- The site uses the Geist font from Google Fonts (loaded via CDN)
