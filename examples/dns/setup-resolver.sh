#!/usr/bin/env bash
# Port Daddy DNS resolver example.
#
# Demonstrates current CLI DNS commands without raw daemon HTTP:
#   1. register DNS records
#   2. list and inspect resolver status
#   3. optionally set up /etc/hosts
#   4. clean up records
#
# Run:
#   bash examples/dns/setup-resolver.sh

set -euo pipefail

echo "DNS resolver example"
echo "--------------------"

pd dns register examples:api --hostname examples-api.local --port 3100
pd dns register examples:web --hostname examples-web.local --port 3200

echo ""
echo "Registered records:"
pd dns list --pattern 'examples:*'

echo ""
echo "Resolver status:"
pd dns status

echo ""
echo "Optional host setup:"
echo "  sudo pd dns setup"
echo "  sudo pd dns sync"
echo "  curl http://examples-api.local:3100/health"
echo "  sudo pd dns teardown"

echo ""
echo "Cleanup:"
pd dns unregister examples:api
pd dns unregister examples:web

echo "Done."
