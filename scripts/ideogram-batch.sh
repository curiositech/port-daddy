#!/bin/bash
# Ideogram Batch Image Generator for Port Daddy Blog
# Usage: ./scripts/ideogram-batch.sh [--heroes-only] [--article N]
#
# API: POST https://api.ideogram.ai/v1/ideogram-v3/generate
# Auth: Api-Key header from $IDEOGRAM_API_KEY
# Rate limit: 10 concurrent requests
# Images expire — script downloads immediately
#
# Generates images sequentially (Ideogram rate limit is 10 inflight).
# Each image takes ~10-30 seconds to generate.

set -euo pipefail

API_URL="https://api.ideogram.ai/v1/ideogram-v3/generate"
API_KEY="${IDEOGRAM_API_KEY:?IDEOGRAM_API_KEY not set. Set in ~/.zshrc or pass as env var.}"
OUT_DIR="$(cd "$(dirname "$0")/../website-v2/public/img/blog" && pwd)"
HEROES_ONLY=false
ARTICLE_FILTER=""

# Parse args
for arg in "$@"; do
  case $arg in
    --heroes-only) HEROES_ONLY=true ;;
    --article) shift; ARTICLE_FILTER="$1" ;;
    --article=*) ARTICLE_FILTER="${arg#*=}" ;;
  esac
  shift 2>/dev/null || true
done

echo "Output directory: $OUT_DIR"
echo "Heroes only: $HEROES_ONLY"
[ -n "$ARTICLE_FILTER" ] && echo "Article filter: $ARTICLE_FILTER"
echo ""

generate_image() {
  local name="$1"
  local prompt="$2"
  local aspect="$3"
  local style="$4"
  local outfile="$OUT_DIR/${name}.png"

  # Skip if already exists
  if [ -f "$outfile" ]; then
    echo "SKIP $name (already exists)"
    return 0
  fi

  echo "GENERATING $name..."
  echo "  Prompt: ${prompt:0:80}..."
  echo "  Aspect: $aspect | Style: $style"

  # Map aspect ratio to V3 format (e.g., "16x9", "3x1", "1x1")
  local ideogram_aspect
  case "$aspect" in
    "16:9") ideogram_aspect="16x9" ;;
    "3:1")  ideogram_aspect="3x1" ;;
    "1:1")  ideogram_aspect="1x1" ;;
    "3:2")  ideogram_aspect="3x2" ;;
    "4:3")  ideogram_aspect="4x3" ;;
    "9:16") ideogram_aspect="9x16" ;;
    *)      ideogram_aspect="16x9" ;;
  esac

  # Map style to Ideogram V3 style_type + optional style_preset
  local ideogram_style="DESIGN"
  local style_preset_flag=""
  case "$style" in
    *poster*|*Poster*)
      ideogram_style="DESIGN"
      style_preset_flag="-F style_preset=VINTAGE_POSTER"
      ;;
    *diagram*|*Diagram*|*technical*|*Technical*|*blueprint*)
      ideogram_style="DESIGN"
      ;;
    *realistic*|*Realistic*)
      ideogram_style="REALISTIC"
      ;;
    *pixel*|*Pixel*|*retro*|*Retro*|*CRT*|*radar*)
      ideogram_style="DESIGN"
      ;;
    *steampunk*|*Steampunk*)
      ideogram_style="DESIGN"
      style_preset_flag="-F style_preset=STEAMPUNK"
      ;;
    *"art nouveau"*|*"Art nouveau"*|*"Art Nouveau"*)
      ideogram_style="DESIGN"
      style_preset_flag="-F style_preset=ART_NOUVEAU"
      ;;
    *chart*|*Chart*|*map*|*Map*)
      ideogram_style="DESIGN"
      ;;
    *) ideogram_style="GENERAL" ;;
  esac

  # Call Ideogram V3 API (multipart/form-data)
  local response
  response=$(curl -s -X POST "$API_URL" \
    -H "Api-Key: $API_KEY" \
    -F "prompt=$prompt" \
    -F "aspect_ratio=$ideogram_aspect" \
    -F "style_type=$ideogram_style" \
    -F "rendering_speed=DEFAULT" \
    -F "magic_prompt=ON" \
    -F "num_images=1" \
    $style_preset_flag \
    2>&1)

  # Extract image URL from response
  local image_url
  image_url=$(echo "$response" | python3 -c "
import sys, json
try:
    r = json.load(sys.stdin)
    if 'data' in r and len(r['data']) > 0:
        print(r['data'][0]['url'])
    else:
        print('ERROR: ' + json.dumps(r)[:200], file=sys.stderr)
        sys.exit(1)
except Exception as e:
    print('ERROR: ' + str(e), file=sys.stderr)
    print(sys.stdin.read()[:200], file=sys.stderr)
    sys.exit(1)
" 2>&1)

  if [[ "$image_url" == ERROR* ]]; then
    echo "  FAILED: $image_url"
    return 1
  fi

  # Download the image (URLs expire!)
  curl -s -o "$outfile" "$image_url"

  if [ -f "$outfile" ] && [ -s "$outfile" ]; then
    local size=$(wc -c < "$outfile" | tr -d ' ')
    echo "  OK: $outfile (${size} bytes)"
  else
    echo "  FAILED: download failed"
    rm -f "$outfile"
    return 1
  fi

  # Be kind to rate limits
  sleep 2
}

# ============================================================
# ARTICLE 1: Zero to Multi-Agent in 5 Minutes
# ============================================================

if [ -z "$ARTICLE_FILTER" ] || [ "$ARTICLE_FILTER" = "1" ]; then
  echo "=== Article 1: Zero to Multi-Agent ==="

  generate_image "zero-to-multi-agent-hero" \
    "Vintage travel poster illustration of a harbor control tower at dawn, a harbormaster holding a clipboard waving ships through the entrance. Three small colorful boats entering the harbor in a line. Bold text at top reads 'PORT DADDY' and text at bottom reads 'ZERO TO MULTI-AGENT IN 5 MINUTES'. Warm coral red, teal water, sandstone dock, dark sky. Retro mid-century poster style, clean lines, flat color blocks, nautical flags on the tower." \
    "16:9" "Vintage travel poster"

  if [ "$HEROES_ONLY" = false ]; then
    generate_image "zero-to-multi-agent-section-1" \
      "Technical diagram illustration showing two command blocks connected by a dotted line. Left block labeled 'pd begin' with six small icons radiating outward: heartbeat pulse, clipboard, file, anchor, port symbol, and activity log. Right block labeled 'pd done' with a checkmark. Warm ebony background, teal lines, coral accents, sandstone text. Clean flat design, monospaced font." \
      "3:1" "Technical diagram"

    generate_image "zero-to-multi-agent-section-2" \
      "Illustration of a ship's identification card displayed on a radar screen. The card shows fields: AGENT claude-a1, IDENTITY myapp:api, SESSION active, PURPOSE CRUD endpoints. Green radar sweep in background. Teal and coral on dark background. Retro military radar aesthetic, phosphor glow, CRT scanlines." \
      "3:1" "Retro CRT radar"

    generate_image "zero-to-multi-agent-section-3" \
      "Vintage travel poster of a terminal window floating above a harbor at sunset. The terminal shows alias codestart in green monospace text. Below the terminal, boats are docking automatically without a harbormaster. Text reads SHELL INTEGRATION. Sandstone, teal, coral. Clean retro poster lines." \
      "3:1" "Vintage travel poster"

    generate_image "zero-to-multi-agent-section-4" \
      "Isometric illustration of a harbor with invisible infrastructure glowing beneath the waterline — heartbeat pulses, file claim threads, activity log scrolls, and salvage nets. Above water everything looks simple: three boats docked peacefully. Label reads WHAT YOU GET FOR FREE. Teal water transparent to show hidden systems, coral highlights, sandstone dock, dark background." \
      "3:1" "Isometric technical"
  fi
fi

# ============================================================
# ARTICLE 2: Port Collision That Ate My Saturday
# ============================================================

if [ -z "$ARTICLE_FILTER" ] || [ "$ARTICLE_FILTER" = "2" ]; then
  echo "=== Article 2: Port Collision ==="

  generate_image "port-collision-hero" \
    "Vintage travel poster of two large ships colliding bow-to-bow in a harbor entrance, water splashing dramatically. A harbormaster on the dock facepalms. Bold text at top reads 'PORT DADDY' and text at bottom reads 'THE PORT COLLISION THAT ATE MY SATURDAY'. Coral red ships, teal water, sandstone dock, warm ebony sky. Retro mid-century poster style, dramatic composition, nautical signal flags." \
    "16:9" "Vintage travel poster"

  if [ "$HEROES_ONLY" = false ]; then
    generate_image "port-collision-section-1" \
      "Split-screen illustration. Left side: chaotic harbor scene, boats crashing, tangled ropes, red warning lights, timer showing 90 MIN in red. Right side: orderly harbor, boats in assigned berths with numbered signs, green lights, timer showing 0.3 SEC in green. A jagged VHS glitch line divides them. Dark background, coral on chaos side, teal on order side." \
      "3:1" "Split-screen contrast"

    generate_image "port-collision-section-2" \
      "Technical illustration of a port assignment machine. A brass nautical device with a funnel at top labeled IDENTITY IN showing myapp:api and a slot at bottom labeled PORT OUT showing 3146. Gears and hash symbols visible through a glass panel. Steampunk nautical aesthetic. Sandstone and rope gold metal, teal glass, coral accents, dark background." \
      "3:1" "Steampunk technical"

    generate_image "port-collision-section-3" \
      "Illustration of a harbor map with three berths labeled with semantic coordinates: myapp:api:main at berth 3146, myapp:frontend:main at berth 3147, myapp:api:feature-auth at berth 3291. Each berth has a small distinct boat. Nautical chart aesthetic with compass rose. Sandstone parchment, teal water, coral markers, dark borders. Maritime map style with modern labels." \
      "3:1" "Nautical chart"

    generate_image "port-collision-section-4" \
      "Vintage travel poster of a harbormaster at a control panel with three levers labeled DB, API, FRONTEND. Green status lights illuminate in sequence from left to right. Ships in the harbor behind start their engines in order. Text reads PD UP at the bottom. Warm coral, teal, sandstone, ebony. Retro command-center poster style." \
      "3:1" "Vintage travel poster"
  fi
fi

# ============================================================
# ARTICLE 3: Dead Agents Tell Tales
# ============================================================

if [ -z "$ARTICLE_FILTER" ] || [ "$ARTICLE_FILTER" = "3" ]; then
  echo "=== Article 3: Dead Agents Tell Tales ==="

  generate_image "dead-agents-hero" \
    "Vintage travel poster of a dramatic harbor salvage scene at night. A diving bell descends into dark teal water, illuminated by searchlights from above. Glowing cargo crates are visible underwater, connected by bioluminescent threads. A crane on the dock is hauling up a recovered crate. Bold text reads 'PORT DADDY' at top and 'DEAD AGENTS TELL TALES' at bottom. Coral red, teal, sandstone, warm ebony. Dramatic nautical poster, film noir lighting." \
    "16:9" "Vintage travel poster"

  if [ "$HEROES_ONLY" = false ]; then
    generate_image "dead-agents-section-1" \
      "Illustration of a ship's dashboard showing a fuel gauge dropping to empty. The gauge is labeled CONTEXT WINDOW. A dollar counter next to it reads 50 dollars. The ship is mid-voyage surrounded by dark water. Red warning lights flash. Teal water, coral warning lights, sandstone instrument panels, dark background. Retro nautical instrument aesthetic." \
      "3:1" "Retro instrument panel"

    generate_image "dead-agents-section-2" \
      "Technical state diagram showing agent lifecycle as a nautical journey. Four states as harbor locations connected by arrows: ACTIVE (green lighthouse), STALE (amber buoy, 10min), DEAD (red shipwreck, 20min), SALVAGED (teal crane lifting wreckage). Each transition labeled with time. Dark background, glowing state nodes, dotted arrow paths. Clean technical but nautical aesthetic." \
      "3:1" "Technical state diagram"

    generate_image "dead-agents-section-3" \
      "Vintage illustration of a salvage diver underwater discovering a treasure chest labeled SESSION NOTES. The chest is open, revealing scrolls and maps glowing with teal light. A rope leads upward to a new ship waiting at the surface. Dark underwater teal, coral glowing artifacts, sandstone scrolls, warm ebony depths. Underwater adventure poster style." \
      "3:1" "Underwater adventure poster"

    generate_image "dead-agents-section-4" \
      "Illustration of a mythical phoenix bird rising from a shipwreck in a harbor. The phoenix is made of flowing teal and coral flames. Below, the wreckage shows terminal text fragments. A new ship is forming from the flames above. Text reads PHOENIX PATTERN. Dark background, dramatic lighting, art nouveau nautical style." \
      "3:1" "Art nouveau nautical"

    generate_image "dead-agents-section-5" \
      "Technical blueprint illustration showing two columns. Left column labeled PRESERVED with check marks: session notes, file claims, agent purpose, timestamps. Right column labeled COMING SOON with dotted outlines: mental model, dependency map, error memory, plan state. Blueprint paper texture in sandstone. Teal ink, coral accent marks, dark borders. Architectural blueprint style." \
      "3:1" "Technical blueprint"
  fi
fi

# ============================================================
# ARTICLES 4-10: Heroes Only (generate section images later)
# ============================================================

if [ -z "$ARTICLE_FILTER" ] || [ "$ARTICLE_FILTER" = "4" ]; then
  echo "=== Article 4: Distributed Locks ==="
  generate_image "distributed-locks-hero" \
    "Vintage travel poster of a massive harbor lock gate, half-open, with one ship passing through while another waits outside. The waiting ship has a yellow light. The passing ship has a green light. A lock keeper operates the mechanism. Bold text reads 'PORT DADDY' at top and 'DISTRIBUTED LOCKS' at bottom. Coral, teal water, sandstone lock walls, warm ebony sky. Panama Canal poster aesthetic." \
    "16:9" "Vintage travel poster"
fi

if [ -z "$ARTICLE_FILTER" ] || [ "$ARTICLE_FILTER" = "5" ]; then
  echo "=== Article 5: Four Agents No Clobbering ==="
  generate_image "four-agents-hero" \
    "Vintage travel poster of a busy harbor with exactly four distinctly colored ships approaching a dock. A harbormaster on the dock holds up four colored signal flags, directing each ship to a different berth. The dock has four numbered slips. Bold text reads 'PORT DADDY' at top and '4 AGENTS, ZERO COLLISIONS' at bottom. Coral, teal, sandstone, warm ebony. Cheerful retro poster, mid-century style." \
    "16:9" "Vintage travel poster"
fi

if [ -z "$ARTICLE_FILTER" ] || [ "$ARTICLE_FILTER" = "6" ]; then
  echo "=== Article 6: Pub/Sub ==="
  generate_image "pub-sub-hero" \
    "Vintage travel poster of a harbor with a tall signal tower broadcasting via naval signal flags. Three ships in the harbor each have a sailor looking up at the flags through binoculars. Signal waves radiate from the tower in concentric circles. Bold text reads 'PORT DADDY' at top and 'PUB/SUB FOR YOUR DEV ENVIRONMENT' at bottom. Coral tower, teal waves, sandstone dock, warm ebony sky. Art deco communication poster style." \
    "16:9" "Vintage travel poster"
fi

if [ -z "$ARTICLE_FILTER" ] || [ "$ARTICLE_FILTER" = "7" ]; then
  echo "=== Article 7: Fleet Management ==="
  generate_image "fleet-management-hero" \
    "Vintage travel poster of a fleet of eight small ships in formation departing a harbor at dawn. Each ship flies a different flag showing its role: broom, magnifying glass, book, wrench, compass, shield, gear, lightbulb. A lighthouse in the background. Bold text reads 'PORT DADDY' at top and 'FLEET MANAGEMENT' at bottom. Coral dawn sky, teal water, sandstone harbor, warm ebony ships. Military fleet review poster style." \
    "16:9" "Vintage travel poster"
fi

if [ -z "$ARTICLE_FILTER" ] || [ "$ARTICLE_FILTER" = "8" ]; then
  echo "=== Article 8: Pheromone Trails ==="
  generate_image "pheromone-trails-hero" \
    "Vintage travel poster of a harbor at night with glowing trails on the water surface, like bioluminescent pathways left by ships that have passed. Some trails are bright (recent), others are fading (decaying). A ship follows the brightest trail. Bold text reads 'PORT DADDY' at top and 'THE PHEROMONE TRAIL' at bottom. Dark teal water with glowing green trails, coral ship lights, sandstone dock, warm ebony night sky. Mysterious nautical night scene." \
    "16:9" "Vintage travel poster"
fi

if [ -z "$ARTICLE_FILTER" ] || [ "$ARTICLE_FILTER" = "9" ]; then
  echo "=== Article 9: Dashboard at 3 AM ==="
  generate_image "dashboard-hero" \
    "Vintage travel poster of a harbor control room at night. A lone operator sits at a curved desk with multiple glowing screens showing ship positions, status panels, and message feeds. Through the window, a moonlit harbor with ships at rest. A clock on the wall reads 3:17 AM. Bold text reads 'PORT DADDY' at top and 'THE DASHBOARD AT 3 AM' at bottom. Teal screen glow, coral status indicators, sandstone desk, warm ebony room. Mission control meets maritime office." \
    "16:9" "Vintage travel poster"
fi

if [ -z "$ARTICLE_FILTER" ] || [ "$ARTICLE_FILTER" = "10" ]; then
  echo "=== Article 10: Harbors Agent Teams ==="
  generate_image "harbors-hero" \
    "Vintage travel poster of an aerial view of a coastline with two distinct harbors connected by a bridge. The left harbor is labeled BACKEND with three ships docked. The right harbor is labeled FRONTEND with three ships docked. Signal flags fly between the two harbors via the bridge. Bold text reads 'PORT DADDY' at top and 'HARBORS: AGENT TEAMS' at bottom. Coral bridge, teal water, sandstone coast, warm ebony borders. Cartographic poster style with nautical chart elements." \
    "16:9" "Vintage travel poster"
fi

echo ""
echo "=== DONE ==="
echo "Images saved to: $OUT_DIR"
ls -la "$OUT_DIR"/*.png 2>/dev/null | wc -l | xargs -I{} echo "{} images generated"
