# Detection Runbook — Concrete Recipes

Grep / strace / netstat / iptables incantations for finding compromise on a live or suspected box. For "live triage / containment / recovery" of a confirmed incident, use the `comfyui-incident-response` skill — this file is for periodic hygiene + initial triage.

---

## Quick triage — "is this box compromised?"

Run these in order. If any return unexpected results, move to deeper investigation.

```bash
# 1. Unexpected processes
ps -eo pid,user,%cpu,%mem,comm,args --sort=-%cpu | head -20
# Look for: xmrig, kdevtmpfsi, randomly-named binaries, processes you didn't start

# 2. Listening sockets — should match your known config
ss -tlnp 2>/dev/null || netstat -tlnp
# Bound to 0.0.0.0 when you expected 127.0.0.1? Red flag.

# 3. Outbound connections
ss -tnp 2>/dev/null | grep ESTAB || netstat -tnp | grep ESTABLISHED
# Look for connections to mining pools, pastebins, IPs not on your allowlist

# 4. Resource usage that doesn't match jobs
nvidia-smi
# 95%+ GPU util when no jobs are queued = strong miner signal

# 5. Recent file modifications outside expected dirs
find / -mtime -7 -type f 2>/dev/null \
  | grep -vE '^/proc|^/sys|^/var/log|^/tmp|^/dev|^/run' \
  | head -50
# Anything in /etc, /usr/bin, /usr/local that you didn't put there?

# 6. New cron / systemd / login items
crontab -l 2>/dev/null
ls -la /etc/cron.d/ /etc/cron.daily/ /etc/cron.hourly/ 2>/dev/null
systemctl list-units --type=service --state=running | tail -20
ls -la ~/.bashrc ~/.zshrc ~/.profile ~/.config/autostart/ 2>/dev/null

# 7. Persistence in the daemon's directory
find /opt/comfyui -mtime -7 -type f 2>/dev/null | head -30  # adjust path
ls -la ~/comfyui/custom_nodes/ 2>/dev/null  # or wherever
```

---

## Network egress audit

### Known mining-pool indicators

```bash
# Domain check
for d in pool.minexmr.com xmrpool.eu 2miners.com hashvault.pro nanopool.org \
         supportxmr.com unmineable.com; do
  ss -tn 2>/dev/null | grep -F "$d" && echo "ALERT: $d connection found"
done

# IP check (resolve common pools, look for connections)
dig +short pool.minexmr.com 2miners.com supportxmr.com | while read ip; do
  ss -tn 2>/dev/null | grep -F "$ip" && echo "ALERT: $ip connection found"
done
```

### Allowlist verification (positive)

```bash
# What domains has the box connected to in the last hour?
sudo tcpdump -nn -c 1000 'tcp and (port 80 or port 443)' 2>/dev/null \
  | awk '{print $5}' | cut -d. -f1-4 | sort -u | head -30
# Cross-reference against your allowlist
```

### DNS query log (if you run a local resolver)

```bash
# Pi-hole, dnsmasq, systemd-resolved, etc.
journalctl -u systemd-resolved --since "1 hour ago" | grep -i query | tail -30
# Or pihole -t for live tail
```

---

## File-integrity monitoring (lightweight, cron-friendly)

```bash
# Initial baseline
sudo find /opt/comfyui -type f -name '*.py' -exec sha256sum {} + > /var/lib/comfyui-baseline.sha256

# Hourly check
diff <(sudo find /opt/comfyui -type f -name '*.py' -exec sha256sum {} + | sort) \
     <(sort /var/lib/comfyui-baseline.sha256) \
  | head -20
```

For real FIM: AIDE (`aide --check`), Tripwire, or auditd watches:
```
auditctl -w /opt/comfyui/custom_nodes -p wa -k comfyui_nodes
auditctl -w /etc/cron.d -p wa -k cron_changes
auditctl -w /etc/systemd/system -p wa -k systemd_changes
ausearch -k comfyui_nodes -ts today
```

---

## Process and module introspection

```bash
# What modules has the daemon loaded?
sudo cat /proc/$(pgrep -f comfyui)/maps 2>/dev/null | grep '\.so' | awk '{print $NF}' | sort -u
# Anything in /tmp, /dev/shm, or unusual paths?

# Open files
sudo lsof -p $(pgrep -f comfyui) 2>/dev/null | head -50
# Files outside expected dirs (models/, custom_nodes/, output/, /tmp for staging)?

# Network connections by the daemon process
sudo lsof -i -P -n -p $(pgrep -f comfyui) 2>/dev/null
```

---

## Custom-node corpus scan

```bash
cd /opt/comfyui/custom_nodes  # or your equivalent

# 1. Dangerous imports
grep -rEhn '^(from|import) +(subprocess|socket|urllib|requests|pickle|base64|ctypes|os)' \
  --include='*.py' . | sort -u > /tmp/imports.txt
wc -l /tmp/imports.txt
# Manually review — most are benign os.path / urllib.parse, but unusual ones stick out

# 2. Suspicious URLs
grep -rEohn 'https?://[a-zA-Z0-9.-]+' --include='*.py' . \
  | sort -u | grep -vE 'huggingface|github|civitai|pypi|npmjs|comfy|stability|raw\.githubusercontent'
# Anything outside the expected set is a finding

# 3. Base64 blobs > 200 chars (often packed payloads)
grep -rEohn '[A-Za-z0-9+/]{200,}' --include='*.py' .

# 4. exec / compile / eval calls (dynamic code)
grep -rEhn '\b(exec|compile|eval)\s*\(' --include='*.py' .

# 5. Subprocess + suspicious binaries
grep -rEhn 'subprocess.*\b(curl|wget|chmod|nc|bash -c|sh -c)\b' --include='*.py' .

# 6. Pickle / .ckpt loads from non-canonical paths
grep -rEhn '(pickle\.load|torch\.load|joblib\.load)' --include='*.py' .
```

A clean ComfyUI custom_nodes/ has dozens of legitimate hits but no surprises. Investigate every surprise.

---

## Image-integrity sanity check (periodically)

For Docker/Cog deployments:

```bash
# What digest is running?
docker inspect $(docker ps -q --filter ancestor=comfyui) --format '{{.Image}}'

# Does it match what you deployed?
diff <(echo "expected-sha256-here") <(docker inspect ... --format '{{.Image}}')

# Has the image changed since pull?
docker image inspect comfyui:tag --format '{{.Id}}'
```

---

## When to escalate to incident response

If any of these are true, **stop investigating from inside the box** and switch to the `comfyui-incident-response` runbook:

1. You found an unexpected process actively running.
2. You found connections to a known C2 / mining pool.
3. GPU is at 95%+ utilization with no jobs queued.
4. A custom-node directory has files you didn't put there.
5. `/etc/cron.d`, systemd unit dir, or `~/.bashrc` was modified recently and you didn't do it.
6. API tokens you might have had on the box (HF_TOKEN, AWS, etc.) are suddenly being used elsewhere.

**Do not touch the suspected files from inside the running daemon process.** Snapshot the disk first; the running attacker may have anti-forensics.

---

## Periodic checklist (cron-able, weekly)

```bash
#!/bin/bash
# /etc/cron.weekly/comfyui-hygiene

set -e
LOG=/var/log/comfyui-hygiene-$(date +%Y%m%d).log

{
  echo "=== Process listing ==="
  ps -eo user,%cpu,comm | sort -k2 -nr | head -10

  echo "=== Listening sockets ==="
  ss -tlnp 2>/dev/null

  echo "=== Outbound connections ==="
  ss -tn 2>/dev/null | head -20

  echo "=== Recent /opt/comfyui changes ==="
  find /opt/comfyui -mtime -7 -type f 2>/dev/null | head -30

  echo "=== Custom-node baseline diff ==="
  cd /opt/comfyui/custom_nodes
  diff <(find . -type f -name '*.py' -exec sha256sum {} + | sort) \
       /var/lib/comfyui/custom_nodes.sha256 || true
} > $LOG

# Mail or alert if changes detected
[ $(wc -l < $LOG) -gt 100 ] && mail -s "ComfyUI hygiene alert" you@example.com < $LOG
```

Catch trouble before it catches you. For after-the-fact response, see `comfyui-incident-response`.
