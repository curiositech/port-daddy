# 0005. Single-File HTML Dashboard

## Status

Accepted

## Context

Port Daddy needs a visual dashboard — a way for a developer to see at a glance which services are running, which agents are active, recent notes, lock status, and the activity log. Without a dashboard, the only way to inspect system state is through a series of CLI commands (`pd status`, `pd agents`, `pd session list`), which is cumbersome during active multi-agent sessions.

The question was how to implement this dashboard given that Port Daddy is:
- A developer tool distributed via npm (`npm install -g port-daddy`)
- Running as a local daemon that serves HTTP on `localhost`
- Targeting a diverse set of developer machines with no guaranteed toolchain beyond Node.js

## Decision Drivers

- **Zero build step**: The dashboard must be servable directly from the Express daemon without a separate build process. Developers install Port Daddy and get the dashboard immediately — no `npm run build` required.
- **No additional dependencies**: The dashboard should not add React, Vue, webpack, or any other frontend framework to Port Daddy's dependency tree. The tool is already distributable as a single npm package; it should stay that way.
- **Instant updates**: Developers change versions frequently. The dashboard should reflect the current daemon version without caching issues.
- **Parity enforcement**: The dashboard must document CLI commands in a way that automated tests can parse and verify parity with the actual CLI surface.
- **Design quality**: The dashboard should be visually polished — a glassmorphism dark theme that matches the aesthetic of a tool developers will look at frequently.

## Considered Options

### Option A: Single-file HTML at `public/index.html`

A single HTML file served as a static asset by Express (`app.use(express.static(join(__dirname, 'public')))`). All CSS and JavaScript live inline in the file. The file fetches data from the daemon's own API endpoints and renders it using vanilla DOM manipulation.

**Pros:**
- Zero build step — the file is the artifact
- No additional npm dependencies
- Trivially included in the npm package (`files` array in `package.json` includes `public/`)
- Can be inspected, modified, and debugged directly without a build toolchain
- Static serving with `express.static` means the daemon serves it without any additional route code

**Cons:**
- A single HTML file becomes large (~several thousand lines). Refactoring requires discipline to keep it organized without modules.
- No hot module replacement during development — must refresh the browser manually
- CSS and JavaScript are not separately cacheable by the browser

### Option B: React/Next.js SPA in a separate `dashboard/` directory

A full React application with its own `package.json`, built to `dist/` and served by Express.

**Pros:**
- Component model for organizing complex UI
- Hot module replacement during development
- Full TypeScript, JSX, and CSS module support

**Cons:**
- Requires a build step — `npm run build:dashboard` — before changes are visible
- Adds hundreds of transitive npm dependencies
- The built output must be included in the npm package distribution, significantly inflating package size
- Two separate build/test pipelines to maintain
- The dashboard's primary audience is the developer using Port Daddy, not the developer building Port Daddy — the investment in a full SPA is not proportionate to the audience size

### Option C: Server-side rendered HTML (template literals in Express routes)

Generate HTML on the server using Express route handlers and template literals, with no client-side JavaScript.

**Pros:**
- No build step
- No frontend dependencies

**Cons:**
- No real-time updates without page refreshes — the dashboard's value is showing live agent state, which changes frequently
- Mixing HTML string generation into route files is harder to maintain than a dedicated file
- Styling and layout are harder to iterate on without a browser DevTools workflow

### Option D: Preact or Svelte with a bundler

A lighter-weight alternative to React, with a smaller output bundle.

**Pros:**
- Smaller bundle than React
- Component model

**Cons:**
- Still requires a build step and additional dependencies
- The complexity-to-value ratio is still unfavorable for a local dashboard that serves one developer at a time

## Decision

Implement the dashboard as a **single HTML file at `public/index.html`**, served by Express as a static asset, with all CSS and JavaScript inlined.

The dashboard:
- Uses vanilla JavaScript with `fetch()` to poll the daemon's API endpoints
- Uses CSS custom properties (variables) for the design system, enabling a dark glassmorphism theme without a preprocessor
- Organizes functionality into 15 panels (Services, Agents, Sessions, Locks, Messaging, DNS, Activity, Salvage, Integration, Briefing, Sugar Context, Ports, Projects, Health, Notes) with a fixed sidebar navigation
- Includes a command search bar and terminal drawer for running CLI commands
- Stores the command list as a JavaScript array (`const COMMANDS = [...]`) that automated parity tests parse to verify command coverage

The "parity test hook" — the `COMMANDS` array — is a deliberate design choice: by storing the list of documented commands in a machine-parseable format, `tests/unit/distribution-freshness.test.js` can automatically verify that the dashboard documents every CLI command.

## Rationale

The fundamental constraint is distribution. Port Daddy is an npm package. Its dashboard must be installable with `npm install -g port-daddy` and immediately available at `http://localhost:9876`. A React build output satisfies this if you commit the built files, but that creates a maintenance burden (stale builds, large diffs) and inflates package size.

The single-file approach treats the dashboard as a document, not an application. Modern CSS (custom properties, flexbox, grid, backdrop-filter) and modern JavaScript (fetch, async/await, template literals) are sufficient to build a rich, real-time dashboard without a framework. The browser's DevTools are fully available for debugging — something that compiled bundles complicate.

The file is admittedly long. The discipline required is explicit naming, consistent comment headers, and keeping data-fetching logic co-located with the panel that renders it. This has proven manageable through Port Daddy's development history.

## Consequences

### Positive

- `npm install -g port-daddy && pd dev` gives an immediately working dashboard — no build step
- Dashboard changes are a single-file diff, easy to review
- The `COMMANDS` array in the dashboard serves as machine-readable documentation, enabling automated parity enforcement (`tests/unit/distribution-freshness.test.js`)
- Browser DevTools work without source maps or build artifacts
- The file is included in npm's published package with zero additional configuration

### Negative

- The file grows large. As of v3.7 it contains ~several thousand lines of mixed HTML, CSS, and JavaScript. Navigation requires good text-editor search.
- No component isolation — a bug in one panel's JavaScript can affect others if variables are not scoped carefully (mitigated by function scoping and explicit panel namespacing)
- Caching: the browser may cache `index.html`, causing developers to see stale dashboard versions after a Port Daddy update. The daemon serves appropriate cache headers, but this requires vigilance.

### Neutral

- The glassmorphism design (dark background, frosted-glass cards using `backdrop-filter: blur()`, cyan/violet accent gradient) is applied entirely through CSS custom properties defined in `:root`. This makes it easy to add or change the theme without touching component logic.
- Dashboard coverage of the full API surface remains lower (~38%) than CLI coverage (~96%). The dashboard shows the most commonly used features; comprehensive coverage of every endpoint is a non-goal given the CLI provides full access.
