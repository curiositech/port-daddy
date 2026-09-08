# Responsible Logging

Skill for making a long-lived service or daemon log **leveled, bounded, correlated, and
non-fatal**. Grounded in a real 313 GB write-storm incident (Port Daddy), reusable for any
stack.

> Note: this README is for humans browsing the repo. The runtime loads `SKILL.md`, not this
> file — the authoritative bundle inventory lives in SKILL.md's "Bundle Contents" table.

## Structure

```
responsible-logging/
├── SKILL.md                                  # Core process, anti-patterns, checklist (<500 lines)
├── CHANGELOG.md                              # Version history
├── README.md                                 # This file
├── scripts/
│   └── audit_logging.py                      # Stdlib-only auditor: ranks CARDINAL/HIGH/MEDIUM, CI exit codes
└── references/
    ├── case-study-port-daddy.md              # The 313 GB incident + the five-primitive fix
    ├── governor-primitive.md                 # Stack-agnostic LogGovernor contract + pseudocode
    ├── rotation-and-capture-traps.md         # Rotation + launchd/systemd captured-stdout trap
    └── multi-tenant-and-safety.md            # Correlation ids + fail-safe observability
```

## Quick Start

```bash
# 1. Audit a codebase for logging anti-patterns
python3 scripts/audit_logging.py <path-to-service>

# 2. Read SKILL.md's Core Process; reach for a primitive, not a call-site patch
# 3. Validate the skill itself
python3 /Users/erichowens/.claude/skills/skill-architect/scripts/validate_skill.py .
```
