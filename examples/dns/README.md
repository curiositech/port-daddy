# DNS Examples

## `setup-resolver.sh`

End-to-end DNS resolver workflow with current `pd dns` commands: register
records, inspect status, print the optional `/etc/hosts` setup commands, and
clean up.

**Requirements**: Port Daddy daemon running. `sudo` is only needed if you choose
to run the printed host-file setup commands.

```bash
bash examples/dns/setup-resolver.sh
```

## `service-discovery.ts`

SDK-based DNS service discovery pattern showing how services find each other by hostname.

```bash
npx tsx examples/dns/service-discovery.ts
```
