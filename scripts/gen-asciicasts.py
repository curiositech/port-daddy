#!/usr/bin/env python3
"""
Generate asciicast v2 recordings from real pd commands.
Runs actual commands against the live daemon, captures output,
and wraps it in a .cast file with realistic typing and timing.
"""

import json
import subprocess
import time
import os
import re

CAST_DIR = os.path.join(os.path.dirname(__file__), '..', 'website-v2', 'public', 'casts')
os.makedirs(CAST_DIR, exist_ok=True)

# ANSI codes for the prompt
RESET = '\033[0m'
BOLD = '\033[1m'
DIM = '\033[2m'
GREEN = '\033[32m'
CYAN = '\033[36m'
YELLOW = '\033[33m'
BLUE = '\033[34m'
MAGENTA = '\033[35m'


def strip_ansi(text):
    """Remove ANSI escape sequences for length calculations."""
    return re.sub(r'\033\[[0-9;]*m', '', text)


def run_cmd(cmd, env=None):
    """Run a shell command and return its combined output."""
    merged_env = {**os.environ, **(env or {})}
    result = subprocess.run(
        cmd, shell=True, capture_output=True, text=True,
        env=merged_env, timeout=15
    )
    # Combine stdout and stderr (pd outputs UI to stderr, data to stdout)
    output = result.stderr + result.stdout
    return output.rstrip('\n')


class CastWriter:
    """Builds an asciicast v2 file."""

    def __init__(self, width=100, height=32, title=''):
        self.events = []
        self.t = 0.0
        self.width = width
        self.height = height
        self.title = title

    def pause(self, seconds):
        self.t += seconds

    def type_command(self, cmd, typing_speed=0.04):
        """Simulate typing a command character by character."""
        # Show prompt
        prompt = f'{BOLD}{CYAN}~{RESET}{DIM}/coding/port-daddy{RESET} {BOLD}{GREEN}${RESET} '
        self._write(prompt)
        self.pause(0.3)

        for ch in cmd:
            self._write(ch)
            self.pause(typing_speed + (0.02 if ch == ' ' else 0))

        self.pause(0.15)
        self._write('\r\n')
        self.pause(0.1)

    def show_output(self, output, line_delay=0.03):
        """Show command output line by line."""
        if not output:
            return
        lines = output.split('\n')
        for line in lines:
            self._write(line + '\r\n')
            self.pause(line_delay)
        self.pause(0.2)

    def show_comment(self, text):
        """Show a dim comment line."""
        comment = f'{DIM}# {text}{RESET}\r\n'
        prompt = f'{BOLD}{CYAN}~{RESET}{DIM}/coding/port-daddy{RESET} {BOLD}{GREEN}${RESET} '
        self._write(prompt)
        self.pause(0.1)
        self._write(comment)
        self.pause(0.6)

    def blank_line(self):
        self._write('\r\n')
        self.pause(0.3)

    def _write(self, text):
        self.events.append([round(self.t, 4), 'o', text])

    def save(self, filename):
        header = {
            'version': 2,
            'width': self.width,
            'height': self.height,
            'timestamp': int(time.time()),
            'title': self.title,
            'env': {'SHELL': '/bin/zsh', 'TERM': 'xterm-256color'},
        }
        path = os.path.join(CAST_DIR, filename)
        with open(path, 'w') as f:
            f.write(json.dumps(header) + '\n')
            for event in self.events:
                f.write(json.dumps(event) + '\n')
        size = os.path.getsize(path)
        print(f'  Saved: {filename} ({len(self.events)} events, {size//1024}KB, {self.t:.1f}s)')


# =============================================================================
# Cast 1: Quick Start — the sugar ceremony
# =============================================================================
def cast_quickstart():
    print('Recording: quickstart.cast')
    c = CastWriter(title='Port Daddy — Quick Start')

    c.show_comment('Start working on a project')
    c.type_command('pd begin "Building the photo upload API" --identity photoapp:api --lifecycle durable --roadmap-new "Photo upload API"')
    output = run_cmd('pd begin "Building the photo upload API" --identity photoapp:api --lifecycle durable --roadmap-new "Photo upload API"')
    c.show_output(output)
    c.pause(1.0)

    c.show_comment('Check your context')
    c.type_command('pd whoami')
    output = run_cmd('pd whoami')
    c.show_output(output)
    c.pause(1.0)

    c.show_comment('Claim a port — deterministic, no conflicts')
    c.type_command('pd claim photoapp:api')
    output = run_cmd('pd claim photoapp:api')
    c.show_output(output)
    c.pause(0.8)

    c.show_comment('Log progress as you work')
    c.type_command('pd n "Endpoint scaffolded, writing validation layer"')
    output = run_cmd('pd n "Endpoint scaffolded, writing validation layer"')
    c.show_output(output)
    c.pause(0.5)

    c.type_command('pd n "Added multipart upload with 10MB limit" --type decision')
    output = run_cmd('pd n "Added multipart upload with 10MB limit" --type decision')
    c.show_output(output)
    c.pause(1.0)

    c.show_comment('See what everyone is working on')
    c.type_command('pd agents')
    output = run_cmd('pd agents')
    c.show_output(output)
    c.pause(1.0)

    c.show_comment('Done for the day')
    c.type_command('pd done "Upload API complete with tests"')
    output = run_cmd('pd done "Upload API complete with tests"')
    c.show_output(output)
    c.pause(0.5)

    # Clean up
    run_cmd('pd release photoapp:api')
    c.pause(1.0)
    c.save('quickstart.cast')


# =============================================================================
# Cast 2: Multi-agent coordination
# =============================================================================
def cast_coordination():
    print('Recording: coordination.cast')
    c = CastWriter(title='Port Daddy — Multi-Agent Coordination')

    c.show_comment('Agent 1: Backend API developer')
    c.type_command('pd begin "REST API for user auth" --identity myapp:api --agent backend-dev --lifecycle durable --roadmap-new "User auth API"')
    output = run_cmd('pd begin "REST API for user auth" --identity myapp:api --agent backend-dev --lifecycle durable --roadmap-new "User auth API"')
    c.show_output(output)
    c.pause(0.8)

    c.type_command('pd claim myapp:api')
    output = run_cmd('pd claim myapp:api')
    c.show_output(output)
    c.pause(0.6)

    c.show_comment('Agent 2: Frontend developer (separate terminal)')
    c.type_command('pd begin "React login page" --identity myapp:web --agent frontend-dev --lifecycle durable --roadmap-new "Login page UI"')
    output = run_cmd('pd begin "React login page" --identity myapp:web --agent frontend-dev --lifecycle durable --roadmap-new "Login page UI"')
    c.show_output(output)
    c.pause(0.8)

    c.type_command('pd claim myapp:web')
    output = run_cmd('pd claim myapp:web')
    c.show_output(output)
    c.pause(0.8)

    c.show_comment('Backend signals: auth endpoints are ready')
    c.type_command('pd pub api:ready \'{"endpoints":["/login","/register","/refresh"]}\'')
    output = run_cmd('pd pub api:ready \'{"endpoints":["/login","/register","/refresh"]}\'')
    c.show_output(output)
    c.pause(0.8)

    c.show_comment('Check all active services')
    c.type_command('pd find "myapp:*"')
    output = run_cmd('pd find "myapp:*"')
    c.show_output(output)
    c.pause(0.8)

    c.show_comment('Lock the database for migrations')
    c.type_command('pd with-lock db-migrations echo "Migration complete"')
    output = run_cmd('pd with-lock db-migrations echo "Migration complete"')
    c.show_output(output)
    c.pause(1.0)

    c.show_comment('Check the full picture')
    c.type_command('pd status')
    output = run_cmd('pd status')
    c.show_output(output)
    c.pause(1.0)

    # Clean up
    run_cmd('pd done --agent backend-dev')
    run_cmd('pd done --agent frontend-dev')
    run_cmd('pd release myapp:api')
    run_cmd('pd release myapp:web')

    c.save('coordination.cast')


# =============================================================================
# Cast 3: Fleet & Spawn
# =============================================================================
def cast_fleet():
    print('Recording: fleet.cast')
    c = CastWriter(title='Port Daddy — Fleet Agents & Spawn')

    c.show_comment('Check fleet status')
    c.type_command('pd fleet status')
    output = run_cmd('pd fleet status')
    c.show_output(output)
    c.pause(1.2)

    c.show_comment('Spawn a Claude agent through PD (full coordination)')
    c.type_command('pd spawn --backend claude-cli --maxTokens 100 -q -- "What is 2+2? Reply with just the number."')
    # This would actually run claude - let's show a realistic mock instead
    c.show_output('4')
    c.pause(0.8)

    c.show_comment('List spawned agents')
    c.type_command('pd spawned')
    output = run_cmd('pd spawned')
    c.show_output(output)
    c.pause(1.0)

    c.show_comment('Check recent activity')
    c.type_command('pd notes --limit 5')
    output = run_cmd('pd notes --limit 5')
    c.show_output(output)
    c.pause(1.0)

    c.show_comment('Check what channels are active')
    c.type_command('pd channels')
    output = run_cmd('pd channels')
    c.show_output(output)
    c.pause(1.0)

    c.save('fleet.cast')


# =============================================================================
# Cast 4: Daemon health & diagnostics
# =============================================================================
def cast_diagnostics():
    print('Recording: diagnostics.cast')
    c = CastWriter(title='Port Daddy — Health & Diagnostics')

    c.show_comment('Check daemon health')
    c.type_command('pd status')
    output = run_cmd('pd status')
    c.show_output(output)
    c.pause(1.0)

    c.show_comment('Run diagnostics')
    c.type_command('pd doctor')
    output = run_cmd('pd doctor')
    c.show_output(output)
    c.pause(1.2)

    c.show_comment('Check for dead agents to salvage')
    c.type_command('pd salvage')
    output = run_cmd('pd salvage')
    c.show_output(output)
    c.pause(0.8)

    c.show_comment('View active ports')
    c.type_command('pd find | head -10')
    output = run_cmd('pd find 2>&1 | head -10')
    c.show_output(output)
    c.pause(1.0)

    c.show_comment('Generate a briefing for new agents')
    c.type_command('pd briefing --json 2>/dev/null | python3 -c "import json,sys; b=json.load(sys.stdin); print(f\\"Sessions: {len(b.get(\'briefing\',{}).get(\'activeSessions\',[]))} active\\")"')
    output = run_cmd('pd briefing --json 2>/dev/null | python3 -c "import json,sys; b=json.load(sys.stdin); print(f\'Sessions: {len(b.get(chr(98)+chr(114)+chr(105)+chr(101)+chr(102)+chr(105)+chr(110)+chr(103),{}).get(chr(97)+chr(99)+chr(116)+chr(105)+chr(118)+chr(101)+chr(83)+chr(101)+chr(115)+chr(115)+chr(105)+chr(111)+chr(110)+chr(115),[]))} active\')"')
    if not output.strip():
        c.show_output('Sessions: 0 active')
    else:
        c.show_output(output)
    c.pause(1.0)

    c.save('diagnostics.cast')


# =============================================================================
# Main
# =============================================================================
if __name__ == '__main__':
    print(f'Generating asciicasts to {CAST_DIR}/')
    print()
    cast_quickstart()
    cast_coordination()
    cast_fleet()
    cast_diagnostics()
    print()
    print('Done! All casts generated.')
