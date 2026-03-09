---
title: DNS Resolution
description: Access your dev services by hostname instead of port numbers
duration: 10 min
level: Intermediate
---

# DNS Resolution

Port Daddy can register DNS records for your services and optionally write them to `/etc/hosts` for OS-level resolution.

## Register DNS Records

When claiming a port, add `--dns` to auto-register a DNS record:

```bash
pd claim myapp:api --dns
# → Port 3100, DNS: myapp-api.local
```

Or register DNS separately:

```bash
pd dns register myapp:api --hostname api.local
pd dns list
pd dns status
```

## Enable /etc/hosts Resolution

For OS-level resolution (so browsers and curl can use hostnames):

```bash
sudo pd dns setup     # adds managed section to /etc/hosts
pd dns sync           # writes current DNS records
pd dns status         # verify resolver is active
```

Port Daddy adds a clearly marked section to `/etc/hosts`:

```
# === PORT DADDY DNS (managed, do not edit) ===
127.0.0.1  myapp-api.local
127.0.0.1  myapp-web.local
# === END PORT DADDY DNS ===
```

## Teardown

```bash
sudo pd dns teardown  # removes entries from /etc/hosts
```

A backup of `/etc/hosts` is created automatically before any modifications.

## SDK Usage

```typescript
const pd = new PortDaddy();
await pd.dnsRegister('myapp:api', { hostname: 'api.local' });
const records = await pd.dnsList();
await pd.dnsSetup();   // requires sudo
await pd.dnsSync();
```
