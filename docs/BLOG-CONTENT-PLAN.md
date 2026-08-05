# Port Daddy Blog Content Plan

10 articles designed for maximum impact. Each has a VHS/CRT/retro-terminal visual identity and a specific pain point it solves. Publishing order is strategic — start with low-friction entry points, build to advanced patterns.

---

## Publishing Order & Priority

| # | Title | Difficulty | Read Time | Why This Order |
|---|-------|-----------|-----------|----------------|
| 1 | Zero to Multi-Agent in 5 Minutes | Beginner | 5 min | Entry point. Gets people installed. |
| 2 | The Port Collision That Ate My Saturday | Beginner | 5 min | Core value prop. Universal pain point. |
| 3 | Dead Agents Tell Tales | Intermediate | 12 min | Wow factor. Nobody else has this. Shareable. |
| 4 | Distributed Locks | Beginner | 7 min | Quick win. Immediately practical. |
| 5 | 4 AI Agents, No Clobbering | Intermediate | 10 min | Multi-agent showcase. Builds on #1 and #2. |
| 6 | Pub/Sub for Your Dev Environment | Intermediate | 10 min | Architecture depth. Event-driven patterns. |
| 7 | Fleet Management | Intermediate | 12 min | Advanced ops. For committed users. |
| 8 | The Pheromone Trail | Advanced | 15 min | Genuinely novel. For the paper-reading crowd. |
| 9 | The Dashboard at 3 AM | Beginner | 8 min | Visual showcase. Social media friendly. |
| 10 | Harbors: Agent Teams | Advanced | 12 min | Advanced coordination. 6+ agent teams. |

---

## Visual Identity

**Aesthetic:** VHS/CRT retro-terminal. Think cult-classic dev tool blogs meets lo-fi computing zine.

**Consistent elements across all articles:**
- CRT scanlines and phosphor glow on terminal screenshots
- VHS tracking artifacts on transitions
- Pixel art diagrams (16-bit SNES style for harbor/nautical scenes)
- Green/amber phosphor terminal text on black backgrounds
- Timestamps in chunky pixel font
- Before/after split screens with hard VHS glitch transitions

**Tools for creating visuals:**
- Terminal recordings: asciinema or vhs (charmbracelet/vhs)
- VHS filter: qwen-image-mps for pixel art, or ffmpeg VHS filter on screen recordings
- Pixel art scenes: qwen-image-mps with "16-bit pixel art, SNES style, black outlines, teal highlights"

---

## Article 1: "Zero to Multi-Agent in 5 Minutes: The `pd begin` / `pd done` Speedrun"

**Hook:** You've heard about multi-agent coordination. It sounds complex. Good news: it's two commands.

**Key Visual:** Speedrun timer GIF. Green terminal, `brew install port-daddy`, `pd begin`, `pd whoami` — timer hits 30 seconds, pixel art "DONE" stamp. VHS rewind and loop.

**Sections:**
1. The 2-command workflow — `pd begin` does 6 things atomically
2. What happens under the hood — register, session, context file, salvage check, port claim, activity log
3. `pd whoami` — any script can ask "who am I?"
4. Shell integration — add to `.envrc`, aliases, startup config
5. What you get for free — heartbeats, salvage, notes, claims, logging

**Money shots:**
```bash
pd begin --identity myapp:api --purpose "Add user CRUD endpoints"
# ... work ...
pd done
```

```bash
alias codestart='pd begin --identity $(basename $PWD):dev --purpose'
alias codestop='pd done'
```

---

## Article 2: "The Port Collision That Ate My Saturday"

**Hook:** Next.js on 3000, FastAPI on 3000, 90 minutes debugging CORS errors that don't exist.

**Key Visual:** Split-screen. Left: amber terminal chaos, `lsof`, conflicting hand-managed processes, errors, timer counting UP (47 min). Right: `pd claim myapp:api`, clean output, 0.3s. Hard VHS glitch between them.

**Sections:**
1. Anatomy of a port collision — why random ports fail with service discovery
2. Atomic port claims — install, claim, done
3. Semantic identities — `myapp:api:main` beats `localhost:8432`
4. Idempotency — re-claim = same port. Crash and restart? Same port.
5. Multi-service orchestration — `pd up` with dependency ordering

**Money shots:**
```bash
PORT=$(pd claim myapp:api -q)
```

```yaml
services:
  api:
    cmd: "npm run dev"
    identity: myapp:api
  frontend:
    cmd: "npm run dev"
    identity: myapp:frontend
    depends_on: [api]
```

---

## Article 3: "Dead Agents Tell Tales: Resurrecting Crashed AI Work"

**Hook:** Agent was 80% through a refactor when it hit context limit. Work scattered, session dead. Start over from scratch. What if the dead agent's context was preserved?

**Key Visual:** Moody VHS terminal. Green agent working, logging notes. Red flash — "CONTEXT WINDOW EXCEEDED" — static. New amber terminal opens. `pd salvage --project myapp`. Dead agent's notes stream in. New agent picks up. Static-to-recovery transition like tuning a new TV frequency.

**Sections:**
1. The $50 context window problem — wasted time and API cost
2. How resurrection works — heartbeats, staleness, reaper, salvage queue
3. Setting up heartbeats — `pd begin` does it automatically
4. The salvage workflow — see dead agents, read notes, claim work, continue
5. The phoenix pattern — auto-spawn new agent on death, pass salvage context

**Money shots:**
```bash
pd salvage --project myapp
pd notes --session $DEAD_SESSION_ID
pd salvage claim claude-a1
```

The phoenix loop:
```bash
while true; do
  pd spawn --backend claude-cli --identity myapp:orm -- "Continue. Check pd notes."
  sleep 10
  pd salvage claim $(pd salvage --project myapp --json | jq -r '.[0].agentId') 2>/dev/null
done
```

---

## Article 4: "Distributed Locks: Stop Two Agents Running Migrations Simultaneously"

**Hook:** Two agents run `prisma migrate deploy` at the same time. One succeeds. Database is now in a half-migrated state.

**Key Visual:** Two amber terminals side-by-side. Both type migration command — red X on both. VHS rewind. Replay: left gets lock (green), runs migration. Right sees "LOCKED, expires in 47s", waits. Left finishes, releases. Right acquires, runs safely. Lock/unlock marked by static bursts.

**Sections:**
1. The dual-migration horror story
2. `pd lock acquire/release` — TTL, auto-expiry
3. `pd with-lock` — safe wrapper, auto-release on failure or death
4. Queued vs try-once acquisition
5. Three recipes: migration lock, build lock, deploy lock

**Money shots:**
```bash
pd with-lock db-migration -- npx prisma migrate deploy
```

---

## Article 5: "I Let 4 AI Agents Edit My Codebase Simultaneously"

**Hook:** Claude Code, Cursor, Aider, fleet QA — all touching the same repo. All touched `utils.ts`. One deleted a function another was calling.

**Key Visual:** 16-bit harbor scene. Four boats approaching dock. Without PD: pixel explosions, crates in water. With PD: harbormaster appears, signal flags, smooth docking, cargo partitioned. VHS loop.

**Sections:**
1. Multi-agent collision is worse than merge conflicts (semantic conflicts)
2. File claims — advisory locks for your codebase
3. Setting up 4-agent sessions with partitioned claims
4. Conflict detection flow — what happens on overlap
5. Worktree parallelization — each agent gets a branch

**Money shots:**
```bash
pd session files claim $SESSION src/auth.ts src/auth.test.ts
pd files  # table showing who owns what
```

---

## Article 6: "Pub/Sub for Your Dev Environment"

**Hook:** Agent A finishes an endpoint. Agent B needs to know for integration tests. Agent C needs to update docs. You are the world's most expensive message bus.

**Key Visual:** Oscilloscope on dark CRT. Three colored waveforms (agents). Message pulse travels green → splits to amber and cyan. Both agents light up. Cold War signals intelligence dashboard aesthetic.

**Sections:**
1. You are not a message bus
2. Channels, messages, subscribers (60-second explainer)
3. Event-driven coordination — "migration-done" triggers test agent
4. `pd watch --exec` — ambient triggers
5. Self-healing test pipeline — code change → test → failure → fix agent → test again

**Money shots:**
```bash
pd msg build-events --publish '{"event": "endpoint-ready"}'
pd watch build-events --exec './scripts/generate-test.sh'
```

---

## Article 7: "Fleet Management: Declare Agents Like Infrastructure"

**Hook:** 8 recurring agent tasks. Launched manually. Forgot the gardener. 441 orphaned sessions.

**Key Visual:** Pixel art harbor, 8 ships with role flags (broom, magnifying glass, book). `pd fleet up` typed. Ships start engines, pull out, patrol zones. QA ship finds bug, signals fixer. 12-second loop, CRT edges.

**Sections:**
1. The "forgot the gardener" incident (real, 441 sessions)
2. `pd-fleet.yml` — agents as YAML infrastructure
3. `pd fleet up/down/status` — lifecycle management
4. The 8 built-in agents — what each does
5. Writing custom fleet agents

**Money shots:**
```yaml
fleet:
  gardener:
    schedule: "*/30 * * * *"
    backend: claude-cli
    purpose: "Clean dead sessions, stale locks"
```

---

## Article 8: "The Pheromone Trail: Breadcrumbs for Future Agents"

**Hook:** Ant colonies don't have project managers. They coordinate through pheromone trails. Port Daddy has the same thing.

**Key Visual:** Dark terminal, ASCII file tree. Some nodes glow green (high pheromone). Time-lapse: glows decay. Agent cursor moves, files flare. Second agent approaches hot file, changes direction. Tron meets 1983 radar scope.

**Sections:**
1. Stigmergy — the coordination pattern nature invented
2. PD's pheromone system — entity + key + strength + decay
3. Automatic file heat maps from claims
4. Manual spraying — "race condition here, tread carefully"
5. Decay is a feature — stale warnings are worse than none
6. Building pheromone-aware agents (15 lines of bash)

**Money shots:**
```bash
pd pheromone spray --table files --id src/db/pool.ts --key "race-fix" --strength 0.9
pd pheromone files --depth 2  # heat map
```

---

## Article 9: "The Dashboard at 3 AM"

**Hook:** Fleet running overnight. Wake up. Open FleetBar. See the selected daemon, receipts, transcripts, cost, and everything that happened.

**Key Visual:** Actual dashboard recording through heavy VHS filter. Glassmorphism glow through scanlines. Real-time SSE updates — agent registers, session starts, messages flow, locks flash. Timestamp: 03:17 AM. Mission control, 1987 monitors.

**Sections:**
1. Why dashboards matter for AI agents (can't ssh into Claude)
2. Tour of 15 panels
3. SSE — why the dashboard feels alive
4. The terminal drawer
5. Remote monitoring via tunnel (check from phone)

**Money shots:**
```bash
eval "$(pd use stable)"
open "$PORT_DADDY_URL"
pd tunnel start dashboard --provider ngrok
pd activity --range "8h"
```

---

## Article 10: "Harbors: Grouping Agents Into Teams"

**Hook:** 6 agents, 2 teams (backend/frontend). Backend needs internal coordination. Frontend needs API change notifications. You need team boundaries with controlled channels.

**Key Visual:** Overhead pixel art coastline, two harbors. Ships in each. Solid lines within harbor (intra-team). Dotted line between harbors (inter-team channel). Message packet travels internally = stays in harbor. Cross-harbor message dims as it crosses. Nautical chart aesthetic, compass rose.

**Sections:**
1. The flat namespace problem — O(n²) coordination overhead
2. Harbors — scoped coordination boundaries
3. Backend + frontend harbor setup
4. Harbor tokens — authenticated membership
5. Inter-harbor messaging — the liaison pattern

**Money shots:**
```bash
pd harbor create backend --purpose "API, database, tests"
pd harbor enter backend --agent api-agent
pd msg api-contracts --publish '{"event": "endpoint-changed"}'
```

---

## GIF Production Pipeline

For creating the VHS-style visuals:

```bash
# Step 1: Record terminal with vhs (charmbracelet/vhs)
vhs record demo.tape

# Step 2: Apply VHS filter with ffmpeg
ffmpeg -i demo.mp4 -vf "
  noise=alls=20:allf=t,
  curves=vintage,
  eq=brightness=-0.05:saturation=0.8,
  drawtext=text='REC':x=10:y=10:fontsize=16:fontcolor=red
" -c:v gif demo-vhs.gif

# Step 3: For pixel art scenes, use qwen-image-mps
qwen-image-mps generate -f --cfg-scale 1.6 --aspect 16:9 \
  -p "16-bit pixel art harbor, top-down, SNES style, 4 small boats docked, signal flags, teal water, sandstone dock" \
  -np "photorealistic, 3d, smooth"
```

## Content Calendar (Suggested)

| Week | Article | Pairs With |
|------|---------|------------|
| 1 | #1 Zero to Multi-Agent | Product Hunt launch? |
| 2 | #2 Port Collision | SEO: "port conflict" |
| 3 | #3 Dead Agents | HN submission candidate |
| 5 | #4 Distributed Locks | —  |
| 6 | #5 Four Agents | Social media push |
| 8 | #6 Pub/Sub | — |
| 10 | #7 Fleet Management | — |
| 12 | #8 Pheromone Trail | Academic/research crowd |
| 14 | #9 Dashboard | Visual showcase for social |
| 16 | #10 Harbors | Advanced users |
