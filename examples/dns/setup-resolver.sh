#!/usr/bin/env bash
# Port Daddy DNS Resolver — End-to-End Example
#
# Demonstrates:
#   1. Claiming ports with DNS records
#   2. Listing DNS records
#   3. Setting up /etc/hosts resolver
#   4. Syncing records
#   5. Verifying resolution
#   6. Tearing down
#
# Prerequisites:
#   - Port Daddy daemon running (pd start or npm run dev)
#   - sudo access (for /etc/hosts modification)
#
set -euo pipefail

BASE="http://localhost:9876"
echo "=== Port Daddy DNS Resolver Demo ==="
echo ""

# Step 1: Register DNS records for services
echo "--- Step 1: Register DNS records ---"
curl -s -X POST "$BASE/dns/example:api" \
  -H 'Content-Type: application/json' \
  -d '{"hostname": "example-api.local", "port": 3100}' | jq .

curl -s -X POST "$BASE/dns/example:web" \
  -H 'Content-Type: application/json' \
  -d '{"hostname": "example-web.local", "port": 3200}' | jq .

echo ""
echo "--- Step 2: List DNS records ---"
curl -s "$BASE/dns" | jq .

echo ""
echo "--- Step 3: Check resolver status ---"
curl -s "$BASE/dns/status" | jq .

echo ""
echo "--- Step 4: Set up /etc/hosts resolver (requires sudo) ---"
echo "Running: sudo curl -s -X POST $BASE/dns/setup"
# Uncomment the next line to actually modify /etc/hosts:
# sudo curl -s -X POST "$BASE/dns/setup" | jq .
echo "(Skipped in demo mode — uncomment to run)"

echo ""
echo "--- Step 5: Sync records to /etc/hosts ---"
# sudo curl -s -X POST "$BASE/dns/sync" | jq .
echo "(Skipped in demo mode — uncomment to run)"

echo ""
echo "--- Step 6: Verify resolution ---"
echo "After setup, you can access services by hostname:"
echo "  curl http://example-api.local:3100/health"
echo "  curl http://example-web.local:3200"

echo ""
echo "--- Cleanup ---"
curl -s -X DELETE "$BASE/dns/example:api" | jq .
curl -s -X DELETE "$BASE/dns/example:web" | jq .

# Tear down /etc/hosts entries:
# sudo curl -s -X POST "$BASE/dns/teardown" | jq .

echo ""
echo "=== Done ==="
