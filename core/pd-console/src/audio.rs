//! pd-console procedural UI sound — synthesized in-process, no audio assets.
//!
//! The operator console earns a *sonic identity*: a small vocabulary of short,
//! distinct earcons fired ONLY on meaningful state changes (a DAG blooms, a
//! dispatch launches, a destructive command is vetoed) — never on every click,
//! per the `app-sound-design` discipline. Each cue is a hand-built f32 sample
//! buffer (sine/triangle/square partials under an ADSR envelope), played through
//! a detached `rodio::Sink`. No files ship; the whole sound bank is math.
//!
//! Design rules honored here:
//!   * Confirms RISE in pitch (progress/optimism); errors/vetoes fall.
//!   * Every semantic event has a DISTINCT timbre — sound carries information.
//!   * Routine feedback stays < 500 ms; only the bloom "brand sting" runs longer.
//!   * Each play jitters pitch ±4 % so a repeated cue never habituates to grating.
//!   * A global mute (default ON for this native desktop tool) gates everything;
//!     the toolbar speaker + `Ctrl-A m` flip it.
//!
//! Robustness: the output device is opened lazily on the FIRST play, on the
//! calling (main UI) thread, and cached in a `thread_local`. If no device is
//! available (CI, headless render, no CoreAudio) every call silently no-ops —
//! sound is a delight, never a dependency.

// RefCell only backs the gpui-gated thread-local device cell; in the headless
// (repl/test) build it would be an unused import.
#[cfg(feature = "gpui")]
use std::cell::RefCell;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

#[cfg(feature = "gpui")]
use rodio::{buffer::SamplesBuffer, OutputStream, OutputStreamHandle, Sink};

const SAMPLE_RATE: u32 = 44_100;

/// Master mute. Default `false` (= NOT muted: sound on) — the operator asked for
/// sound, and a native desktop tool may default audible (unlike the web). The
/// speaker control flips this; persisted nowhere yet (session-scoped).
static MUTED: AtomicBool = AtomicBool::new(false);

/// A tiny LCG so repeated cues vary in pitch without pulling in `rand`. Seeded
/// off a monotonic counter — enough decorrelation to dodge the habituation that
/// makes a fixed earcon grating by the 15th play.
static JITTER_STATE: AtomicU32 = AtomicU32::new(0x9E37_79B9);

fn next_jitter() -> f32 {
    // xorshift32 step → a deterministic-but-varying value in roughly [-1, 1].
    let mut x = JITTER_STATE.load(Ordering::Relaxed);
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    JITTER_STATE.store(x, Ordering::Relaxed);
    ((x as f32) / (u32::MAX as f32)) * 2.0 - 1.0
}

/// Is the sound layer currently muted?
pub fn is_muted() -> bool {
    MUTED.load(Ordering::Relaxed)
}

/// Flip mute; returns the new muted state.
pub fn toggle_mute() -> bool {
    let now = !MUTED.load(Ordering::Relaxed);
    MUTED.store(now, Ordering::Relaxed);
    now
}

/// The console's earcon vocabulary. Each maps to one meaningful state change.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Cue {
    /// A daemon-authored WorkPlan became available:
    /// a soft ascending arpeggio. The one cue allowed to run long (~620 ms).
    Bloom,
    /// Committed nodes dispatched to live agents — a confident rising sweep.
    Dispatch,
    /// A generic success / accepted action — a bright two-note rise.
    Confirm,
    /// A chat reply landed down the tube — one soft warm mid note, distinct from
    /// Confirm's rise (a gentle "you've got mail", not a success climb).
    Receive,
    /// A destructive command was intercepted, or an HITL gate stands — a low,
    /// firm descending "stop" (distinct from Error: a wall, not a failure).
    Gate,
    /// An action failed — a low descending tone with a little grit.
    Error,
    /// A binary flip (theme, mute-on) — a crisp, dry click.
    Toggle,
    /// A surface/pane switched into view — a near-silent transition tick.
    Tick,
}

/// Fire an earcon. Cheap, fire-and-forget, main-thread only. No-ops when muted
/// or when no audio device is present.
pub fn play(cue: Cue) {
    if MUTED.load(Ordering::Relaxed) {
        return;
    }
    #[cfg(feature = "gpui")]
    {
        let jitter = 1.0 + next_jitter() * 0.04; // ±4 %
        let samples = synth(cue, jitter);
        with_sink(|handle| {
            if let Ok(sink) = Sink::try_new(handle) {
                sink.append(SamplesBuffer::new(1, SAMPLE_RATE, samples));
                sink.detach(); // play to completion, then drop
            }
        });
    }
    #[cfg(not(feature = "gpui"))]
    {
        let _ = cue; // headless build: synth is unused
    }
}

// ── Synthesis ────────────────────────────────────────────────────────────────

/// One partial: a frequency envelope (ramp f0→f1), an amplitude, and a waveform.
#[cfg(any(feature = "gpui", test))]
struct Partial {
    f0: f32,
    f1: f32,
    amp: f32,
    wave: Wave,
}

#[cfg(any(feature = "gpui", test))]
#[derive(Clone, Copy)]
enum Wave {
    Sine,
    Triangle,
    Square,
}

#[cfg(any(feature = "gpui", test))]
impl Wave {
    #[inline]
    fn sample(self, phase: f32) -> f32 {
        // `phase` in turns [0,1).
        let p = phase.fract();
        match self {
            Wave::Sine => (p * std::f32::consts::TAU).sin(),
            Wave::Triangle => 4.0 * (p - (p + 0.5).floor()).abs() - 1.0,
            Wave::Square => {
                if p < 0.5 {
                    1.0
                } else {
                    -1.0
                }
            }
        }
    }
}

/// One voice in the cue: a stack of partials, a start offset (for arpeggios), a
/// duration, and a peak gain, shaped by a short attack + exponential release.
#[cfg(any(feature = "gpui", test))]
struct Voice {
    start_s: f32,
    dur_s: f32,
    gain: f32,
    partials: Vec<Partial>,
}

/// Build the f32 sample buffer for a cue, with `jitter` scaling every frequency.
/// Pure math (no audio backend) so it is unit-testable from the headless repl.
#[cfg(any(feature = "gpui", test))]
fn synth(cue: Cue, jitter: f32) -> Vec<f32> {
    let voices = voices_for(cue, jitter);
    let total_s = voices
        .iter()
        .map(|v| v.start_s + v.dur_s)
        .fold(0.0_f32, f32::max)
        + 0.02;
    let n = (total_s * SAMPLE_RATE as f32) as usize;
    let mut out = vec![0.0_f32; n.max(1)];

    for v in &voices {
        let start = (v.start_s * SAMPLE_RATE as f32) as usize;
        let len = (v.dur_s * SAMPLE_RATE as f32) as usize;
        let attack = (0.006 * SAMPLE_RATE as f32) as usize; // 6 ms
        for i in 0..len {
            let idx = start + i;
            if idx >= out.len() {
                break;
            }
            let t = i as f32 / len.max(1) as f32; // 0..1 across the voice
                                                  // Amplitude envelope: linear attack, exponential decay/release.
            let env = if i < attack {
                i as f32 / attack as f32
            } else {
                (-(t - (attack as f32 / len as f32)) * 5.0).exp()
            };
            // Sum partials. Each partial sweeps f0→f1 over the voice; integrate
            // the instantaneous frequency to keep phase continuous through ramps.
            let mut s = 0.0_f32;
            for p in &v.partials {
                let f = p.f0 + (p.f1 - p.f0) * t;
                // Approximate phase by mean frequency * elapsed time — fine for
                // these short cues; no audible drift over < 1 s.
                let f_mean = p.f0 + (p.f1 - p.f0) * (t * 0.5);
                let phase = f_mean * (i as f32 / SAMPLE_RATE as f32);
                let _ = f;
                s += p.wave.sample(phase) * p.amp;
            }
            out[idx] += s * env * v.gain;
        }
    }

    // Soft-clip to keep summed voices from blowing past [-1, 1].
    for s in &mut out {
        *s = s.clamp(-1.0, 1.0) * 0.9;
    }
    out
}

/// The score for each cue. Frequencies are the maritime "house key": a warm
/// pentatonic-ish set so cues feel like one instrument.
#[cfg(any(feature = "gpui", test))]
fn voices_for(cue: Cue, j: f32) -> Vec<Voice> {
    let sine = |f0: f32, f1: f32| Partial {
        f0: f0 * j,
        f1: f1 * j,
        amp: 1.0,
        wave: Wave::Sine,
    };
    // A sine + a quiet octave + a faint fifth → warmth without buzz.
    let rich = |f: f32| -> Vec<Partial> {
        vec![
            Partial {
                f0: f * j,
                f1: f * j,
                amp: 1.0,
                wave: Wave::Sine,
            },
            Partial {
                f0: f * 2.0 * j,
                f1: f * 2.0 * j,
                amp: 0.18,
                wave: Wave::Sine,
            },
            Partial {
                f0: f * 1.5 * j,
                f1: f * 1.5 * j,
                amp: 0.10,
                wave: Wave::Triangle,
            },
        ]
    };

    match cue {
        // Ascending arpeggio C5–E5–G5–B5 + a sparkle octave on the last note.
        Cue::Bloom => {
            let notes = [523.25, 659.25, 783.99, 987.77];
            let mut vs: Vec<Voice> = notes
                .iter()
                .enumerate()
                .map(|(i, &f)| Voice {
                    start_s: i as f32 * 0.085,
                    dur_s: 0.34,
                    gain: 0.22,
                    partials: rich(f),
                })
                .collect();
            // A soft shimmer two octaves up, landing with the final note.
            vs.push(Voice {
                start_s: 0.255,
                dur_s: 0.36,
                gain: 0.10,
                partials: vec![sine(1975.53, 1975.53)],
            });
            vs
        }
        // Confident rising sweep — a launch.
        Cue::Dispatch => vec![
            Voice {
                start_s: 0.0,
                dur_s: 0.26,
                gain: 0.26,
                partials: vec![Partial {
                    f0: 392.0 * j,
                    f1: 784.0 * j,
                    amp: 1.0,
                    wave: Wave::Triangle,
                }],
            },
            Voice {
                start_s: 0.04,
                dur_s: 0.22,
                gain: 0.10,
                partials: vec![Partial {
                    f0: 588.0 * j,
                    f1: 1176.0 * j,
                    amp: 1.0,
                    wave: Wave::Sine,
                }],
            },
        ],
        // Bright two-note rise.
        Cue::Confirm => vec![
            Voice {
                start_s: 0.0,
                dur_s: 0.12,
                gain: 0.22,
                partials: rich(587.33),
            },
            Voice {
                start_s: 0.09,
                dur_s: 0.18,
                gain: 0.24,
                partials: rich(880.0),
            },
        ],
        // A single soft warm mid note — a reply arriving (distinct from Confirm's rise).
        Cue::Receive => vec![Voice {
            start_s: 0.0,
            dur_s: 0.16,
            gain: 0.10,
            partials: rich(659.25),
        }],
        // Low, firm descending "stop" with a little triangle edge — a wall.
        Cue::Gate => vec![Voice {
            start_s: 0.0,
            dur_s: 0.30,
            gain: 0.24,
            partials: vec![
                Partial {
                    f0: 330.0 * j,
                    f1: 294.0 * j,
                    amp: 1.0,
                    wave: Wave::Triangle,
                },
                Partial {
                    f0: 165.0 * j,
                    f1: 147.0 * j,
                    amp: 0.30,
                    wave: Wave::Sine,
                },
            ],
        }],
        // Failure: lower, grittier descending tone.
        Cue::Error => vec![Voice {
            start_s: 0.0,
            dur_s: 0.34,
            gain: 0.22,
            partials: vec![
                Partial {
                    f0: 392.0 * j,
                    f1: 196.0 * j,
                    amp: 1.0,
                    wave: Wave::Triangle,
                },
                Partial {
                    f0: 196.0 * j,
                    f1: 98.0 * j,
                    amp: 0.22,
                    wave: Wave::Square,
                },
            ],
        }],
        // Dry crisp click.
        Cue::Toggle => vec![Voice {
            start_s: 0.0,
            dur_s: 0.05,
            gain: 0.16,
            partials: vec![Partial {
                f0: 760.0 * j,
                f1: 760.0 * j,
                amp: 1.0,
                wave: Wave::Square,
            }],
        }],
        // Near-silent transition tick.
        Cue::Tick => vec![Voice {
            start_s: 0.0,
            dur_s: 0.03,
            gain: 0.06,
            partials: vec![sine(1320.0, 1320.0)],
        }],
    }
}

// ── Device (lazy, thread-local, fail-soft) ───────────────────────────────────

#[cfg(feature = "gpui")]
thread_local! {
    /// The output device, opened once on first play. `Err` once we've tried and
    /// failed (no device) so we never re-attempt and never spam logs.
    static AUDIO: RefCell<AudioCell> = RefCell::new(AudioCell::Uninit);
}

#[cfg(feature = "gpui")]
enum AudioCell {
    Uninit,
    Dead,
    Live {
        _stream: OutputStream,
        handle: OutputStreamHandle,
    },
}

#[cfg(feature = "gpui")]
fn with_sink(f: impl FnOnce(&OutputStreamHandle)) {
    AUDIO.with(|cell| {
        let mut cell = cell.borrow_mut();
        if matches!(*cell, AudioCell::Uninit) {
            *cell = match OutputStream::try_default() {
                Ok((stream, handle)) => AudioCell::Live {
                    _stream: stream,
                    handle,
                },
                Err(_) => AudioCell::Dead,
            };
        }
        if let AudioCell::Live { handle, .. } = &*cell {
            f(handle);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mute_round_trips() {
        let start = is_muted();
        let flipped = toggle_mute();
        assert_eq!(flipped, !start);
        toggle_mute();
        assert_eq!(is_muted(), start);
    }

    #[test]
    fn jitter_stays_bounded() {
        for _ in 0..1000 {
            let j = 1.0 + next_jitter() * 0.04;
            assert!((0.95..=1.05).contains(&j), "jitter {j} out of band");
        }
    }

    #[test]
    fn every_cue_synths_nonempty_bounded_audio() {
        for cue in [
            Cue::Bloom,
            Cue::Dispatch,
            Cue::Confirm,
            Cue::Receive,
            Cue::Gate,
            Cue::Error,
            Cue::Toggle,
            Cue::Tick,
        ] {
            let buf = synth(cue, 1.0);
            assert!(!buf.is_empty(), "{cue:?} produced no samples");
            assert!(
                buf.iter().all(|s| s.is_finite() && s.abs() <= 1.0),
                "{cue:?} produced out-of-range samples"
            );
            // The bloom sting may run long; routine cues must stay tight.
            let secs = buf.len() as f32 / SAMPLE_RATE as f32;
            let cap = if cue == Cue::Bloom { 0.8 } else { 0.5 };
            assert!(secs <= cap, "{cue:?} ran {secs:.3}s > {cap}s");
        }
    }
}
