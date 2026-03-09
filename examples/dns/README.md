# DNS Examples

## setup-resolver.sh

End-to-end DNS resolver workflow: register records, set up /etc/hosts, verify resolution, tear down.

**Requirements**: Port Daddy daemon running, sudo access for /etc/hosts modification.

```bash
bash examples/dns/setup-resolver.sh
```

## service-discovery.ts

SDK-based DNS service discovery pattern showing how services find each other by hostname.

```bash
npx tsx examples/dns/service-discovery.ts
```
