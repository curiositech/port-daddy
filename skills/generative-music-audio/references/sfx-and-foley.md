# Sound Effects + Foley (May 2026)

Short, designed sounds. Different problem from full-song generation: you want one specific event, often loopable, often layered with other SFX. Different prompting style.

---

## ElevenLabs Text-to-Sound-Effects — the hosted default

- **Max 30s, 48kHz, seamless looping support.**
- **Pricing**: 100 credits flat for AI-decided duration; **40 credits/sec** for user-set duration. So a 30s SFX = 1,200 credits (~$0.12 on Creator plan).
- Commercial use across paid plans.
- Best hosted SFX option in 2026, especially with the ElevenLabs MCP for tool-calling agents.

```bash
# Via REST
curl -X POST https://api.elevenlabs.io/v1/sound-generation \
  -H "xi-api-key: $ELEVENLABS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "footsteps on wet gravel, medium pace, leather-soled boots, close mic",
    "duration_seconds": 5,
    "prompt_influence": 0.7
  }' \
  --output footsteps.mp3
```

`prompt_influence` 0.0–1.0; higher = stricter prompt fidelity, less creative variance. 0.7 is a good default.

---

## Stable Audio (2.5 hosted / Open local)

- ~47s clean SFX + loops with **defensible training data**.
- The competition for ElevenLabs at the higher end.
- Strong on textural / atmospheric / musical SFX (drones, pads, designed transitions).
- Weaker on punchy single-event foley (footstep, glass break) — ElevenLabs wins those.

---

## AudioGen (Meta)

- Open-weights, **non-commercial license**.
- Same caveats as MusicGen — code MIT, weights CC-BY-NC.
- Use for research only.

---

## Prompt Patterns That Actually Work

The novice prompt: "footsteps". You will get garbage.

The expert prompt: **material + action + perspective + space**.

| Element | Examples |
|---|---|
| **Material** | wet gravel, dry leaves, wooden floorboards, marble tile, snow, mud |
| **Action** | medium pace walking, running, slow sneaking, single heavy step |
| **Perspective** | close mic, distant, mid-room, ambient |
| **Space** | dry/no reverb, small room, large hall, outdoor open field, tunnel |

Examples:

✅ Good:
- `"footsteps on wet gravel, medium pace, leather-soled boots, close mic, no reverb"`
- `"glass bottle breaking on concrete, single hit, dry, close mic"`
- `"thunder rumble, distant, large open field, slow rolling, 8 seconds"`
- `"5-second seamless loop of light rain on a tin roof, distant traffic, late night"`
- `"door slamming shut, heavy wood, in a small hallway, close mic"`

❌ Bad:
- `"footsteps"` (no material, no perspective)
- `"scary sound"` (no event, no descriptors)
- `"music with effects"` (wrong tool — that's a song generator)

---

## Layering Strategy

AI is much better at one event than at a designed scene. **Generate atomic events; combine in a DAW or via FFmpeg.**

Example — a footstep ambience for a forest scene:

1. `"single footstep on dry leaves, dry, close mic"` — generate 8 variations.
2. `"distant bird calls, forest, mid-morning, 30 seconds"` — generate the bed.
3. `"wind through pine trees, gentle, 30 seconds"` — generate the texture.
4. Combine in DAW with random pan + slight pitch variation per footstep.

Beats asking ElevenLabs for "person walking through a forest with birds and wind."

---

## Loop-Target Prompts

For seamless ambience loops, **explicitly say "seamless loop" + duration**:

- `"5-second seamless loop, light rain on tin roof, no transients"`
- `"10-second seamless ambience, server room hum, low rumble, no varying elements"`

ElevenLabs has loop-aware generation; Stable Audio less so. Test both for the specific sound.

---

## Negative Prompts

When supported (varies by service):

- `"footsteps on gravel, no music, no voice, no reverb tail"` — clean dry sample.
- `"thunder rumble, no rain, no birds, no music"` — isolated event.

ElevenLabs SFX handles negative-style prompts in the main text field. Stable Audio supports a separate negative prompt field in some interfaces.

---

## ElevenLabs MCP Integration

The `mcp__ElevenLabs__text_to_sound_effects` tool is available in this skill. Use it directly when generating SFX in an agent context:

```
mcp__ElevenLabs__text_to_sound_effects(
    text="metallic clang, heavy steel door, large warehouse, close mic",
    duration_seconds=3,
    output_format="mp3_44100_128"
)
```

Response includes the binary audio. Save to disk, check in to your asset directory, and tag with the prompt for future regeneration.

---

## Quick-Pick

| Need | Pick |
|---|---|
| Single specific SFX event (footstep, glass, thunder) | **ElevenLabs SFX** (40 credits/sec) |
| Long ambient bed (rain, forest, hum) | **ElevenLabs SFX** (loop-aware, up to 30s) |
| Textural / atmospheric / musical | **Stable Audio 2.5** |
| Free local with commercial rights <$1M ARR | **Stable Audio Open** |
| Research / non-commercial | **AudioGen** |

---

## Production Pipeline (typical asset run)

1. Write event list (50–200 atomic SFX events with prompts).
2. Batch-generate via ElevenLabs API (loop or one-shot).
3. Manually QA (5–10% reject rate is normal — too quiet, off-pitch, wrong character).
4. Re-roll rejects with refined prompts.
5. Tag (event type, perspective, length) and check into asset library.
6. Combine atomic events in DAW (Reaper, Logic, Ableton) or via FFmpeg for finished cues.

For game audio middleware integration (Wwise, FMOD), spatial audio, and adaptive systems, see the `sound-engineer` skill.
