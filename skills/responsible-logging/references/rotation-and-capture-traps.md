# Rotation, the Captured-Stdout Trap, and the One-Logger Rule

The governor bounds *how often* you log. This reference bounds *where the bytes land*
and *whether the file ever shrinks*. Both incidents in the case study spilled bytes the
in-process logger rotated correctly — because the bytes never went through it.

## The captured-stdout-is-never-rotated trap

An in-process rotating logger (winston/pino/logback/zap) only rotates **files it owns**.
Anything a subsystem writes to raw `stdout`/`stderr` escapes it entirely. When a service
manager captures that stream to a file, **the service manager does not rotate it** unless
you explicitly wire rotation. It grows without bound. In the case study, launchd's
`StandardOutPath` capture reached **255 MB in a single unrotated handle** while winston's
own files rotated at 50 MB × 5 exactly as configured.

### launchd (macOS)

```xml
<!-- TRAP: launchd captures stdout to this file and NEVER rotates it. -->
<key>StandardOutPath</key><string>/Users/me/.svc/logs/out.log</string>
<key>StandardErrorPath</key><string>/Users/me/.svc/logs/err.log</string>
```

Fixes (pick one):
- Keep stdout **terse** (a boot banner, fatal crashes) and send real logs to a rotating
  in-process transport that owns its own files.
- Rotate the captured file out-of-band with `newsyslog(8)` (a `/etc/newsyslog.d/*.conf`
  entry) or `logrotate`.
- Do not capture at all; let the process manage its own rotating log directory.

### systemd (Linux)

```ini
# TRAP: file:/append: is NOT rotated by systemd.
StandardOutput=append:/var/log/svc/out.log
```

Fixes:
- `StandardOutput=journal` — journald applies size/time limits (`SystemMaxUse`, vacuum).
- Or a rotating in-process sink + `logrotate` with `copytruncate`.

## Rotation settings that actually bound a file

An in-process File transport with **no size/count cap is an unbounded file** — the same
disk risk with a nicer API. Always cap both size and count:

```ts
// winston — self-rotating, bounded, oldest file recycled
new winston.transports.File({
  filename: 'app.log',
  maxsize: 50 * 1024 * 1024,   // 50 MB per file
  maxFiles: 5,                 // keep 5 → hard ceiling ~250 MB
  tailable: true,              // app.log is always newest; older ones shift
});
```

- `maxsize` **without** `maxFiles` still grows forever (infinite rotated files).
- `logrotate` `create` vs `copytruncate`: a long-lived daemon holding the fd needs
  `copytruncate` (or a reopen-on-SIGHUP handler) or it keeps writing to the rotated inode.

## The one-logger rule

`console.*` / `print` / `fmt.Println` / `System.out` sprawl is not a style nit — it is
the **leak path** that bypasses every control above: no rotation, no dedup, no
correlation ids, no level discipline. The case study's 313 GB largely rode this path.

- **One logger, imported everywhere.** No subsystem constructs its own sink or writes raw.
- Reserve raw stdout for the few pre-logger moments (arg parsing, the logger's own boot).
- Run `scripts/audit_logging.py` to enumerate raw-sink sites and fail CI on new ones.

## Level discipline

Levels are a routing and alerting contract, not decoration. Mis-leveling is what makes an
error storm *page* someone at 3am.

| Level | Means | In a loop? |
|-------|-------|------------|
| `error` | a human must eventually act; something failed | **only via the governor** |
| `warn` | degraded but self-handling (breaker open, retrying) | governed |
| `info` | notable lifecycle event (started, swept, promoted) | governed or `sampleEveryN` |
| `debug` | developer detail; off in prod | fine, but still governed if in a hot path |

Rule of thumb: if a line can be emitted by a loop, it is `error` **only** if a persistent
occurrence genuinely needs human action — and then it goes through the governor so the
human gets one alert with a count, not 7,182 pages.
