# Prompt Engineering — Suno, Udio, ElevenLabs

The single highest-leverage skill in generative music. A bad prompt on Suno wastes ~$0.02 (and 5 minutes) per attempt; a good prompt cuts attempts 5–10×.

---

## Suno Custom Mode — the deepest prompting surface

Suno's **Custom Mode** has three input fields:

| Field | Char limit | Contents |
|---|---|---|
| Style | 200 | Comma-separated tags (genre/mood/instruments/vocals/production) |
| Lyrics | 3000 | Lyrics with structure tags |
| Title | ~30 | Display title |

### Style field — tag ordering matters

**Order: Genre → Mood → Instruments → Vocals → Production → BPM.** Earlier tags weighted heavier.

✅ Good (4–8 tags, ordered):
```
indie rock, melancholic, jangle guitar, soft female vocals, lo-fi production, 110bpm
```

✅ Good (more specific):
```
synthwave, nostalgic, gated reverb drums, analog synth bass, breathy male vocals, 80s production
```

❌ Bad (too long, contradictory, no order):
```
amazing music with vocals and great production and lots of instruments and modern feel and old school sound and rock and pop
```

### Lyrics field — structure tags

Use bracketed section tags. They genuinely steer the model.

```
[Verse 1]
Walking through the old district past the empty stores
Where we used to meet for coffee back in '99

[Pre-Chorus]
And I keep on telling myself
That you don't think about it anymore

[Chorus]
But the streetlights remember every word
Every laugh, every careless thing we said

[Verse 2]
...

[Bridge]
...

[Chorus]
...

[Outro]
```

**Recognized section tags**: `[Verse]`, `[Verse 1]`, `[Pre-Chorus]`, `[Chorus]`, `[Bridge]`, `[Hook]`, `[Break]`, `[Interlude]`, `[Outro]`, `[Intro]`, `[Drop]` (for EDM).

**Performance directives** (sometimes work, often help): `[whispered]`, `[shouted]`, `[harmonies]`, `[a cappella]`, `[instrumental break]`, `[guitar solo]`, `[fade out]`.

### Negative styles

Suno Custom Mode has an **Exclude Styles** field separate from the main style. Useful for steering away from defaults:
```
Exclude: heavy metal, screaming vocals, electronic
```

### v5.5 Style of Music (MILO-1080)

More deterministic style transfer. Pick a reference style code from Suno's library, lock it via Persona, generate variations on the same vocalist/style across multiple songs.

### Common Suno prompt mistakes

| Mistake | Fix |
|---|---|
| 12-tag style field | Cut to 4–8, ordered |
| Lyrics with no section tags | Add `[Verse]` / `[Chorus]` |
| Genre and counter-genre in same prompt ("rock pop electronic acoustic") | Pick one primary; use sub-genre tags |
| Forgetting BPM | Add `90bpm` or `140bpm` for tempo-sensitive genres |
| Asking for "epic" with no instruments | Specify what makes it epic (orchestral strings, big drums) |

---

## Udio — section-by-section regeneration

Udio's prompting is similar to Suno but its differentiator is **inpainting** — regenerate a specific section without re-rolling the whole song.

- Style tags follow similar ordering rules.
- Lyrics use the same section-tag conventions.
- v4 lets you select a region of the waveform and regenerate just that.
- **Critical caveat**: downloads disabled since Oct 2025 — see `full-song-models.md`.

---

## ElevenLabs Music — prompt-driven, less reference-based

- One prompt field. Describe the song from the outside.
- Less tag-based, more natural-language.
- Structure descriptors ("verse, chorus, bridge with key change to relative minor, fade outro") work but are less deterministic than Suno tags.

✅ Good ElevenLabs Music prompt:
```
A 90-second indie folk song. Acoustic guitar fingerpicking intro, soft female vocals enter at 0:08. Sparse bass at 0:30. Add brushed drums at the chorus around 0:45. Brief instrumental bridge with mandolin. Final chorus harmonies. Slow fade outro.
```

---

## ElevenLabs v3 Audio Tags (TTS, not music)

Inline brackets in the text payload steer delivery:

```
[whispers] [shouts] [laughs] [chuckles] [sighs] [crying]
[angry] [excited] [sad] [scared]
[pauses] [stops talking] [clears throat] [coughs] [swallows]
[door slam] [glass breaks] [footsteps]
[starts laughing] [trails off] [interrupts]
```

Combine for nuanced reads:

```
"She walked in. [pauses] 'You came back?' [whispers] 'After all this time?'"
```

See `voice-and-tts.md` for the full TTS prompt patterns.

---

## Reference Audio (uploads, where supported)

- **Suno**: Extend with timestamp; partial regeneration in Studio (Premier).
- **Udio**: Section-by-section regen + inpainting (DAW-style).
- **Riffusion**: Vocal/instrument swap on existing clips.
- **ElevenLabs Music**: Prompt-driven; less reference-audio-driven than Suno/Udio.

---

## A Worked Example — generating a finished song with Suno

**Goal**: 3-minute melancholic indie pop song, female vocals, autumn theme, commercially usable.

**Step 1: pick a Pro plan** so commercial rights apply.

**Step 2: Style field**:
```
indie pop, melancholic, jangle guitar, breathy female vocals, lo-fi production, 95bpm
```

**Step 3: Lyrics field** (write or generate with an LLM):
```
[Verse 1]
The leaves are turning yellow on the elm tree by my window
And I can't remember when you said you'd be back home

[Pre-Chorus]
The kettle's on but I'm not making tea
Just watching steam pretend to be a memory

[Chorus]
And every September feels like the last one
Where you and I were still in love
The radio kept playing the songs we said were ours
Now they're just songs

[Verse 2]
The sweater that you left here still smells faintly of your cologne
I should have washed it in October when I had the chance

[Pre-Chorus]
The kettle's on but I'm not making tea
Just watching steam pretend to be a memory

[Chorus]
[same lyrics]

[Bridge]
[whispered]
And maybe I'll forget by spring
And maybe I won't

[Chorus]
[same lyrics]

[Outro]
[fade out]
The leaves are turning yellow
The leaves are turning yellow
```

**Step 4: Generate 4 variations.**

**Step 5: Pick the best chorus take, use Extend to refine the bridge if needed.**

**Step 6: Export stems (Pro plan), light mix in your DAW, master via LANDR.**

---

## A Worked Example — generating an instrumental loop with Stable Audio

**Goal**: 30-second seamless ambient loop for a meditation app intro.

**Prompt**:
```
30-second seamless ambient loop, soft pads, gentle felt piano, slow attack, no rhythm, peaceful, A minor, 60bpm, no transients, breathing space
```

**Generate, check loop point in DAW, crossfade if needed, export.**

For ACE-Step prompting (open weights, similar tag structure to Suno), see `open-weights.md`.
