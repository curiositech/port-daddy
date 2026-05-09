# Vendored frontend libraries

These are committed into the repo so the `/metrics.html` dashboard works under
the daemon's strict CSP (`script-src 'self' 'unsafe-inline'`) and on machines
without internet access.

## Versions

| File | Package | Version | Source |
|------|---------|---------|--------|
| `chart.umd.min.js` | [chart.js](https://www.npmjs.com/package/chart.js) | 4.4.7 | https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js |
| `chartjs-adapter-date-fns.bundle.min.js` | [chartjs-adapter-date-fns](https://www.npmjs.com/package/chartjs-adapter-date-fns) | 3.0.0 | https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3.0.0/dist/chartjs-adapter-date-fns.bundle.min.js |
| `chartjs-plugin-annotation.min.js` | [chartjs-plugin-annotation](https://www.npmjs.com/package/chartjs-plugin-annotation) | 3.0.1 | https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation@3.0.1/dist/chartjs-plugin-annotation.min.js |

## Refresh procedure

```bash
cd public/vendor
curl -fsSL -o chart.umd.min.js                       https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js
curl -fsSL -o chartjs-adapter-date-fns.bundle.min.js https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3.0.0/dist/chartjs-adapter-date-fns.bundle.min.js
curl -fsSL -o chartjs-plugin-annotation.min.js       https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation@3.0.1/dist/chartjs-plugin-annotation.min.js
```

Then bump the version table above and commit.

## Licenses

All three are MIT-licensed. License headers are preserved in the minified files.
